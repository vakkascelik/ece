/**
 * Children, whānau, enrolment, health and consent.
 *
 * No tenant filtering and no guardianship filtering. The policies in
 * `0004_children.sql` key on both, so a parent calling `listChildren` gets their
 * own child and an educator gets the whole centre — from the same query. If a
 * call here returns fewer rows than expected, the answer is in the policy or the
 * membership, never in a missing `.eq()`.
 *
 * No audit calls either. Since `0005_audit_triggers.sql` the database records
 * every write to these tables itself, which is the point: an audit entry the query
 * layer has to remember is one that will eventually be missed.
 */

import { todayInZone } from '@ece/core';
import type {
  Child,
  ChildGuardian,
  ConsentKind,
  ConsentRequest,
  ConsentState,
  Enrolment,
  Gender,
  Guardian,
  HealthCondition,
  HealthKind,
  HealthSeverity,
  MedicationAuthority,
} from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

// ---------------------------------------------------------------------------
// Row shapes and mapping
// ---------------------------------------------------------------------------

const CHILD_COLUMNS =
  'id, centre_id, first_name, last_name, preferred_name, date_of_birth, moe_nsn, ethnicities, iwi, first_language, gender, archived_at';

interface ChildRow {
  id: string;
  centre_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string;
  moe_nsn: string | null;
  ethnicities: string[] | null;
  iwi: string | null;
  first_language: string | null;
  gender: Gender | null;
  archived_at: string | null;
}

const toChild = (r: ChildRow): Child => ({
  id: r.id,
  centreId: r.centre_id,
  firstName: r.first_name,
  lastName: r.last_name,
  preferredName: r.preferred_name,
  dateOfBirth: r.date_of_birth,
  moeNsn: r.moe_nsn,
  ethnicities: r.ethnicities ?? [],
  iwi: r.iwi,
  firstLanguage: r.first_language,
  gender: r.gender,
  archivedAt: r.archived_at,
});

const GUARDIAN_COLUMNS = 'id, centre_id, user_id, full_name, email, phone, address, archived_at';

interface GuardianRow {
  id: string;
  centre_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  archived_at: string | null;
}

const toGuardian = (r: GuardianRow): Guardian => ({
  id: r.id,
  centreId: r.centre_id,
  userId: r.user_id,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone,
  address: r.address,
  archivedAt: r.archived_at,
});

const LINK_COLUMNS =
  'id, child_id, guardian_id, relationship, is_primary, can_collect, is_emergency_contact, is_authorised_signatory, contact_priority, revoked_at';

interface LinkRow {
  id: string;
  child_id: string;
  guardian_id: string;
  relationship: string;
  is_primary: boolean;
  can_collect: boolean;
  is_emergency_contact: boolean;
  is_authorised_signatory: boolean;
  contact_priority: number;
  revoked_at: string | null;
}

const toLink = (r: LinkRow): ChildGuardian => ({
  id: r.id,
  childId: r.child_id,
  guardianId: r.guardian_id,
  relationship: r.relationship,
  isPrimary: r.is_primary,
  canCollect: r.can_collect,
  isEmergencyContact: r.is_emergency_contact,
  isAuthorisedSignatory: r.is_authorised_signatory,
  contactPriority: r.contact_priority,
  revokedAt: r.revoked_at,
});

const ENROLMENT_COLUMNS =
  'id, child_id, centre_id, start_date, end_date, funded_hours_per_week, twenty_hours_ece, days, notes';

interface EnrolmentRow {
  id: string;
  child_id: string;
  centre_id: string;
  start_date: string;
  end_date: string | null;
  funded_hours_per_week: number | string;
  twenty_hours_ece: boolean;
  days: number[] | null;
  notes: string | null;
}

const toEnrolment = (r: EnrolmentRow): Enrolment => ({
  id: r.id,
  childId: r.child_id,
  centreId: r.centre_id,
  startDate: r.start_date,
  endDate: r.end_date,
  // numeric(5,2) arrives as a string from PostgREST. Left as a number here so
  // callers do not each have to remember that.
  fundedHoursPerWeek: Number(r.funded_hours_per_week),
  twentyHoursEce: r.twenty_hours_ece,
  days: r.days ?? [],
  notes: r.notes,
});

const HEALTH_COLUMNS = 'id, child_id, kind, name, severity, response_plan, resolved_at';

interface HealthRow {
  id: string;
  child_id: string;
  kind: HealthKind;
  name: string;
  severity: HealthSeverity | null;
  response_plan: string | null;
  resolved_at: string | null;
}

const toHealth = (r: HealthRow): HealthCondition => ({
  id: r.id,
  childId: r.child_id,
  kind: r.kind,
  name: r.name,
  severity: r.severity,
  responsePlan: r.response_plan,
  resolvedAt: r.resolved_at,
});

const MEDICATION_COLUMNS =
  'id, child_id, medicine, dose, route, instructions, authorised_by, authorised_at, starts_on, expires_on';

interface MedicationRow {
  id: string;
  child_id: string;
  medicine: string;
  dose: string;
  route: string | null;
  instructions: string | null;
  authorised_by: string | null;
  authorised_at: string;
  starts_on: string;
  expires_on: string | null;
}

const toMedication = (r: MedicationRow): MedicationAuthority => ({
  id: r.id,
  childId: r.child_id,
  medicine: r.medicine,
  dose: r.dose,
  route: r.route,
  instructions: r.instructions,
  authorisedBy: r.authorised_by,
  authorisedAt: r.authorised_at,
  startsOn: r.starts_on,
  expiresOn: r.expires_on,
});

export interface CustodyArrangement {
  id: string;
  childId: string;
  detail: string;
  courtOrderReference: string | null;
  at: string;
  supersededAt: string | null;
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

export async function listChildren(
  db: Db,
  centreId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Child[]> {
  /*
   * Paged, and this is the one that would have hurt most quietly.
   *
   * A licence caps the roll, so the *current* roll is dozens of rows and could never truncate.
   * But `includeArchived: true` returns every child who has ever attended — and that is the
   * option the funding page uses, to turn an id into a name for a child who has since left.
   * Ten years of a two-site operator is well past a thousand.
   *
   * The failure would not have looked like a failure. The funding table renders "a former
   * child" when a name is missing from its map, so a truncated read produces an export where
   * some rows are anonymous — on the one document whose purpose is to be keyed into a Ministry
   * system per child. Nothing errors, and the totals stay correct.
   *
   * `id` joins the ordering because two children share a surname often enough that paging on
   * (last_name, first_name) alone could repeat one row and skip another.
   */
  const rows = await fetchAll<ChildRow>('listChildren', (from, to) => {
    let q = db.from('children').select(CHILD_COLUMNS).eq('centre_id', centreId);
    if (!opts.includeArchived) q = q.is('archived_at', null);
    return q.order('last_name').order('first_name').order('id').range(from, to);
  });
  return rows.map(toChild);
}

/** One child, or null when the caller may not see them — which RLS makes indistinguishable from "does not exist", on purpose. */
export async function getChild(db: Db, childId: string): Promise<Child | null> {
  const { data, error } = await db
    .from('children')
    .select(CHILD_COLUMNS)
    .eq('id', childId)
    .maybeSingle();
  if (error) throw new Error(`getChild: ${error.message}`);
  return data ? toChild(data as ChildRow) : null;
}

export interface ChildInput {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth: string;
  moeNsn?: string | null;
  ethnicities?: string[];
  iwi?: string | null;
  firstLanguage?: string | null;
  gender?: Gender | null;
}

export async function createChild(db: Db, centreId: string, input: ChildInput): Promise<Child> {
  const { data, error } = await db
    .from('children')
    .insert({
      centre_id: centreId,
      first_name: input.firstName,
      last_name: input.lastName,
      preferred_name: input.preferredName ?? null,
      date_of_birth: input.dateOfBirth,
      // Empty string is not the same as "no number", and an empty unique column
      // collides with the next empty one.
      moe_nsn: input.moeNsn?.trim() || null,
      ethnicities: input.ethnicities ?? [],
      iwi: input.iwi?.trim() || null,
      first_language: input.firstLanguage?.trim() || null,
      gender: input.gender ?? null,
    })
    .select(CHILD_COLUMNS)
    .single();
  if (error) throw new Error(`createChild: ${error.message}`);
  return toChild(data as ChildRow);
}

export async function updateChild(
  db: Db,
  childId: string,
  patch: Partial<ChildInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName;
  if (patch.lastName !== undefined) row.last_name = patch.lastName;
  if (patch.preferredName !== undefined) row.preferred_name = patch.preferredName?.trim() || null;
  if (patch.dateOfBirth !== undefined) row.date_of_birth = patch.dateOfBirth;
  if (patch.moeNsn !== undefined) row.moe_nsn = patch.moeNsn?.trim() || null;
  if (patch.ethnicities !== undefined) row.ethnicities = patch.ethnicities;
  if (patch.iwi !== undefined) row.iwi = patch.iwi?.trim() || null;
  if (patch.firstLanguage !== undefined) row.first_language = patch.firstLanguage?.trim() || null;
  if (patch.gender !== undefined) row.gender = patch.gender;
  if (Object.keys(row).length === 0) return;

  const { data, error } = await db.from('children').update(row).eq('id', childId).select('id');
  if (error) throw new Error(`updateChild: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'updateChild: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

/**
 * Archive, never delete.
 *
 * The Ministry requires the record to be retained, and so does any later question
 * about who was present when something happened. A deleted child takes the answer
 * with them.
 */
export async function archiveChild(db: Db, childId: string): Promise<void> {
  const { data, error } = await db
    .from('children')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', childId)
    .select('id');
  if (error) throw new Error(`archiveChild: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'archiveChild: nothing was archived. Either the id is wrong or the policy refused it.',
    );
  }
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

export async function listGuardians(db: Db, centreId: string): Promise<Guardian[]> {
  const { data, error } = await db
    .from('guardians')
    .select(GUARDIAN_COLUMNS)
    .eq('centre_id', centreId)
    .is('archived_at', null)
    .order('full_name');
  if (error) throw new Error(`listGuardians: ${error.message}`);
  return (data as GuardianRow[]).map(toGuardian);
}

export interface GuardianInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Set only when the guardian has an app account. Usually null. */
  userId?: string | null;
}

export async function createGuardian(
  db: Db,
  centreId: string,
  input: GuardianInput,
): Promise<Guardian> {
  const { data, error } = await db
    .from('guardians')
    .insert({
      centre_id: centreId,
      user_id: input.userId ?? null,
      full_name: input.fullName,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
    })
    .select(GUARDIAN_COLUMNS)
    .single();
  if (error) throw new Error(`createGuardian: ${error.message}`);
  return toGuardian(data as GuardianRow);
}

export async function updateGuardian(
  db: Db,
  guardianId: string,
  patch: Partial<GuardianInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.email !== undefined) row.email = patch.email?.trim() || null;
  if (patch.phone !== undefined) row.phone = patch.phone?.trim() || null;
  if (patch.address !== undefined) row.address = patch.address?.trim() || null;
  if (patch.userId !== undefined) row.user_id = patch.userId;
  if (Object.keys(row).length === 0) return;

  const { data, error } = await db.from('guardians').update(row).eq('id', guardianId).select('id');
  if (error) throw new Error(`updateGuardian: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'updateGuardian: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

export interface GuardianOfChild extends ChildGuardian {
  guardian: Guardian;
}

/**
 * A child's whānau, ready to display.
 *
 * Two queries rather than a PostgREST embed. An embedded resource is filtered by
 * the embedded table's own RLS, so for a parent — who may read the link rows for
 * their child but only their OWN guardian row — an embed silently returns
 * `guardian: null` for co-guardians and the join looks broken rather than
 * restricted. Doing it in two steps makes that visible: the link is there, the
 * guardian is not, and the caller decides what to show.
 */
export async function listGuardiansOfChild(db: Db, childId: string): Promise<GuardianOfChild[]> {
  const { data: links, error } = await db
    .from('child_guardians')
    .select(LINK_COLUMNS)
    .eq('child_id', childId)
    .is('revoked_at', null)
    .order('contact_priority');
  if (error) throw new Error(`listGuardiansOfChild: ${error.message}`);

  const rows = (links as LinkRow[]).map(toLink);
  if (rows.length === 0) return [];

  const { data: guardians, error: gError } = await db
    .from('guardians')
    .select(GUARDIAN_COLUMNS)
    .in(
      'id',
      rows.map((r) => r.guardianId),
    );
  if (gError) throw new Error(`listGuardiansOfChild: ${gError.message}`);

  const byId = new Map((guardians as GuardianRow[]).map((g) => [g.id, toGuardian(g)]));
  return rows
    .map((link) => {
      const guardian = byId.get(link.guardianId);
      return guardian ? { ...link, guardian } : null;
    })
    .filter((x): x is GuardianOfChild => x !== null);
}

export async function linkGuardian(
  db: Db,
  input: {
    childId: string;
    guardianId: string;
    relationship: string;
    isPrimary?: boolean;
    canCollect?: boolean;
    isEmergencyContact?: boolean;
    /** Defaults false, like the column — a signatory is named, never assumed. */
    isAuthorisedSignatory?: boolean;
    contactPriority?: number;
  },
): Promise<void> {
  const { error } = await db.from('child_guardians').insert({
    child_id: input.childId,
    guardian_id: input.guardianId,
    relationship: input.relationship,
    is_primary: input.isPrimary ?? false,
    can_collect: input.canCollect ?? true,
    is_emergency_contact: input.isEmergencyContact ?? false,
    is_authorised_signatory: input.isAuthorisedSignatory ?? false,
    contact_priority: input.contactPriority ?? 100,
  });
  if (error) throw new Error(`linkGuardian: ${error.message}`);
}

export async function updateGuardianLink(
  db: Db,
  linkId: string,
  patch: {
    relationship?: string;
    isPrimary?: boolean;
    canCollect?: boolean;
    isEmergencyContact?: boolean;
    contactPriority?: number;
    /** §6-3 criterion 4 (0061): may this guardian verify this child's attendance record? */
    isAuthorisedSignatory?: boolean;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.relationship !== undefined) row.relationship = patch.relationship;
  if (patch.isPrimary !== undefined) row.is_primary = patch.isPrimary;
  if (patch.canCollect !== undefined) row.can_collect = patch.canCollect;
  if (patch.isEmergencyContact !== undefined) row.is_emergency_contact = patch.isEmergencyContact;
  if (patch.contactPriority !== undefined) row.contact_priority = patch.contactPriority;
  if (patch.isAuthorisedSignatory !== undefined) row.is_authorised_signatory = patch.isAuthorisedSignatory;
  if (Object.keys(row).length === 0) return;

  const { data, error } = await db.from('child_guardians').update(row).eq('id', linkId).select('id');
  if (error) throw new Error(`updateGuardianLink: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'updateGuardianLink: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

/** Revoke, not delete — who was on the collection list in March is a real question. */
export async function revokeGuardianLink(db: Db, linkId: string): Promise<void> {
  const { data, error } = await db
    .from('child_guardians')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
    .select('id');
  if (error) throw new Error(`revokeGuardianLink: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'revokeGuardianLink: nothing was revoked. Either the id is wrong or the policy refused it.',
    );
  }
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export async function listEnrolments(db: Db, childId: string): Promise<Enrolment[]> {
  const { data, error } = await db
    .from('enrolments')
    .select(ENROLMENT_COLUMNS)
    .eq('child_id', childId)
    .order('start_date', { ascending: false });
  if (error) throw new Error(`listEnrolments: ${error.message}`);
  return (data as EnrolmentRow[]).map(toEnrolment);
}

/**
 * Every current enrolment at a centre, for the roll and the child list.
 *
 * `today` is a parameter because the answer depends on which day it is *at the
 * centre*. Computing it here with `toISOString()` would use UTC, and for the whole
 * New Zealand morning that is yesterday — so an enrolment starting today would be
 * missing from the roll until lunchtime. Callers pass `todayInZone(centre.timezone)`.
 */
export async function listCurrentEnrolments(
  db: Db,
  centreId: string,
  today: string = todayInZone(),
): Promise<Enrolment[]> {
  const { data, error } = await db
    .from('enrolments')
    .select(ENROLMENT_COLUMNS)
    .eq('centre_id', centreId)
    .lte('start_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (error) throw new Error(`listCurrentEnrolments: ${error.message}`);
  return (data as EnrolmentRow[]).map(toEnrolment);
}

export interface EnrolmentInput {
  startDate: string;
  endDate?: string | null;
  fundedHoursPerWeek?: number;
  twentyHoursEce?: boolean;
  days?: number[];
  notes?: string | null;
}

export async function createEnrolment(
  db: Db,
  input: EnrolmentInput & { childId: string; centreId: string },
): Promise<void> {
  const { error } = await db.from('enrolments').insert({
    child_id: input.childId,
    centre_id: input.centreId,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    funded_hours_per_week: input.fundedHoursPerWeek ?? 0,
    twenty_hours_ece: input.twentyHoursEce ?? false,
    days: input.days ?? [],
    notes: input.notes?.trim() || null,
  });
  // 23P01 is the exclusion violation from `enrolments_no_overlap`. Translated
  // because "conflicting key value violates exclusion constraint" is not a
  // sentence to show a centre manager.
  if (error) {
    if (error.code === '23P01') {
      throw new Error(
        'That overlaps an existing enrolment for this child. End the current one first — two overlapping enrolments double-count funded hours.',
      );
    }
    throw new Error(`createEnrolment: ${error.message}`);
  }
}

export async function updateEnrolment(
  db: Db,
  enrolmentId: string,
  patch: Partial<EnrolmentInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.fundedHoursPerWeek !== undefined) row.funded_hours_per_week = patch.fundedHoursPerWeek;
  if (patch.twentyHoursEce !== undefined) row.twenty_hours_ece = patch.twentyHoursEce;
  if (patch.days !== undefined) row.days = patch.days;
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
  if (Object.keys(row).length === 0) return;

  const { data, error } = await db
    .from('enrolments')
    .update(row)
    .eq('id', enrolmentId)
    .select('id');
  if (error) {
    if (error.code === '23P01') {
      throw new Error('That would overlap another enrolment for this child.');
    }
    throw new Error(`updateEnrolment: ${error.message}`);
  }
  // Zero-row check (item 49). Added by hand rather than with the others: this is the one
  // writer in the sweep with a multi-line error handler — it translates `23P01` into a
  // sentence about overlapping enrolments — so the pattern the others matched on did not
  // fit, and lint caught the resulting unused `data`. An enrolment carries funded hours
  // and the 20 Hours attestation, so a refusal reported as a save is a funding figure.
  if (!data || data.length === 0) {
    throw new Error(
      'updateEnrolment: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function listHealthConditions(
  db: Db,
  childId: string,
  opts: { includeResolved?: boolean } = {},
): Promise<HealthCondition[]> {
  let q = db.from('health_conditions').select(HEALTH_COLUMNS).eq('child_id', childId);
  if (!opts.includeResolved) q = q.is('resolved_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`listHealthConditions: ${error.message}`);
  return (data as HealthRow[]).map(toHealth);
}

/**
 * Every unresolved condition for a whole centre, keyed by child.
 *
 * One query, not one per child: the roll shows an allergy flag on every row, and
 * doing that per child turns a list of forty into forty-one round trips.
 *
 * The centre filter goes through an inner-join embed rather than fetching the
 * child ids first and passing them back as `in.(…)`. That earlier version worked
 * and had three problems: two round trips, a URL that grew with the roll, and a
 * silent dependency on PostgREST's default 1000-row cap applying to the id query.
 *
 * The embed also preserves the guardianship rule rather than working around it —
 * `children` RLS applies to the joined side, so an inner join keeps only the
 * children the caller may actually see. A parent gets their own child's conditions
 * from the same call an educator uses to get the room's.
 */
export async function listHealthByChild(
  db: Db,
  centreId: string,
): Promise<Map<string, HealthCondition[]>> {
  const { data, error } = await db
    .from('health_conditions')
    .select(`${HEALTH_COLUMNS}, children!inner(centre_id)`)
    .eq('children.centre_id', centreId)
    .is('resolved_at', null);
  if (error) throw new Error(`listHealthByChild: ${error.message}`);

  const out = new Map<string, HealthCondition[]>();
  for (const row of data as HealthRow[]) {
    const c = toHealth(row);
    const list = out.get(c.childId);
    if (list) list.push(c);
    else out.set(c.childId, [c]);
  }
  return out;
}

export async function addHealthCondition(
  db: Db,
  input: {
    childId: string;
    kind: HealthKind;
    name: string;
    severity?: HealthSeverity | null;
    responsePlan?: string | null;
  },
): Promise<void> {
  const { error } = await db.from('health_conditions').insert({
    child_id: input.childId,
    kind: input.kind,
    name: input.name,
    severity: input.severity ?? null,
    response_plan: input.responsePlan?.trim() || null,
  });
  if (error) throw new Error(`addHealthCondition: ${error.message}`);
}

export async function resolveHealthCondition(db: Db, conditionId: string): Promise<void> {
  const { data, error } = await db
    .from('health_conditions')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', conditionId)
    .select('id');
  if (error) throw new Error(`resolveHealthCondition: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'resolveHealthCondition: nothing was resolved. Either the id is wrong or the policy refused it.',
    );
  }
}

export async function listMedications(db: Db, childId: string): Promise<MedicationAuthority[]> {
  const { data, error } = await db
    .from('medication_authorities')
    .select(MEDICATION_COLUMNS)
    .eq('child_id', childId)
    .order('starts_on', { ascending: false });
  if (error) throw new Error(`listMedications: ${error.message}`);
  return (data as MedicationRow[]).map(toMedication);
}

export async function addMedicationAuthority(
  db: Db,
  input: {
    childId: string;
    medicine: string;
    dose: string;
    route?: string | null;
    instructions?: string | null;
    authorisedBy: string | null;
    startsOn: string;
    expiresOn?: string | null;
  },
): Promise<void> {
  const { error } = await db.from('medication_authorities').insert({
    child_id: input.childId,
    medicine: input.medicine,
    dose: input.dose,
    route: input.route?.trim() || null,
    instructions: input.instructions?.trim() || null,
    authorised_by: input.authorisedBy,
    starts_on: input.startsOn,
    expires_on: input.expiresOn || null,
  });
  if (error) throw new Error(`addMedicationAuthority: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

interface ConsentRow {
  child_id: string;
  kind: ConsentKind;
  granted: boolean;
  given_by: string | null;
  at: string;
}

/** Current state per kind, from the `current_consents` view. Kinds never answered are simply absent. */
export async function listConsents(db: Db, childId: string): Promise<ConsentState[]> {
  const { data, error } = await db
    .from('current_consents')
    .select('child_id, kind, granted, given_by, at')
    .eq('child_id', childId);
  if (error) throw new Error(`listConsents: ${error.message}`);
  return (data as ConsentRow[]).map((r) => ({
    kind: r.kind,
    granted: r.granted,
    givenBy: r.given_by,
    at: r.at,
  }));
}

/**
 * Current consent state for a whole centre, keyed by child.
 *
 * `current_consents` carries `centre_id` (added in 0006) so this is one query. A
 * view cannot be embedded through a foreign key, which is why the column exists on
 * the view rather than this doing the same inner-join trick as `listHealthByChild`.
 */
export async function listConsentsByChild(
  db: Db,
  centreId: string,
): Promise<Map<string, ConsentState[]>> {
  const { data, error } = await db
    .from('current_consents')
    .select('child_id, kind, granted, given_by, at')
    .eq('centre_id', centreId);
  if (error) throw new Error(`listConsentsByChild: ${error.message}`);

  const out = new Map<string, ConsentState[]>();
  for (const r of data as ConsentRow[]) {
    const state: ConsentState = { kind: r.kind, granted: r.granted, givenBy: r.given_by, at: r.at };
    const list = out.get(r.child_id);
    if (list) list.push(state);
    else out.set(r.child_id, [state]);
  }
  return out;
}

/** The full history for one child, newest first. What "we had permission then" rests on. */
export async function listConsentHistory(
  db: Db,
  childId: string,
): Promise<(ConsentState & { note: string | null })[]> {
  const { data, error } = await db
    .from('consent_events')
    .select('kind, granted, given_by, at, note')
    .eq('child_id', childId)
    .order('at', { ascending: false });
  if (error) throw new Error(`listConsentHistory: ${error.message}`);
  return (data as (ConsentRow & { note: string | null })[]).map((r) => ({
    kind: r.kind,
    granted: r.granted,
    givenBy: r.given_by,
    at: r.at,
    note: r.note,
  }));
}

/**
 * Record a consent decision.
 *
 * An append, always — withdrawing consent writes `granted: false` rather than
 * changing or deleting the grant. There is no update path and no delete path, in
 * the policies or the grants, because "we had permission at the time" is the whole
 * question and an editable answer is not evidence.
 */
export async function recordConsent(
  db: Db,
  input: {
    childId: string;
    kind: ConsentKind;
    granted: boolean;
    /** The guardian whose decision this is — not necessarily whoever typed it in. */
    givenBy: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('consent_events').insert({
    child_id: input.childId,
    kind: input.kind,
    granted: input.granted,
    given_by: input.givenBy,
    recorded_by: auth.user?.id ?? null,
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(`recordConsent: ${error.message}`);
}

/**
 * Ask Postgres whether consent is held.
 *
 * Phase 4's media pipeline must gate on this rather than on a client-side check.
 * `has_consent` is `security invoker`, so a caller who cannot see the child gets
 * `false` and the write is refused — failing closed is the only safe direction for
 * a question about a photograph of a child.
 */
export async function hasConsent(db: Db, childId: string, kind: ConsentKind): Promise<boolean> {
  const { data, error } = await db.rpc('has_consent', { p_child: childId, p_kind: kind });
  if (error) throw new Error(`hasConsent: ${error.message}`);
  return data === true;
}

// ---------------------------------------------------------------------------
// Consent requests — 0073, when the centre asked
// ---------------------------------------------------------------------------

interface ConsentRequestRow {
  kind: ConsentKind;
  guardian_id: string;
  requested_at: string;
  note: string | null;
}

const CONSENT_REQUEST_COLUMNS = 'kind, guardian_id, requested_at, note';

function toConsentRequest(r: ConsentRequestRow): ConsentRequest {
  return {
    kind: r.kind,
    guardianId: r.guardian_id,
    requestedAt: r.requested_at,
    note: r.note,
  };
}

/**
 * Every ask recorded for one child, newest first.
 *
 * Paged, and the bounded-queries guard was right to insist. The intuition that says "seven
 * kinds and two guardians, this is fourteen rows" is wrong because the table is append-only
 * and records *every* ask: a family that never answers and an office that chases weekly
 * produces eight rows a week, which passes a thousand inside three years. Truncation would
 * silently drop the newest asks, which is precisely the half that matters.
 */
export async function listConsentRequests(db: Db, childId: string): Promise<ConsentRequest[]> {
  const rows = await fetchAll<ConsentRequestRow>('listConsentRequests', (from, to) =>
    db
      .from('consent_requests')
      .select(CONSENT_REQUEST_COLUMNS)
      .eq('child_id', childId)
      .order('requested_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toConsentRequest);
}

/**
 * Asks for a whole centre, keyed by child.
 *
 * `consent_requests` carries no `centre_id` — it reaches its tenant through the child — so
 * this uses the `children!inner` embed that `listHealthByChild` documents. The embed is not
 * only a join: `children` RLS applies to the joined side, so a parent calling this gets
 * their own child's asks from the same call an educator uses to get the room's.
 */
export async function listConsentRequestsByChild(
  db: Db,
  centreId: string,
): Promise<Map<string, ConsentRequest[]>> {
  const rows = await fetchAll<ConsentRequestRow & { child_id: string }>(
    'listConsentRequestsByChild',
    (from, to) =>
      db
        .from('consent_requests')
        .select(`${CONSENT_REQUEST_COLUMNS}, child_id, children!inner(centre_id)`)
        .eq('children.centre_id', centreId)
        .order('requested_at', { ascending: false })
        .order('id')
        .range(from, to),
  );

  const out = new Map<string, ConsentRequest[]>();
  for (const row of rows) {
    const req = toConsentRequest(row);
    const list = out.get(row.child_id);
    if (list) list.push(req);
    else out.set(row.child_id, [req]);
  }
  return out;
}

/**
 * Ask this child's guardians for the decisions nobody has answered.
 *
 * Everything of consequence happens in `request_consent` (0073) rather than here: the
 * staff check, skipping kinds that already have an answer, and one notification per
 * guardian instead of one per kind. This is a definer function because `notifications` is
 * `grant select` only for `authenticated` — writing into another person's inbox is not
 * something a session may do directly.
 *
 * Returns how many (guardian, kind) asks were recorded. **Zero is a normal answer**, not a
 * failure: it means every kind offered already had a decision, and the caller renders that
 * rather than throwing.
 */
export async function requestConsent(
  db: Db,
  input: { childId: string; kinds: ConsentKind[]; note?: string | null },
): Promise<number> {
  const { data, error } = await db.rpc('request_consent', {
    p_child: input.childId,
    p_kinds: input.kinds,
    p_note: input.note?.trim() || null,
  });
  if (error) throw new Error(`requestConsent: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}

// ---------------------------------------------------------------------------
// Custody
// ---------------------------------------------------------------------------

/**
 * Court orders and collection restrictions.
 *
 * Owner and manager only, enforced by policy — a custody arrangement is a record
 * ABOUT the guardians, so it must not be readable BY them, including the guardian
 * it concerns. An educator gets what they need from the collection list instead.
 */
export async function listCustodyArrangements(
  db: Db,
  childId: string,
): Promise<CustodyArrangement[]> {
  const { data, error } = await db
    .from('custody_arrangements')
    .select('id, child_id, detail, court_order_reference, at, superseded_at')
    .eq('child_id', childId)
    .is('superseded_at', null)
    .order('at', { ascending: false });
  if (error) throw new Error(`listCustodyArrangements: ${error.message}`);
  return (
    data as {
      id: string;
      child_id: string;
      detail: string;
      court_order_reference: string | null;
      at: string;
      superseded_at: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    childId: r.child_id,
    detail: r.detail,
    courtOrderReference: r.court_order_reference,
    at: r.at,
    supersededAt: r.superseded_at,
  }));
}

export async function addCustodyArrangement(
  db: Db,
  input: { childId: string; detail: string; courtOrderReference?: string | null },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('custody_arrangements').insert({
    child_id: input.childId,
    detail: input.detail,
    court_order_reference: input.courtOrderReference?.trim() || null,
    recorded_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(`addCustodyArrangement: ${error.message}`);
}

/**
 * Supersede rather than edit, so the arrangement in force on a given date stays answerable.
 *
 * Zero-row check (item 49, 2026-09-03). A custody arrangement reported as superseded
 * while it still stands is the one silent refusal on this page with a safety consequence
 * rather than a bookkeeping one: staff read this field to know who a child may leave
 * with. Named by id, so nothing legitimately matches nothing.
 */
export async function supersedeCustodyArrangement(db: Db, id: string): Promise<void> {
  const { data, error } = await db
    .from('custody_arrangements')
    .update({ superseded_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`supersedeCustodyArrangement: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'supersedeCustodyArrangement: nothing was superseded. Either the id is wrong or the policy refused it.',
    );
  }
}

// ---------------------------------------------------------------------------
// Detail confirmations (0055)
// ---------------------------------------------------------------------------

export interface DetailConfirmation {
  id: string;
  childId: string;
  guardianId: string;
  confirmedAt: string;
}

/**
 * When this child's details were last confirmed, and by whom. Newest first.
 *
 * Bounded by `limit` rather than paged, and the reason is structural: a family confirms
 * once or twice a year, and the screen shows the most recent handful. The full history is
 * a question nobody has asked — when they do, this becomes a paged read with a window,
 * like every other report here.
 */
export async function listConfirmations(
  db: Db,
  childId: string,
  limit = 5,
): Promise<DetailConfirmation[]> {
  const { data, error } = await db
    .from('detail_confirmations')
    .select('id, child_id, guardian_id, confirmed_at')
    .eq('child_id', childId)
    .order('confirmed_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listConfirmations: ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as { id: string; child_id: string; guardian_id: string; confirmed_at: string };
    return {
      id: row.id,
      childId: row.child_id,
      guardianId: row.guardian_id,
      confirmedAt: row.confirmed_at,
    };
  });
}

/**
 * A guardian records that their child's details are current.
 *
 * `confirmed_at` is left to the column default rather than sent by the caller. A client
 * clock is not evidence, and this row exists to be evidence — the whole value of the table
 * is that "last confirmed in March" could not have been written in April.
 *
 * No update counterpart, and there never will be: the table is append-only in the grants,
 * so a correction is a new confirmation.
 */
export async function confirmDetails(
  db: Db,
  input: { childId: string; guardianId: string },
): Promise<void> {
  const { error } = await db
    .from('detail_confirmations')
    .insert({ child_id: input.childId, guardian_id: input.guardianId })
    .select('id');
  if (error) throw new Error(`confirmDetails: ${error.message}`);
}
