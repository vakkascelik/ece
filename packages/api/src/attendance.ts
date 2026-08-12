/**
 * Attendance.
 *
 * The one part of the query layer designed around being called from a device that
 * may have no connection. Everything here is safe to retry, because every write
 * carries a `clientUuid` the device generated before it tried — see the note on
 * `signIn`.
 *
 * As everywhere, no tenant or guardianship filtering. The policies in 0009 restrict
 * reads and writes to children the caller may see, so a parent signing their own
 * child in and an educator signing the room in call the same function.
 */

// The ratio imports went with `readRoll` — see the note where it was removed. This module now
// reads attendance and nothing else; the ratio is assembled by `buildRoll` in @ece/core, which is
// the only assembly that merges the offline queue.
import type { Db } from './index';

export type AttendanceKind = 'in' | 'out';

export interface AttendanceEvent {
  id: number;
  childId: string;
  kind: AttendanceKind;
  at: string;
  recordedBy: string | null;
  clientUuid: string;
  corrects: number | null;
  note: string | null;
  createdAt: string;
}

const COLUMNS = 'id, child_id, kind, at, recorded_by, client_uuid, corrects, note, created_at';

interface Row {
  id: number;
  child_id: string;
  kind: AttendanceKind;
  at: string;
  recorded_by: string | null;
  client_uuid: string;
  corrects: number | null;
  note: string | null;
  created_at: string;
}

const toEvent = (r: Row): AttendanceEvent => ({
  id: r.id,
  childId: r.child_id,
  kind: r.kind,
  at: r.at,
  recordedBy: r.recorded_by,
  clientUuid: r.client_uuid,
  corrects: r.corrects,
  note: r.note,
  createdAt: r.created_at,
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface RecordAttendanceInput {
  childId: string;
  kind: AttendanceKind;
  /**
   * When it happened, ISO. Supplied by the caller because an offline sign-in flushed
   * forty minutes later happened at 8:05, not at 8:45 — and attendance times decide
   * funded hours.
   */
  at: string;
  /**
   * The device-generated idempotency key. Generate it **before** the first attempt
   * and reuse it on every retry of the same event; a fresh one per attempt turns a
   * flaky connection into duplicate sign-ins.
   */
  clientUuid: string;
  /** Set when correcting an earlier event. A note is then required. */
  corrects?: number | null;
  note?: string | null;
}

export type RecordResult =
  /** Written by this call. */
  | { outcome: 'recorded'; event: AttendanceEvent }
  /**
   * Already present with this `clientUuid`, so this call changed nothing.
   *
   * Not an error. It is the expected result of retrying a flush whose response was
   * lost, and the caller should treat it exactly like a success — the event is in the
   * database, which is what it wanted.
   */
  | { outcome: 'duplicate' };

/**
 * Record a sign-in or sign-out.
 *
 * Uses `upsert … ignoreDuplicates` on `client_uuid` rather than an insert that throws.
 * The distinction matters for the outbox: an insert that raises on conflict forces the
 * device to parse an error message to decide whether its write actually landed, and
 * getting that wrong either drops an event or duplicates one. This returns a clear
 * answer instead.
 */
export async function recordAttendance(
  db: Db,
  input: RecordAttendanceInput,
): Promise<RecordResult> {
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from('attendance_events')
    .upsert(
      {
        child_id: input.childId,
        kind: input.kind,
        at: input.at,
        client_uuid: input.clientUuid,
        recorded_by: auth.user?.id ?? null,
        corrects: input.corrects ?? null,
        note: input.note?.trim() || null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select(COLUMNS);
  if (error) throw new Error(`recordAttendance: ${error.message}`);

  // `ignoreDuplicates` returns no rows when the conflict was ignored, which is how
  // we know this exact event had already landed.
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { outcome: 'duplicate' };
  return { outcome: 'recorded', event: toEvent(rows[0]) };
}

/**
 * Correct an earlier event.
 *
 * Appends rather than edits, and requires a reason. "Signed in at 8:05, actually it
 * was 7:50" is two rows: after an incident the question is what was recorded at the
 * time, and an edited row cannot answer it.
 */
export async function correctAttendance(
  db: Db,
  input: {
    childId: string;
    kind: AttendanceKind;
    at: string;
    clientUuid: string;
    corrects: number;
    note: string;
  },
): Promise<RecordResult> {
  if (input.note.trim().length < 3) {
    throw new Error('correctAttendance: a reason is required.');
  }
  return recordAttendance(db, input);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface AttendanceState {
  childId: string;
  centreId: string;
  eventId: number;
  kind: AttendanceKind;
  at: string;
}

/**
 * Today's latest event per child, from the `attendance_today` view.
 *
 * Derived every time, never a stored flag. A cached `is_present` drifts on a missed
 * sign-out or a failed write, and drift in a ratio reports itself as compliant.
 */
export async function listAttendanceToday(db: Db, centreId: string): Promise<AttendanceState[]> {
  const { data, error } = await db
    .from('attendance_today')
    .select('child_id, centre_id, event_id, kind, at')
    .eq('centre_id', centreId);
  if (error) throw new Error(`listAttendanceToday: ${error.message}`);
  return (
    data as { child_id: string; centre_id: string; event_id: number; kind: AttendanceKind; at: string }[]
  ).map((r) => ({
    childId: r.child_id,
    centreId: r.centre_id,
    eventId: r.event_id,
    kind: r.kind,
    at: r.at,
  }));
}

/** One child's history, newest first. The roll return and any later question read this. */
export async function listAttendanceForChild(
  db: Db,
  childId: string,
  opts: { since?: string; limit?: number } = {},
): Promise<AttendanceEvent[]> {
  let q = db.from('attendance_events').select(COLUMNS).eq('child_id', childId);
  if (opts.since) q = q.gte('at', opts.since);
  const { data, error } = await q.order('at', { ascending: false }).limit(opts.limit ?? 200);
  if (error) throw new Error(`listAttendanceForChild: ${error.message}`);
  return (data as Row[]).map(toEvent);
}

// ---------------------------------------------------------------------------
// How many adults are here
// ---------------------------------------------------------------------------

/**
 * The most recent adult count recorded today, or 0 if none.
 *
 * Zero rather than a guess. An unrecorded count is unknown, not "the same as
 * yesterday", and a ratio computed against yesterday's staffing is confidently
 * wrong — whereas zero reads as a breach, which is the failure direction somebody
 * notices and fixes.
 */
export async function readAdultsPresent(db: Db, centreId: string): Promise<number> {
  const { data, error } = await db.rpc('adults_present_now', { p_centre: centreId });
  if (error) throw new Error(`readAdultsPresent: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}

/**
 * Landed, or already there. Same idempotency contract as attendance, so the mobile
 * outbox can carry these events too without a second code path.
 */
export type WriteOutcome = 'recorded' | 'duplicate';

/** Record how many adults are present. Append-only, like attendance. */
export async function recordAdultsPresent(
  db: Db,
  input: { centreId: string; adults: number; clientUuid: string; at?: string; note?: string | null },
): Promise<WriteOutcome> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('staff_count_events')
    .upsert(
      {
        centre_id: input.centreId,
        adults: Math.max(0, Math.trunc(input.adults)),
        at: input.at ?? new Date().toISOString(),
        client_uuid: input.clientUuid,
        recorded_by: auth.user?.id ?? null,
        note: input.note?.trim() || null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`recordAdultsPresent: ${error.message}`);
  return (data ?? []).length === 0 ? 'duplicate' : 'recorded';
}

// ---------------------------------------------------------------------------
// The ratio
// ---------------------------------------------------------------------------
/*
 * `readRoll`, `RollState` and `PresentChild` were removed here.
 *
 * A second, exported assembly of the roll and its ratio, called from nowhere — no app, no script,
 * no test, one occurrence in the whole repository, its own definition. It was not merely unused:
 * it computed the ratio from database state alone, with no merge of the offline queue, which is
 * the precise omission `buildRoll` in `@ece/core` exists to prevent. A future caller reaching for
 * the obvious-sounding name would have got a ratio that silently ignores every sign-in still
 * waiting on a wall tablet.
 *
 * Its docblock had also stopped being true. It said "staff attendance is not modelled — Phase 2
 * signs *children* in", which 0038 and 0041 falsified: `staff_members` and `staff_attendance_events`
 * exist, and the derived ratio source is built on them. So it documented an architecture the
 * product had moved past, in a function nobody called.
 *
 * Deleted rather than annotated because the danger was the name. It is in the history if the
 * assembly is ever wanted back.
 */
