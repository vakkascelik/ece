/**
 * Reads and writes for the Phase 9 registers.
 *
 * As everywhere in this package, no tenant filtering: 0034–0037 hold the boundary,
 * and it differs per table. Drills, hazards, safety checks, visitors and the outing
 * itself are staff-only and centre-scoped; a child's place on an outing, the consents
 * for it, and an immunisation record are guardianship-scoped. Filtering here would
 * imply the filter is what keeps a parent out of the hazard register.
 *
 * Every column list is one string literal. `supabase-js` infers the row type from the
 * literal text of the select, so a concatenation degrades the result to
 * `GenericStringError[]` and every cast after it becomes a lie the compiler accepts —
 * written up in `conventions.md` after it cost an afternoon.
 */

import type {
  Drill,
  DrillKind,
  Excursion,
  ExcursionConsent,
  ExcursionStatus,
  Hazard,
  HazardRisk,
  Headcount,
  ImmunisationRecord,
  ImmunisationStatus,
  SafetyArea,
  SafetyCheck,
  Visitor,
} from '@ece/core';
import { fetchAll } from './paging';
// The idempotency outcome is declared once, in the module that established the
// contract. Two identical type aliases exported from one package is an ambiguity
// TypeScript refuses outright, which is the correct amount of tolerance for it.
import type { RecordOutcome } from './registers';
import type { Db } from './index';

export type { RecordOutcome };

// ---------------------------------------------------------------------------
// Drills
// ---------------------------------------------------------------------------

const DRILL_COLUMNS =
  'id, centre_id, kind, held_at, duration_seconds, adults_present, children_present, notes, issues_found, recorded_by';

interface DrillRow {
  id: string;
  centre_id: string;
  kind: DrillKind;
  held_at: string;
  duration_seconds: number | null;
  adults_present: number | null;
  children_present: number | null;
  notes: string | null;
  issues_found: string | null;
  recorded_by: string | null;
}

const toDrill = (r: DrillRow): Drill => ({
  id: r.id,
  centreId: r.centre_id,
  kind: r.kind,
  heldAt: r.held_at,
  durationSeconds: r.duration_seconds,
  adultsPresent: r.adults_present,
  childrenPresent: r.children_present,
  notes: r.notes,
  issuesFound: r.issues_found,
  recordedBy: r.recorded_by,
});

export async function listDrills(db: Db, centreId: string): Promise<Drill[]> {
  const rows = await fetchAll<DrillRow>('listDrills', (a, b) =>
    db
      .from('drills')
      .select(DRILL_COLUMNS)
      .eq('centre_id', centreId)
      .order('held_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toDrill);
}

export async function recordDrill(
  db: Db,
  input: {
    centreId: string;
    kind: DrillKind;
    heldAt: string;
    durationSeconds?: number | null;
    adultsPresent?: number | null;
    childrenPresent?: number | null;
    notes?: string | null;
    issuesFound?: string | null;
  },
): Promise<Drill> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('drills')
    .insert({
      centre_id: input.centreId,
      kind: input.kind,
      held_at: input.heldAt,
      duration_seconds: input.durationSeconds ?? null,
      adults_present: input.adultsPresent ?? null,
      children_present: input.childrenPresent ?? null,
      notes: input.notes?.trim() || null,
      issues_found: input.issuesFound?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(DRILL_COLUMNS)
    .single();
  if (error) throw new Error(`recordDrill: ${error.message}`);
  return toDrill(data as DrillRow);
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

const HAZARD_COLUMNS =
  'id, centre_id, description, area, room_id, risk, control, identified_at, identified_by, reviewed_at, resolved_at, resolution, likelihood, consequence, risk_score, review_interval_days';

interface HazardRow {
  id: string;
  centre_id: string;
  description: string;
  area: string | null;
  room_id: string | null;
  risk: HazardRisk;
  control: string | null;
  identified_at: string;
  identified_by: string | null;
  reviewed_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  likelihood: number | null;
  consequence: number | null;
  /** Generated in Postgres. Read-only: nobody can write it, service_role included. */
  risk_score: number | null;
  review_interval_days: number | null;
}

const toHazard = (r: HazardRow): Hazard => ({
  id: r.id,
  centreId: r.centre_id,
  description: r.description,
  area: r.area,
  risk: r.risk,
  control: r.control,
  identifiedAt: r.identified_at,
  identifiedBy: r.identified_by,
  reviewedAt: r.reviewed_at,
  resolvedAt: r.resolved_at,
  resolution: r.resolution,
  roomId: r.room_id,
  likelihood: r.likelihood,
  consequence: r.consequence,
  riskScore: r.risk_score,
  reviewIntervalDays: r.review_interval_days,
});

export async function listHazards(db: Db, centreId: string): Promise<Hazard[]> {
  const rows = await fetchAll<HazardRow>('listHazards', (a, b) =>
    db
      .from('hazards')
      .select(HAZARD_COLUMNS)
      .eq('centre_id', centreId)
      .order('identified_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toHazard);
}

export async function recordHazard(
  db: Db,
  input: {
    centreId: string;
    description: string;
    risk: HazardRisk;
    area?: string | null;
    roomId?: string | null;
    control?: string | null;
    likelihood?: number | null;
    consequence?: number | null;
    reviewIntervalDays?: number | null;
  },
): Promise<Hazard> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('hazards')
    .insert({
      centre_id: input.centreId,
      description: input.description.trim(),
      risk: input.risk,
      area: input.area?.trim() || null,
      room_id: input.roomId ?? null,
      control: input.control?.trim() || null,
      // `risk_score` is generated and is deliberately absent: writing it is refused
      // by Postgres, which is the correct privilege for a derived value.
      likelihood: input.likelihood ?? null,
      consequence: input.consequence ?? null,
      review_interval_days: input.reviewIntervalDays ?? null,
      identified_by: auth.user?.id ?? null,
    })
    .select(HAZARD_COLUMNS)
    .single();
  if (error) throw new Error(`recordHazard: ${error.message}`);
  return toHazard(data as HazardRow);
}

/**
 * Update a hazard: write a control, mark it reviewed, or close it.
 *
 * Closing needs both `resolvedAt` and `resolution` — the CHECK in 0034 refuses one
 * without the other, and this does not re-implement that. It exists so the caller
 * can express the three acts separately rather than through a generic patch.
 */
export async function updateHazard(
  db: Db,
  id: string,
  patch: {
    control?: string | null;
    risk?: HazardRisk;
    roomId?: string | null;
    reviewedAt?: string | null;
    resolvedAt?: string | null;
    resolution?: string | null;
    likelihood?: number | null;
    consequence?: number | null;
    reviewIntervalDays?: number | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.control !== undefined) row.control = patch.control?.trim() || null;
  if (patch.risk !== undefined) row.risk = patch.risk;
  if (patch.roomId !== undefined) row.room_id = patch.roomId;
  if (patch.likelihood !== undefined) row.likelihood = patch.likelihood;
  if (patch.consequence !== undefined) row.consequence = patch.consequence;
  if (patch.reviewIntervalDays !== undefined) row.review_interval_days = patch.reviewIntervalDays;
  if (patch.reviewedAt !== undefined) row.reviewed_at = patch.reviewedAt;
  if (patch.resolvedAt !== undefined) row.resolved_at = patch.resolvedAt;
  if (patch.resolution !== undefined) row.resolution = patch.resolution?.trim() || null;
  if (Object.keys(row).length === 0) return;

  // `.select()` and a zero-row check, for the reason written up on `updateCentre`:
  // a PostgREST UPDATE that matches nothing returns `error: null`, and under RLS
  // that is exactly what a refusal looks like.
  const { data, error } = await db.from('hazards').update(row).eq('id', id).select('id');
  if (error) throw new Error(`updateHazard: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('updateHazard: no hazard was updated. Either the id is wrong or the policy refused it.');
  }
}

// ---------------------------------------------------------------------------
// Safety checks
// ---------------------------------------------------------------------------

const SAFETY_COLUMNS = 'id, centre_id, area, at, passed, note, checked_by';

interface SafetyRow {
  id: number;
  centre_id: string;
  area: SafetyArea;
  at: string;
  passed: boolean;
  note: string | null;
  checked_by: string | null;
}

const toSafetyCheck = (r: SafetyRow): SafetyCheck => ({
  id: r.id,
  centreId: r.centre_id,
  area: r.area,
  at: r.at,
  passed: r.passed,
  note: r.note,
  checkedBy: r.checked_by,
});

export async function listSafetyChecks(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<SafetyCheck[]> {
  const rows = await fetchAll<SafetyRow>('listSafetyChecks', (a, b) =>
    db
      .from('safety_checks')
      .select(SAFETY_COLUMNS)
      .eq('centre_id', centreId)
      .gte('at', from)
      .lte('at', to)
      .order('at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toSafetyCheck);
}

/** Same idempotency contract as every other register write. */
export async function recordSafetyCheck(
  db: Db,
  input: {
    centreId: string;
    area: SafetyArea;
    at: string;
    passed: boolean;
    clientUuid: string;
    note?: string | null;
  },
): Promise<{ outcome: RecordOutcome }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('safety_checks')
    .upsert(
      {
        centre_id: input.centreId,
        area: input.area,
        at: input.at,
        passed: input.passed,
        note: input.note?.trim() || null,
        checked_by: auth.user?.id ?? null,
        client_uuid: input.clientUuid,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`recordSafetyCheck: ${error.message}`);
  return { outcome: (data ?? []).length === 0 ? 'duplicate' : 'recorded' };
}

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------

const VISITOR_COLUMNS =
  'id, centre_id, full_name, organisation, purpose, visiting, signed_in_at, signed_out_at, recorded_by';

interface VisitorRow {
  id: string;
  centre_id: string;
  full_name: string;
  organisation: string | null;
  purpose: string | null;
  visiting: string | null;
  signed_in_at: string;
  signed_out_at: string | null;
  recorded_by: string | null;
}

const toVisitor = (r: VisitorRow): Visitor => ({
  id: r.id,
  centreId: r.centre_id,
  fullName: r.full_name,
  organisation: r.organisation,
  purpose: r.purpose,
  visiting: r.visiting,
  signedInAt: r.signed_in_at,
  signedOutAt: r.signed_out_at,
  recordedBy: r.recorded_by,
});

export async function listVisitors(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<Visitor[]> {
  const rows = await fetchAll<VisitorRow>('listVisitors', (a, b) =>
    db
      .from('visitors')
      .select(VISITOR_COLUMNS)
      .eq('centre_id', centreId)
      .gte('signed_in_at', from)
      .lte('signed_in_at', to)
      .order('signed_in_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toVisitor);
}

export async function signInVisitor(
  db: Db,
  input: {
    centreId: string;
    fullName: string;
    signedInAt: string;
    organisation?: string | null;
    purpose?: string | null;
    visiting?: string | null;
  },
): Promise<Visitor> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('visitors')
    .insert({
      centre_id: input.centreId,
      full_name: input.fullName.trim(),
      signed_in_at: input.signedInAt,
      organisation: input.organisation?.trim() || null,
      purpose: input.purpose?.trim() || null,
      visiting: input.visiting?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(VISITOR_COLUMNS)
    .single();
  if (error) throw new Error(`signInVisitor: ${error.message}`);
  return toVisitor(data as VisitorRow);
}

export async function signOutVisitor(db: Db, id: string, at: string): Promise<void> {
  const { data, error } = await db
    .from('visitors')
    .update({ signed_out_at: at })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`signOutVisitor: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('signOutVisitor: no visitor was updated. Either the id is wrong or the policy refused it.');
  }
}

// ---------------------------------------------------------------------------
// Excursions
// ---------------------------------------------------------------------------

const EXCURSION_COLUMNS =
  'id, centre_id, destination, purpose, departs_at, returns_at, transport, plan, adults_attending, status, departed_at, returned_at';

interface ExcursionRow {
  id: string;
  centre_id: string;
  destination: string;
  purpose: string | null;
  departs_at: string;
  returns_at: string | null;
  transport: string | null;
  plan: string | null;
  adults_attending: number | null;
  status: ExcursionStatus;
  departed_at: string | null;
  returned_at: string | null;
}

const toExcursion = (r: ExcursionRow): Excursion => ({
  id: r.id,
  centreId: r.centre_id,
  destination: r.destination,
  purpose: r.purpose,
  departsAt: r.departs_at,
  returnsAt: r.returns_at,
  transport: r.transport,
  plan: r.plan,
  adultsAttending: r.adults_attending,
  status: r.status,
  departedAt: r.departed_at,
  returnedAt: r.returned_at,
});

export async function listExcursions(db: Db, centreId: string): Promise<Excursion[]> {
  const rows = await fetchAll<ExcursionRow>('listExcursions', (a, b) =>
    db
      .from('excursions')
      .select(EXCURSION_COLUMNS)
      .eq('centre_id', centreId)
      .order('departs_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toExcursion);
}

export async function createExcursion(
  db: Db,
  input: {
    centreId: string;
    destination: string;
    departsAt: string;
    returnsAt?: string | null;
    purpose?: string | null;
    transport?: string | null;
    plan?: string | null;
    adultsAttending?: number | null;
  },
): Promise<Excursion> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('excursions')
    .insert({
      centre_id: input.centreId,
      destination: input.destination.trim(),
      departs_at: input.departsAt,
      returns_at: input.returnsAt ?? null,
      purpose: input.purpose?.trim() || null,
      transport: input.transport?.trim() || null,
      plan: input.plan?.trim() || null,
      adults_attending: input.adultsAttending ?? null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(EXCURSION_COLUMNS)
    .single();
  if (error) throw new Error(`createExcursion: ${error.message}`);
  return toExcursion(data as ExcursionRow);
}

/**
 * Move an outing between states.
 *
 * The departure gate lives in the trigger in 0037 and is not re-implemented here.
 * This function's job is to send the transition and let the database refuse it; the
 * caller turns that refusal into a sentence, having already computed *which* children
 * are missing consent from data it holds.
 */
export async function setExcursionStatus(
  db: Db,
  id: string,
  status: ExcursionStatus,
  at: string,
): Promise<void> {
  const row: Record<string, unknown> = { status };
  if (status === 'departed') row.departed_at = at;
  if (status === 'returned') row.returned_at = at;
  if (status === 'planned' || status === 'cancelled') {
    row.departed_at = null;
    row.returned_at = null;
  }

  const { data, error } = await db.from('excursions').update(row).eq('id', id).select('id');
  if (error) throw new Error(`setExcursionStatus: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('setExcursionStatus: no outing was updated. Either the id is wrong or the policy refused it.');
  }
}

export async function listExcursionChildren(db: Db, excursionId: string): Promise<string[]> {
  const rows = await fetchAll<{ child_id: string }>('listExcursionChildren', (a, b) =>
    db.from('excursion_children').select('child_id').eq('excursion_id', excursionId).range(a, b),
  );
  return rows.map((r) => r.child_id);
}

export async function addChildToExcursion(
  db: Db,
  excursionId: string,
  childId: string,
): Promise<void> {
  const { error } = await db
    .from('excursion_children')
    .upsert({ excursion_id: excursionId, child_id: childId }, { ignoreDuplicates: true });
  if (error) throw new Error(`addChildToExcursion: ${error.message}`);
}

export async function removeChildFromExcursion(
  db: Db,
  excursionId: string,
  childId: string,
): Promise<void> {
  const { data, error } = await db
    .from('excursion_children')
    .delete()
    .eq('excursion_id', excursionId)
    .eq('child_id', childId)
    .select('id');
  if (error) throw new Error(`removeChildFromExcursion: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'removeChildFromExcursion: nothing was removed. Either the id is wrong or the policy refused it. The child may not be on this excursion.',
    );
  }
}

const CONSENT_COLUMNS = 'id, excursion_id, child_id, granted, given_by, recorded_by, note, at';

interface ConsentRow {
  id: number;
  excursion_id: string;
  child_id: string;
  granted: boolean;
  given_by: string | null;
  recorded_by: string | null;
  note: string | null;
  at: string;
}

const toConsent = (r: ConsentRow): ExcursionConsent => ({
  id: r.id,
  excursionId: r.excursion_id,
  childId: r.child_id,
  granted: r.granted,
  givenBy: r.given_by,
  recordedBy: r.recorded_by,
  note: r.note,
  at: r.at,
});

export async function listExcursionConsents(
  db: Db,
  excursionId: string,
): Promise<ExcursionConsent[]> {
  const rows = await fetchAll<ConsentRow>('listExcursionConsents', (a, b) =>
    db
      .from('excursion_consents')
      .select(CONSENT_COLUMNS)
      .eq('excursion_id', excursionId)
      .order('at', { ascending: true })
      .range(a, b),
  );
  return rows.map(toConsent);
}

/**
 * Record a decision for this outing. Append-only: a withdrawal is another call with
 * `granted: false`, never an edit.
 *
 * `givenBy` names the guardian whose decision it is, which is not necessarily the
 * caller — staff transcribe paper forms. The policy allows that for staff and pins a
 * guardian to their own record.
 */
export async function recordExcursionConsent(
  db: Db,
  input: {
    excursionId: string;
    childId: string;
    granted: boolean;
    givenBy: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('excursion_consents').insert({
    excursion_id: input.excursionId,
    child_id: input.childId,
    granted: input.granted,
    given_by: input.givenBy,
    recorded_by: auth.user?.id ?? null,
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(`recordExcursionConsent: ${error.message}`);
}

const HEADCOUNT_COLUMNS = 'id, excursion_id, at, counted, expected, counted_by, note';

interface HeadcountRow {
  id: number;
  excursion_id: string;
  at: string;
  counted: number;
  expected: number;
  counted_by: string | null;
  note: string | null;
}

const toHeadcount = (r: HeadcountRow): Headcount => ({
  id: r.id,
  excursionId: r.excursion_id,
  at: r.at,
  counted: r.counted,
  expected: r.expected,
  countedBy: r.counted_by,
  note: r.note,
});

export async function listHeadcounts(db: Db, excursionId: string): Promise<Headcount[]> {
  const rows = await fetchAll<HeadcountRow>('listHeadcounts', (a, b) =>
    db
      .from('excursion_headcounts')
      .select(HEADCOUNT_COLUMNS)
      .eq('excursion_id', excursionId)
      .order('at', { ascending: true })
      .range(a, b),
  );
  return rows.map(toHeadcount);
}

/**
 * Record a count.
 *
 * `expected` is supplied by the caller and stored, not derived at read time: the plan
 * can change afterwards, and a count whose denominator moves cannot be read back
 * honestly. A count lower than expected is accepted — refusing it would destroy the
 * evidence that a child was briefly unaccounted for.
 */
export async function recordHeadcount(
  db: Db,
  input: {
    excursionId: string;
    at: string;
    counted: number;
    expected: number;
    clientUuid: string;
    note?: string | null;
  },
): Promise<{ outcome: RecordOutcome }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('excursion_headcounts')
    .upsert(
      {
        excursion_id: input.excursionId,
        at: input.at,
        counted: input.counted,
        expected: input.expected,
        counted_by: auth.user?.id ?? null,
        client_uuid: input.clientUuid,
        note: input.note?.trim() || null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`recordHeadcount: ${error.message}`);
  return { outcome: (data ?? []).length === 0 ? 'duplicate' : 'recorded' };
}

// ---------------------------------------------------------------------------
// Immunisation
// ---------------------------------------------------------------------------

const IMMUNISATION_COLUMNS =
  'id, child_id, status, sighted_by, sighted_at, reference, next_due_on, note, recorded_at, recorded_by, superseded_at';

interface ImmunisationRow {
  id: string;
  child_id: string;
  status: ImmunisationStatus;
  sighted_by: string | null;
  sighted_at: string | null;
  reference: string | null;
  next_due_on: string | null;
  note: string | null;
  recorded_at: string;
  recorded_by: string | null;
  superseded_at: string | null;
}

const toImmunisation = (r: ImmunisationRow): ImmunisationRecord => ({
  id: r.id,
  childId: r.child_id,
  status: r.status,
  sightedBy: r.sighted_by,
  sightedAt: r.sighted_at,
  reference: r.reference,
  nextDueOn: r.next_due_on,
  note: r.note,
  recordedAt: r.recorded_at,
  recordedBy: r.recorded_by,
  supersededAt: r.superseded_at,
});

/** Every record for a child, superseded ones included — the history is the point. */
export async function listImmunisation(db: Db, childId: string): Promise<ImmunisationRecord[]> {
  const rows = await fetchAll<ImmunisationRow>('listImmunisation', (a, b) =>
    db
      .from('immunisation_records')
      .select(IMMUNISATION_COLUMNS)
      .eq('child_id', childId)
      .order('recorded_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toImmunisation);
}

/**
 * Record what the centre was shown, superseding whatever stood before.
 *
 * Two statements rather than one, and the order matters: supersede first, then
 * insert. The other way round leaves a window in which two records are live, and a
 * reader landing in it gets an arbitrary answer to "is this child up to date".
 *
 * `sighted` is a separate flag from the status because "the family told us" and
 * "somebody looked at the certificate" are different claims, and only the second
 * survives a review.
 */
export async function recordImmunisation(
  db: Db,
  input: {
    childId: string;
    status: ImmunisationStatus;
    sighted: boolean;
    reference?: string | null;
    nextDueOn?: string | null;
    note?: string | null;
    at: string;
  },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();

  /*
   * NO ZERO-ROW CHECK — item 49, deliberately.
   *
   * This supersedes the child's current immunisation record before inserting the new one,
   * and **matches nothing the first time a child's status is ever recorded** — which is
   * every child's first record. A check here would make the common path an error.
   *
   * The insert below is what must succeed, and its failure is reported. Same shape as the
   * superseding update in `createInvitation`.
   */
  const { error: supersedeError } = await db
    .from('immunisation_records')
    .update({ superseded_at: input.at })
    .eq('child_id', input.childId)
    .is('superseded_at', null);
  if (supersedeError) throw new Error(`recordImmunisation: ${supersedeError.message}`);

  const { error } = await db.from('immunisation_records').insert({
    child_id: input.childId,
    status: input.status,
    sighted_by: input.sighted ? (auth.user?.id ?? null) : null,
    sighted_at: input.sighted ? input.at : null,
    reference: input.reference?.trim() || null,
    next_due_on: input.nextDueOn || null,
    note: input.note?.trim() || null,
    recorded_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(`recordImmunisation: ${error.message}`);
}
