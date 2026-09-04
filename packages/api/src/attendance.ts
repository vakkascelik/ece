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
import { shiftLocalDate, type VerificationEvent, type VerificationPeriod } from '@ece/core';
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
  /*
    THE SQLSTATE GOES IN THE MESSAGE, AND DROPPING IT STALLED QUEUES - measured 2026-09-04.

    This threw `error.message` alone. `classifyWriteFailure` decides what the offline outbox
    does with a refused write, and four of its six rules key on a sqlstate - 23514, 42501,
    23503, 22P02 - none of which could ever match, because the code never reached it.

    Three of the four have no message-text fallback, so each was answered `transient`. That
    verdict is not "retry in a minute": it means "the network is down, stop flushing", so one
    such event at the head of a queue stops every write behind it, indefinitely. Read off live
    Postgres inside a rolled-back transaction rather than reasoned about:

      | refusal                                    | code  | before      | after     |
      |--------------------------------------------|-------|-------------|-----------|
      | RLS: not a member of that centre           | 42501 | transient   | permanent |
      | the child was purged (FK)                  | 23503 | transient   | permanent |
      | a malformed uuid                           | 22P02 | transient   | permanent |
      | the 14-day trigger (0078/0079)             | 23514 | permanent   | permanent |

    The last row is the correction. I first wrote this comment claiming the 14-day case was the
    broken one - that 0078's trigger message carried no identifier, so nothing matched. It does
    carry one: `0079` puts `tg_name` at the front, and the name is what the classifier matches.
    That case was always right. What was broken was the three above it, and the drill's own
    inline copy of the rule, which is what actually went red. See `offline-drill.ts`.

    The 42501 row is the one that matters operationally: an educator removed from a centre, or a
    child moved to another service, and a tablet still holding their queue.

    So the code goes into the message. Ugly, and the alternative is a typed error class every
    caller and both outboxes would have to learn; the classifier already reads strings, and this
    makes the string true.
  */
  if (error) {
    throw new Error(
      `recordAttendance: ${error.message}${error.code ? ` [${error.code}]` : ''}`,
    );
  }

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
  // The sqlstate, for the same reason and by the same mechanism as `recordAttendance` above:
  // the mobile outbox flushes adult counts through here and classifies the failure with the
  // same function, so a refusal whose text matches no rule would stall its queue too.
  if (error) {
    throw new Error(
      `recordAdultsPresent: ${error.message}${error.code ? ` [${error.code}]` : ''}`,
    );
  }
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

// ---------------------------------------------------------------------------
// §6-3 verification: the overview both audiences read (0064)
// ---------------------------------------------------------------------------

/** A week's worth of §6-3 state for one child, plus the times the signature covers. */
export interface VerificationWeek extends VerificationPeriod {
  /** The week's sign-in/out instants, for the portal to display before asking. */
  weekEvents: { at: string; kind: 'in' | 'out' }[];
}

interface OverviewRow {
  child_id: string;
  period_start: string;
  period_end: string;
  last_changed_at: string | null;
  verifications: {
    outcome: 'approved' | 'disputed';
    method: 'portal' | 'kiosk' | 'paper';
    verifiedAt: string;
    guardianId: string;
    comment: string | null;
  }[];
  events: { at: string; kind: 'in' | 'out' }[];
}

/**
 * Per child per ISO week: signatures, the record's last server-side change, the times.
 *
 * `verification_overview` is SECURITY INVOKER, so the rows are already scoped by the
 * tables' own policies — staff read the centre, a guardian reads exactly their wards, and
 * this wrapper adds no filter for the same reason nothing in this package does.
 *
 * `weeksBack` is capped at 12: weeks × children is the row count, PostgREST truncates at
 * 1,000 silently (see reading-every-row), and 12 weeks of an 80-place centre is 960 rows.
 * A longer look-back is a report, not this call.
 */
export async function listVerificationOverview(
  db: Db,
  input: { centreId: string; lastCompletedMonday: string; weeksBack?: number },
): Promise<VerificationWeek[]> {
  const weeks = Math.min(Math.max(input.weeksBack ?? 4, 1), 12);
  // shiftLocalDate, not Date arithmetic: the input is already a calendar day in the
  // centre's zone, and the source-scanning guard rightly refuses toISOString here —
  // it caught exactly that in this function's first version.
  const pFrom = shiftLocalDate(input.lastCompletedMonday, -(weeks - 1) * 7);

  const { data, error } = await db.rpc('verification_overview', {
    p_centre: input.centreId,
    p_from: pFrom,
    p_to: input.lastCompletedMonday,
  });
  if (error) throw new Error(`listVerificationOverview: ${error.message}`);

  return ((data ?? []) as OverviewRow[]).map((r) => ({
    childId: r.child_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    recordLastChangedAt: r.last_changed_at,
    events: (r.verifications ?? []) as VerificationEvent[],
    weekEvents: r.events ?? [],
  }));
}

/**
 * A signatory approves or disputes a week from the portal.
 *
 * A plain INSERT, deliberately: 0061's policy is the enforcement — their own ward, named
 * signatory, attributed to themselves — and this wrapper adds nothing, because a caller a
 * policy refuses should be refused by the policy, not by a second copy of it in TypeScript
 * that can drift. The kiosk needed a definer function because a tablet has no identity;
 * a portal caller is exactly who RLS is built to answer for.
 */
export async function recordVerification(
  db: Db,
  input: {
    childId: string;
    guardianId: string;
    periodStart: string;
    periodEnd: string;
    outcome: 'approved' | 'disputed';
    comment?: string | null;
  },
): Promise<void> {
  const { error } = await db.from('attendance_verifications').insert({
    child_id: input.childId,
    guardian_id: input.guardianId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    outcome: input.outcome,
    method: 'portal',
    comment: input.comment?.trim() || null,
  });
  if (error) throw new Error(`recordVerification: ${error.message}`);
}
