/**
 * The daily registers: incidents, medicine given, sleep checks.
 *
 * As everywhere in this package, no tenant or guardianship filtering. 0030–0033 hold
 * the boundary, and it is not the same boundary for all three: a guardian reads a
 * *final* incident and never a draft, and reads medication and sleep records without
 * qualification. Adding a filter here would imply the filter is what keeps a family
 * out of a half-written injury report. It is not — the policy is.
 *
 * WHY EVERY LIST HERE IS PAGED
 *
 * Sleep checks are the densest write in the product. A licensed roll of 65 with
 * under-2s sleeping two hours on a ten-minute interval is well over two thousand rows
 * for one day at one centre, and PostgREST truncates at a thousand *and reports no
 * error*. An unpaged read would silently drop the oldest checks of the day, which is
 * the half a reviewer asks about. See `reading-every-row.md`.
 */

import {
  type Incident,
  type IncidentInvestigation,
  type IncidentKind,
  type MedicationAdministration,
  type SleepCheck,
  type SleepPosition,
} from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

// One string literal, not a concatenation. `supabase-js` infers the row type from the
// literal text of the select, so `'a, b' + 'c'` degrades the result to
// `GenericStringError[]` and every downstream cast becomes a lie the compiler accepts.
// Costs one long line; buys the return type.
const INCIDENT_COLUMNS =
  'id, centre_id, child_id, kind, occurred_at, location, room_id, description, first_aid_given, treated_by, witness_name, reported_by, status, parent_notified_at, notified_by, acknowledged_at, acknowledged_by, supersedes';

interface IncidentRow {
  id: string;
  centre_id: string;
  child_id: string;
  kind: IncidentKind;
  occurred_at: string;
  location: string | null;
  room_id: string | null;
  description: string;
  first_aid_given: string | null;
  treated_by: string | null;
  witness_name: string | null;
  reported_by: string | null;
  status: 'draft' | 'final';
  parent_notified_at: string | null;
  notified_by: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  supersedes: string | null;
}

const toIncident = (r: IncidentRow): Incident => ({
  id: r.id,
  centreId: r.centre_id,
  childId: r.child_id,
  kind: r.kind,
  occurredAt: r.occurred_at,
  location: r.location,
  roomId: r.room_id,
  description: r.description,
  firstAidGiven: r.first_aid_given,
  treatedBy: r.treated_by,
  witnessName: r.witness_name,
  reportedBy: r.reported_by,
  status: r.status,
  parentNotifiedAt: r.parent_notified_at,
  notifiedBy: r.notified_by,
  acknowledgedAt: r.acknowledged_at,
  acknowledgedBy: r.acknowledged_by,
  supersedes: r.supersedes,
});

/**
 * The centre's register over a window.
 *
 * `from` and `to` are instants, not local dates, because the caller has already
 * resolved the centre's day — `dayWindow()` in the web app, or `centre_day_start` in
 * SQL. Taking dates here would mean resolving a zone in the query layer, which is
 * where the timezone bugs in `conventions.md` all came from.
 */
export async function listIncidents(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<Incident[]> {
  const rows = await fetchAll<IncidentRow>('listIncidents', (a, b) =>
    db
      .from('incidents')
      .select(INCIDENT_COLUMNS)
      .eq('centre_id', centreId)
      .gte('occurred_at', from)
      .lte('occurred_at', to)
      .order('occurred_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toIncident);
}

/** One child's incidents. What a parent sees, and what goes in a transition record. */
export async function listChildIncidents(db: Db, childId: string): Promise<Incident[]> {
  const rows = await fetchAll<IncidentRow>('listChildIncidents', (a, b) =>
    db
      .from('incidents')
      .select(INCIDENT_COLUMNS)
      .eq('child_id', childId)
      .order('occurred_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toIncident);
}

export interface OpenIncidentInput {
  centreId: string;
  childId: string;
  kind: IncidentKind;
  occurredAt: string;
  description: string;
  location?: string | null;
  roomId?: string | null;
  firstAidGiven?: string | null;
  witnessName?: string | null;
  /** Set only when this is an amendment to an incident that has been finalised. */
  supersedes?: string | null;
}

/**
 * Open a draft.
 *
 * Always a draft, and there is no argument to make it otherwise. A form that could
 * post straight to `final` is a form somebody submits half-written from a phone in
 * one hand while holding a crying child in the other — and final is the version the
 * family sees and cannot be edited afterwards.
 */
export async function openIncident(db: Db, input: OpenIncidentInput): Promise<Incident> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('incidents')
    .insert({
      centre_id: input.centreId,
      child_id: input.childId,
      kind: input.kind,
      occurred_at: input.occurredAt,
      description: input.description.trim(),
      location: input.location?.trim() || null,
      room_id: input.roomId ?? null,
      first_aid_given: input.firstAidGiven?.trim() || null,
      witness_name: input.witnessName?.trim() || null,
      supersedes: input.supersedes ?? null,
      reported_by: auth.user?.id ?? null,
      status: 'draft',
    })
    .select(INCIDENT_COLUMNS)
    .single();
  if (error) throw new Error(`openIncident: ${error.message}`);
  return toIncident(data as IncidentRow);
}

/**
 * Edit a draft. Refused by the trigger once final, which is the point.
 *
 * Deliberately does not accept `status`: finalising is `finaliseIncident`, because a
 * generic patch that happens to include a status is how a report gets sent to a
 * family as a side effect of fixing a typo.
 */
export async function updateIncidentDraft(
  db: Db,
  id: string,
  patch: {
    kind?: IncidentKind;
    occurredAt?: string;
    description?: string;
    location?: string | null;
    roomId?: string | null;
    firstAidGiven?: string | null;
    witnessName?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.occurredAt !== undefined) row.occurred_at = patch.occurredAt;
  if (patch.description !== undefined) row.description = patch.description.trim();
  if (patch.location !== undefined) row.location = patch.location?.trim() || null;
  if (patch.roomId !== undefined) row.room_id = patch.roomId;
  if (patch.firstAidGiven !== undefined) row.first_aid_given = patch.firstAidGiven?.trim() || null;
  if (patch.witnessName !== undefined) row.witness_name = patch.witnessName?.trim() || null;
  if (Object.keys(row).length === 0) return;

  /*
   * ZERO-ROW CHECK, added 2026-09-03, and it was missing here for the whole life of the
   * feature.
   *
   * Under RLS a refused UPDATE matches no rows, and PostgREST reports that as **success
   * with an empty result** — so without this, `error` is null, this function returns, the
   * action calls `revalidatePath`, and the screen tells somebody their correction was
   * saved while the record is unchanged. On an incident report.
   *
   * The same check is on `updateCentre`, `updateStaffMember` and `linkStaffRecord`, each
   * with a comment saying why. It was not on the two incident writers, which is how the
   * e2e suite came to be asserting a row that never changed — found 2026-09-03 when the
   * suite could run again after six days of timing out.
   */
  const { data, error } = await db.from('incidents').update(row).eq('id', id).select('id');
  if (error) throw new Error(`updateIncidentDraft: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'updateIncidentDraft: nothing was updated. Either the id is wrong or the policy refused it — a draft that has been finalised cannot be corrected in place.',
    );
  }
}

/** Draft to final. One way, enforced in the database, and the family can now read it. */
export async function finaliseIncident(db: Db, id: string): Promise<void> {
  // Same reasoning as above, and the consequence here is worse: a silent no-op would
  // leave a report the centre believes it has finalised sitting as a draft the family
  // cannot see.
  const { data, error } = await db
    .from('incidents')
    .update({ status: 'final' })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`finaliseIncident: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'finaliseIncident: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

/**
 * Record that the family was told, and when.
 *
 * Separate from the acknowledgement below and never inferred from it. "We told them"
 * and "they said they had been told" are two claims, and a review asks about both —
 * a centre that can only show the second has no record of its own conduct.
 */
export async function recordParentNotified(db: Db, id: string, at: string): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db
    .from('incidents')
    .update({ parent_notified_at: at, notified_by: auth.user?.id ?? null })
    .eq('id', id);
  if (error) throw new Error(`recordParentNotified: ${error.message}`);
}

/**
 * The guardian's own acknowledgement.
 *
 * `guardianId` is the caller's own guardian record — the trigger refuses anything
 * else, and refuses this from staff entirely. Passed explicitly rather than resolved
 * here because a caller can be a guardian at more than one centre.
 */
export async function acknowledgeIncident(
  db: Db,
  id: string,
  guardianId: string,
  at: string,
): Promise<void> {
  const { error } = await db
    .from('incidents')
    .update({ acknowledged_at: at, acknowledged_by: guardianId })
    .eq('id', id);
  if (error) throw new Error(`acknowledgeIncident: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Incident investigations (0074)
// ---------------------------------------------------------------------------

const INVESTIGATION_COLUMNS =
  'id, centre_id, incident_id, required, investigated_on, investigated_by, worksafe_advised, worksafe_advised_on, hazard_id, medical_followup, agency_contacted, outcome, notes';

interface InvestigationRow {
  id: string;
  centre_id: string;
  incident_id: string;
  required: boolean;
  investigated_on: string | null;
  investigated_by: string | null;
  worksafe_advised: boolean | null;
  worksafe_advised_on: string | null;
  hazard_id: string | null;
  medical_followup: string | null;
  agency_contacted: string | null;
  outcome: string | null;
  notes: string | null;
}

const toInvestigation = (r: InvestigationRow): IncidentInvestigation => ({
  id: r.id,
  centreId: r.centre_id,
  incidentId: r.incident_id,
  required: r.required,
  investigatedOn: r.investigated_on,
  investigatedBy: r.investigated_by,
  worksafeAdvised: r.worksafe_advised,
  worksafeAdvisedOn: r.worksafe_advised_on,
  hazardId: r.hazard_id,
  medicalFollowup: r.medical_followup,
  agencyContacted: r.agency_contacted,
  outcome: r.outcome,
  notes: r.notes,
});

/** One incident's investigation, or null when nobody has considered one. */
export async function getIncidentInvestigation(
  db: Db,
  incidentId: string,
): Promise<IncidentInvestigation | null> {
  const { data, error } = await db
    .from('incident_investigations')
    .select(INVESTIGATION_COLUMNS)
    .eq('incident_id', incidentId)
    .maybeSingle();
  if (error) throw new Error(`getIncidentInvestigation: ${error.message}`);
  return data ? toInvestigation(data as InvestigationRow) : null;
}

export interface InvestigationPatch {
  required?: boolean;
  investigatedOn?: string | null;
  investigatedBy?: string | null;
  worksafeAdvised?: boolean | null;
  worksafeAdvisedOn?: string | null;
  hazardId?: string | null;
  medicalFollowup?: string | null;
  agencyContacted?: string | null;
  outcome?: string | null;
  notes?: string | null;
}

const investigationPatchRow = (patch: InvestigationPatch): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  if (patch.required !== undefined) row.required = patch.required;
  if (patch.investigatedOn !== undefined) row.investigated_on = patch.investigatedOn;
  if (patch.investigatedBy !== undefined) row.investigated_by = patch.investigatedBy;
  if (patch.worksafeAdvised !== undefined) row.worksafe_advised = patch.worksafeAdvised;
  if (patch.worksafeAdvisedOn !== undefined) row.worksafe_advised_on = patch.worksafeAdvisedOn;
  if (patch.hazardId !== undefined) row.hazard_id = patch.hazardId;
  if (patch.medicalFollowup !== undefined) row.medical_followup = patch.medicalFollowup?.trim() || null;
  if (patch.agencyContacted !== undefined) row.agency_contacted = patch.agencyContacted?.trim() || null;
  if (patch.outcome !== undefined) row.outcome = patch.outcome?.trim() || null;
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
  return row;
};

/**
 * Record the decision. `required` is mandatory here as in the schema — the row IS
 * the decision, and a row that omitted it would record that a form was opened.
 *
 * Not an upsert, deliberately: `incident_id` is absent from the UPDATE grant, and
 * `ON CONFLICT DO UPDATE` writes every supplied column, so an upsert would be
 * refused by Postgres on the privilege check. Create once, then patch.
 */
export async function createIncidentInvestigation(
  db: Db,
  input: { centreId: string; incidentId: string; required: boolean } & InvestigationPatch,
): Promise<IncidentInvestigation> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('incident_investigations')
    .insert({
      centre_id: input.centreId,
      incident_id: input.incidentId,
      required: input.required,
      ...investigationPatchRow(input),
      created_by: auth.user?.id ?? null,
    })
    .select(INVESTIGATION_COLUMNS)
    .single();
  if (error) throw new Error(`createIncidentInvestigation: ${error.message}`);
  return toInvestigation(data as InvestigationRow);
}

export async function updateIncidentInvestigation(
  db: Db,
  id: string,
  patch: InvestigationPatch,
): Promise<void> {
  const row = investigationPatchRow(patch);
  if (Object.keys(row).length === 0) return;
  const { error } = await db.from('incident_investigations').update(row).eq('id', id);
  if (error) throw new Error(`updateIncidentInvestigation: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Medication given
// ---------------------------------------------------------------------------

const DOSE_COLUMNS =
  'id, authority_id, child_id, given_at, dose_given, given_by, witnessed_by, corrects, note';

interface DoseRow {
  id: number;
  authority_id: string;
  child_id: string;
  given_at: string;
  dose_given: string;
  given_by: string | null;
  witnessed_by: string | null;
  corrects: number | null;
  note: string | null;
}

const toDose = (r: DoseRow): MedicationAdministration => ({
  id: r.id,
  authorityId: r.authority_id,
  childId: r.child_id,
  givenAt: r.given_at,
  doseGiven: r.dose_given,
  givenBy: r.given_by,
  witnessedBy: r.witnessed_by,
  corrects: r.corrects,
  note: r.note,
});

export async function listAdministrations(
  db: Db,
  childId: string,
): Promise<MedicationAdministration[]> {
  const rows = await fetchAll<DoseRow>('listAdministrations', (a, b) =>
    db
      .from('medication_administrations')
      .select(DOSE_COLUMNS)
      .eq('child_id', childId)
      .order('given_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toDose);
}

export type RecordOutcome = 'recorded' | 'duplicate';

export interface RecordDoseInput {
  authorityId: string;
  childId: string;
  givenAt: string;
  doseGiven: string;
  /** Generated before the first attempt and reused on every retry. Never regenerated. */
  clientUuid: string;
  witnessedBy?: string | null;
  corrects?: number | null;
  note?: string | null;
}

/**
 * Record a dose.
 *
 * `ignoreDuplicates` rather than a plain upsert, and that is a privilege decision as
 * much as a semantic one: this table grants INSERT and not UPDATE, so a real upsert
 * fails with 42501 before any constraint is evaluated — the trap written up in
 * `conventions.md`. `ON CONFLICT DO NOTHING` needs only INSERT.
 *
 * A repeated key means this exact dose already landed. That is not an error and must
 * not be reported as one: the alternative is a teacher, told the write failed,
 * giving the medicine a second time.
 */
export async function recordAdministration(
  db: Db,
  input: RecordDoseInput,
): Promise<{ outcome: RecordOutcome; dose?: MedicationAdministration }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('medication_administrations')
    .upsert(
      {
        authority_id: input.authorityId,
        child_id: input.childId,
        given_at: input.givenAt,
        dose_given: input.doseGiven.trim(),
        given_by: auth.user?.id ?? null,
        witnessed_by: input.witnessedBy ?? null,
        client_uuid: input.clientUuid,
        corrects: input.corrects ?? null,
        note: input.note?.trim() || null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select(DOSE_COLUMNS);
  if (error) throw new Error(`recordAdministration: ${error.message}`);

  const rows = (data ?? []) as DoseRow[];
  if (rows.length === 0) return { outcome: 'duplicate' };
  return { outcome: 'recorded', dose: toDose(rows[0]!) };
}

// ---------------------------------------------------------------------------
// Sleep checks
// ---------------------------------------------------------------------------

const SLEEP_COLUMNS =
  'id, child_id, at, observed_position, breathing_observed, checked_by, corrects, note';

interface SleepRow {
  id: number;
  child_id: string;
  at: string;
  observed_position: SleepPosition;
  breathing_observed: boolean;
  checked_by: string | null;
  corrects: number | null;
  note: string | null;
}

const toSleepCheck = (r: SleepRow): SleepCheck => ({
  id: r.id,
  childId: r.child_id,
  at: r.at,
  observedPosition: r.observed_position,
  breathingObserved: r.breathing_observed,
  checkedBy: r.checked_by,
  corrects: r.corrects,
  note: r.note,
});

/**
 * Every check in a window, for the children named.
 *
 * Scoped by child rather than by centre because `sleep_checks` carries no
 * `centre_id` — it reaches its centre through the child, exactly as
 * `medication_authorities` does, and the policy resolves that. The caller already
 * holds the roll.
 */
export async function listSleepChecks(
  db: Db,
  childIds: string[],
  from: string,
  to: string,
): Promise<SleepCheck[]> {
  if (childIds.length === 0) return [];
  const rows = await fetchAll<SleepRow>('listSleepChecks', (a, b) =>
    db
      .from('sleep_checks')
      .select(SLEEP_COLUMNS)
      .in('child_id', childIds)
      .gte('at', from)
      .lte('at', to)
      .order('at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toSleepCheck);
}

export interface RecordSleepCheckInput {
  childId: string;
  at: string;
  observedPosition: SleepPosition;
  breathingObserved: boolean;
  clientUuid: string;
  corrects?: number | null;
  note?: string | null;
}

/** Same idempotency contract as attendance and medication, for the same reason. */
export async function recordSleepCheck(
  db: Db,
  input: RecordSleepCheckInput,
): Promise<{ outcome: RecordOutcome; check?: SleepCheck }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('sleep_checks')
    .upsert(
      {
        child_id: input.childId,
        at: input.at,
        observed_position: input.observedPosition,
        breathing_observed: input.breathingObserved,
        checked_by: auth.user?.id ?? null,
        client_uuid: input.clientUuid,
        corrects: input.corrects ?? null,
        note: input.note?.trim() || null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select(SLEEP_COLUMNS);
  if (error) throw new Error(`recordSleepCheck: ${error.message}`);

  const rows = (data ?? []) as SleepRow[];
  if (rows.length === 0) return { outcome: 'duplicate' };
  return { outcome: 'recorded', check: toSleepCheck(rows[0]!) };
}
