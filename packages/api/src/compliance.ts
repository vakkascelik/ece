/**
 * Compliance: staff records, criteria, evidence, and ratio history.
 *
 * Two notes worth carrying:
 *
 * `criteria` is expected to be empty. Nothing seeds it — see 0012 — so every caller has
 * to handle "no criteria loaded" as a normal state rather than an error. The dashboard
 * says so plainly instead of rendering an empty table that looks like a clean bill of
 * health.
 *
 * Ratio history is *derived* rather than stored. `readDayEvents` fetches the raw
 * attendance and adult-count events and `replayDay` in `@ece/core` turns them into
 * snapshots and breach periods. Nothing caches the result, because a cached compliance
 * figure that drifts from the events reports itself as compliant.
 */

import {
  deriveAdultCounts,
  replayDay,
  type AdultSource,
  type DayReplay,
  type StaffRecord,
  type StaffRecordKind,
} from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

// ---------------------------------------------------------------------------
// Staff records
// ---------------------------------------------------------------------------

const STAFF_COLUMNS =
  'id, centre_id, user_id, person_name, role_note, kind, reference, issued_on, expires_on, sighted_by, sighted_at, note, archived_at';

interface StaffRow {
  id: string;
  centre_id: string;
  user_id: string | null;
  person_name: string;
  role_note: string | null;
  kind: StaffRecordKind;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  sighted_by: string | null;
  sighted_at: string | null;
  note: string | null;
  archived_at: string | null;
}

const toStaffRecord = (r: StaffRow): StaffRecord => ({
  id: r.id,
  centreId: r.centre_id,
  userId: r.user_id,
  personName: r.person_name,
  roleNote: r.role_note,
  kind: r.kind,
  reference: r.reference,
  issuedOn: r.issued_on,
  expiresOn: r.expires_on,
  sightedBy: r.sighted_by,
  sightedAt: r.sighted_at,
  note: r.note,
  archivedAt: r.archived_at,
});

/**
 * The centre's records — or, for an educator, only their own.
 *
 * Same query either way. The policy in 0011 allows owners and managers the centre and
 * everybody else their own row, because a police vetting result is personal information
 * the person concerned has a right of access to (IPP 6).
 */
export async function listStaffRecords(
  db: Db,
  centreId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<StaffRecord[]> {
  // Paged: six record kinds per person, kept after they leave, so a centre with turnover
  // passes a thousand rows in a few years. This list is what the expiry warnings are built
  // from — a truncated read would silently stop warning about the records it dropped.
  const rows = await fetchAll<StaffRow>('listStaffRecords', (from, to) => {
    let q = db.from('staff_records').select(STAFF_COLUMNS).eq('centre_id', centreId);
    if (!opts.includeArchived) q = q.is('archived_at', null);
    return q.order('person_name').order('kind').order('id').range(from, to);
  });
  return rows.map(toStaffRecord);
}

export interface StaffRecordInput {
  personName: string;
  kind: StaffRecordKind;
  userId?: string | null;
  roleNote?: string | null;
  reference?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  note?: string | null;
  /** True when the person adding it has seen the original document. */
  sighted?: boolean;
}

export async function addStaffRecord(
  db: Db,
  centreId: string,
  input: StaffRecordInput,
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('staff_records').insert({
    centre_id: centreId,
    user_id: input.userId ?? null,
    person_name: input.personName.trim(),
    role_note: input.roleNote?.trim() || null,
    kind: input.kind,
    reference: input.reference?.trim() || null,
    issued_on: input.issuedOn || null,
    expires_on: input.expiresOn || null,
    // Both or neither: the constraint enforces it, and a sighted_at with nobody
    // attached is not evidence that anybody looked at the document.
    sighted_by: input.sighted ? (auth.user?.id ?? null) : null,
    sighted_at: input.sighted ? new Date().toISOString() : null,
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(`addStaffRecord: ${error.message}`);
}

/** Renewal is a new record, not an edited one — the lapsed period stays answerable. */
export async function renewStaffRecord(
  db: Db,
  previous: StaffRecord,
  input: { reference?: string | null; issuedOn?: string | null; expiresOn: string; sighted: boolean },
): Promise<void> {
  await addStaffRecord(db, previous.centreId, {
    personName: previous.personName,
    kind: previous.kind,
    userId: previous.userId,
    roleNote: previous.roleNote,
    reference: input.reference ?? null,
    issuedOn: input.issuedOn ?? null,
    expiresOn: input.expiresOn,
    sighted: input.sighted,
  });
  await archiveStaffRecord(db, previous.id);
}

/** Records the fact that somebody sighted the original, after the record was created. */
export async function markSighted(db: Db, recordId: string): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db
    .from('staff_records')
    .update({ sighted_by: auth.user?.id ?? null, sighted_at: new Date().toISOString() })
    .eq('id', recordId);
  if (error) throw new Error(`markSighted: ${error.message}`);
}

export async function archiveStaffRecord(db: Db, recordId: string): Promise<void> {
  const { error } = await db
    .from('staff_records')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', recordId);
  if (error) throw new Error(`archiveStaffRecord: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

export interface CriteriaSet {
  id: string;
  name: string;
  serviceType: string;
  source: string;
  effectiveFrom: string | null;
  isCurrent: boolean;
}

export interface Criterion {
  id: string;
  setId: string;
  code: string;
  category: string;
  title: string;
  detail: string | null;
  supersedesCode: string | null;
  sortOrder: number;
}

/**
 * The current criteria set, or null.
 *
 * Null is the expected state of a fresh installation, not a failure. Callers must render
 * "no criteria loaded" rather than an empty list — an empty gap table looks like a clean
 * bill of health, which is the opposite of the truth.
 */
export async function currentCriteriaSet(
  db: Db,
  serviceType = 'centre-based',
): Promise<CriteriaSet | null> {
  const { data, error } = await db
    .from('criteria_sets')
    .select('id, name, service_type, source, effective_from, is_current')
    .eq('service_type', serviceType)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw new Error(`currentCriteriaSet: ${error.message}`);
  if (!data) return null;
  const r = data as {
    id: string;
    name: string;
    service_type: string;
    source: string;
    effective_from: string | null;
    is_current: boolean;
  };
  return {
    id: r.id,
    name: r.name,
    serviceType: r.service_type,
    source: r.source,
    effectiveFrom: r.effective_from,
    isCurrent: r.is_current,
  };
}

export async function listCriteria(db: Db, setId: string): Promise<Criterion[]> {
  const { data, error } = await db
    .from('criteria')
    .select('id, set_id, code, category, title, detail, supersedes_code, sort_order')
    .eq('set_id', setId)
    .order('category')
    .order('sort_order');
  if (error) throw new Error(`listCriteria: ${error.message}`);
  return (
    data as {
      id: string;
      set_id: string;
      code: string;
      category: string;
      title: string;
      detail: string | null;
      supersedes_code: string | null;
      sort_order: number;
    }[]
  ).map((r) => ({
    id: r.id,
    setId: r.set_id,
    code: r.code,
    category: r.category,
    title: r.title,
    detail: r.detail,
    supersedesCode: r.supersedes_code,
    sortOrder: r.sort_order,
  }));
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EVIDENCE_KINDS = [
  'document',
  'photo',
  'meeting_minutes',
  'ratio_history',
  'staff_record',
  'policy',
  'note',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  id: string;
  centreId: string;
  criterionId: string | null;
  kind: EvidenceKind;
  title: string;
  detail: string | null;
  location: string | null;
  coversFrom: string | null;
  coversTo: string | null;
  ownerName: string | null;
  addedAt: string;
}

const EVIDENCE_COLUMNS =
  'id, centre_id, criterion_id, kind, title, detail, location, covers_from, covers_to, owner_name, added_at';

export async function listEvidence(db: Db, centreId: string): Promise<Evidence[]> {
  // Paged: evidence accumulates for the life of the centre and is never deleted, only
  // archived. Truncation here would quietly shrink the binder a reviewer is handed, which is
  // the document this feature exists to produce.
  const rows = await fetchAll<{
    id: string;
    centre_id: string;
    criterion_id: string | null;
    kind: EvidenceKind;
    title: string;
    detail: string | null;
    location: string | null;
    covers_from: string | null;
    covers_to: string | null;
    owner_name: string | null;
    added_at: string;
  }>('listEvidence', (from, to) =>
    db
      .from('evidence')
      .select(EVIDENCE_COLUMNS)
      .eq('centre_id', centreId)
      .is('archived_at', null)
      .order('added_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return (
    rows as {
      id: string;
      centre_id: string;
      criterion_id: string | null;
      kind: EvidenceKind;
      title: string;
      detail: string | null;
      location: string | null;
      covers_from: string | null;
      covers_to: string | null;
      owner_name: string | null;
      added_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    centreId: r.centre_id,
    criterionId: r.criterion_id,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    location: r.location,
    coversFrom: r.covers_from,
    coversTo: r.covers_to,
    ownerName: r.owner_name,
    addedAt: r.added_at,
  }));
}

export async function addEvidence(
  db: Db,
  centreId: string,
  input: {
    criterionId: string | null;
    kind: EvidenceKind;
    title: string;
    detail?: string | null;
    location?: string | null;
    coversFrom?: string | null;
    coversTo?: string | null;
    ownerName?: string | null;
  },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('evidence').insert({
    centre_id: centreId,
    criterion_id: input.criterionId,
    kind: input.kind,
    title: input.title.trim(),
    detail: input.detail?.trim() || null,
    location: input.location?.trim() || null,
    covers_from: input.coversFrom || null,
    covers_to: input.coversTo || null,
    owner_name: input.ownerName?.trim() || null,
    added_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(`addEvidence: ${error.message}`);
}

export async function archiveEvidence(db: Db, evidenceId: string): Promise<void> {
  const { error } = await db
    .from('evidence')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', evidenceId);
  if (error) throw new Error(`archiveEvidence: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Ratio history
// ---------------------------------------------------------------------------

/**
 * Replay one day's ratio from the raw events.
 *
 * Fetches by an explicit UTC window rather than filtering on a date, because "a day" is
 * a local concept and the events are instants. The caller works out the window from the
 * centre's timezone; getting that wrong shifts a whole day's evidence by twelve hours.
 */
export async function readDayRatio(
  db: Db,
  input: {
    centreId: string;
    date: string;
    fromUtc: string;
    toUtc: string;
    /**
     * Which source this centre's adult numbers come from — `centres.ratio_source`.
     *
     * Passed in rather than read here, and required rather than defaulted, because
     * the caller already holds the centre and because the compiler is the only thing
     * that can stop a future reader silently printing a binder that says "figures
     * entered by staff" over numbers nobody typed. See 0040.
     */
    adultSource: AdultSource;
  },
): Promise<DayReplay> {
  const derived = input.adultSource === 'derived';

  const [attendance, adults, children, staffAttendance] = await Promise.all([
    db
      .from('attendance_events')
      // `id, corrects` are load-bearing: without them the replay cannot tell a superseded event
      // from a live one, and a corrected sign-out kept hiding real breaches from the binder. The
      // funding reader in billing.ts has always selected them; this one did not, so two readers of
      // one append-only table disagreed about which rows were live.
      .select('id, child_id, kind, at, corrects, children!inner(centre_id)')
      .eq('children.centre_id', input.centreId)
      .gte('at', input.fromUtc)
      .lt('at', input.toUtc)
      .order('at'),
    db
      .from('staff_count_events')
      .select('adults, at')
      .eq('centre_id', input.centreId)
      .gte('at', input.fromUtc)
      .lt('at', input.toUtc)
      .order('at'),
    // Archived children included: a report about February must count a child who left
    // in March, or the historical roll shrinks every time somebody leaves.
    db.from('children').select('id, date_of_birth').eq('centre_id', input.centreId),
    /*
      Only fetched for a derived centre, and that is not an optimisation.
      `staff_attendance_events` is joined to its centre through `staff_members`, so a
      declared centre would be issuing a query whose result it must then ignore — and
      the temptation to "use it if it happens to be there" is exactly the blending
      0040 forbids. Not fetching it makes the rule structural.
    */
    derived
      ? db
          .from('staff_attendance_events')
          .select('id, staff_member_id, kind, at, corrects, staff_members!inner(centre_id)')
          .eq('staff_members.centre_id', input.centreId)
          .gte('at', input.fromUtc)
          .lt('at', input.toUtc)
          .order('at')
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attendance.error) throw new Error(`readDayRatio (attendance): ${attendance.error.message}`);
  if (adults.error) throw new Error(`readDayRatio (adults): ${adults.error.message}`);
  if (children.error) throw new Error(`readDayRatio (children): ${children.error.message}`);
  if (staffAttendance.error) {
    throw new Error(`readDayRatio (staff attendance): ${staffAttendance.error.message}`);
  }

  /**
   * The adult count in force when the day began.
   *
   * The last count recorded *before* this window, because a centre that set the number
   * at 7:30 and did not touch it again has no event inside a window starting at 8:00 —
   * and defaulting to zero would manufacture a breach for the first hour of every day.
   */
  const { data: opening } = await db
    .from('staff_count_events')
    .select('adults')
    .eq('centre_id', input.centreId)
    .lt('at', input.fromUtc)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return replayDay({
    date: input.date,
    attendance: (
      attendance.data as {
        id: number;
        child_id: string;
        kind: 'in' | 'out';
        at: string;
        corrects: number | null;
      }[]
    ).map((r) => ({
      id: r.id,
      childId: r.child_id,
      kind: r.kind,
      at: r.at,
      corrects: r.corrects,
    })),
    /*
      One source or the other, chosen by the centre — never both, and never a
      fallback from one to the other. A derived centre with nobody signed in replays
      zero adults and shows a breach, which is the point of switching: it makes the
      missing sign-ins visible instead of papering over them with a typed number.
    */
    adultCounts: derived
      ? deriveAdultCounts(
          (
            staffAttendance.data as {
              id: number;
              staff_member_id: string;
              kind: 'in' | 'out';
              at: string;
              corrects: number | null;
            }[]
          ).map((r) => ({
            id: r.id,
            staffMemberId: r.staff_member_id,
            kind: r.kind,
            at: r.at,
            corrects: r.corrects,
          })),
        )
      : (adults.data as { adults: number; at: string }[]).map((r) => ({
          adults: r.adults,
          at: r.at,
        })),
    adultSource: input.adultSource,
    children: (children.data as { id: string; date_of_birth: string }[]).map((r) => ({
      id: r.id,
      dateOfBirth: r.date_of_birth,
    })),
    openingAdults: (opening as { adults: number } | null)?.adults ?? 0,
  });
}
