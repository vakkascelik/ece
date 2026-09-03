/**
 * Reads and writes for the annual ECE Return's staffing section.
 *
 * The arithmetic and every judgement about what is missing live in
 * `@ece/core/census`. This file does what the rest of this package does: shapes rows,
 * pages every read, and checks that a write actually wrote.
 *
 * **No tenant filtering is security here.** `.eq('centre_id', …)` below scopes a query
 * to the centre the caller is looking at; what stops one centre reaching another is
 * the policies in `0081`, and `staff_census_details` additionally refuses a colleague
 * — see AGENTS.md §4.1. The `.in('staff_member_id', …)` calls exist because that table
 * has no `centre_id` at all: the tenant is resolved through the person, which is what
 * `shifts` does.
 */

import {
  blocksOn,
  summariseCensus,
  type CensusStaffInput,
  type CensusSummary,
  type CodeDomain,
  type ContactHoursBlock,
  type LoadedCodeSet,
  type StaffCensusDetails,
} from '@ece/core';
import { fetchAll } from './paging';
import { listStaffRecords } from './compliance';
import { listStaffMembers } from './staff';
import type { Db } from './index';

/*
 * One string literal on one line, and it has to stay that way.
 *
 * Built with `+` across several lines this is typed `string` rather than a literal, and
 * supabase-js infers the row shape from the literal — so the concatenated version makes
 * every column `GenericStringError` and the typecheck fails on the `fetchAll` call
 * rather than here, which is a confusing place to start looking.
 */
const DETAIL_COLUMNS = 'staff_member_id, gender_code, age_band, ethnic_group_codes, iwi_codes, role_kind, role_code, highest_qualification_code, playcentre_qualification_code, is_paid, is_permanent, is_full_time, min_age_taught_months, max_age_taught_months, previously_worked_as_teacher, arrived_from_another_service, leaving_destination_code, updated_at';

interface DetailRow {
  staff_member_id: string;
  gender_code: string | null;
  age_band: string | null;
  ethnic_group_codes: string[] | null;
  iwi_codes: string[] | null;
  role_kind: string | null;
  role_code: string | null;
  highest_qualification_code: string | null;
  playcentre_qualification_code: string | null;
  is_paid: boolean | null;
  is_permanent: boolean | null;
  is_full_time: boolean | null;
  min_age_taught_months: number | null;
  max_age_taught_months: number | null;
  previously_worked_as_teacher: boolean | null;
  arrived_from_another_service: boolean | null;
  leaving_destination_code: string | null;
}

function toDetails(r: DetailRow): StaffCensusDetails {
  return {
    genderCode: r.gender_code,
    ageBand: r.age_band,
    // Postgres returns `'{}'` for the empty array, never null, but the column could be
    // read through a projection that omits it. Defaulting to `[]` rather than throwing
    // keeps a missing array a *gap on the report* instead of a crash on the page.
    ethnicGroupCodes: r.ethnic_group_codes ?? [],
    iwiCodes: r.iwi_codes ?? [],
    roleKind: r.role_kind,
    roleCode: r.role_code,
    highestQualificationCode: r.highest_qualification_code,
    playcentreQualificationCode: r.playcentre_qualification_code,
    isPaid: r.is_paid,
    isPermanent: r.is_permanent,
    isFullTime: r.is_full_time,
    minAgeTaughtMonths: r.min_age_taught_months,
    maxAgeTaughtMonths: r.max_age_taught_months,
    previouslyWorkedAsTeacher: r.previously_worked_as_teacher,
    arrivedFromAnotherService: r.arrived_from_another_service,
    leavingDestinationCode: r.leaving_destination_code,
  };
}

/**
 * Census details for the given people, keyed by staff member.
 *
 * A person with no row is absent from the map rather than present with nulls, because
 * `censusRow` treats "no record at all" as one gap and "a record missing eleven
 * fields" as eleven. Those are different problems for whoever has to fix them.
 */
export async function listCensusDetails(
  db: Db,
  staffMemberIds: string[],
): Promise<Map<string, StaffCensusDetails>> {
  if (staffMemberIds.length === 0) return new Map();
  const rows = await fetchAll<DetailRow>('listCensusDetails', (from, to) =>
    db
      .from('staff_census_details')
      .select(DETAIL_COLUMNS)
      .in('staff_member_id', staffMemberIds)
      .order('staff_member_id')
      .range(from, to),
  );
  return new Map(rows.map((r) => [r.staff_member_id, toDetails(r)]));
}

const HOURS_COLUMNS = 'id, staff_member_id, weekday, from_time, to_time, effective_from, effective_to';

interface HoursRow {
  id: string;
  staff_member_id: string;
  weekday: number;
  from_time: string;
  to_time: string;
  effective_from: string;
  effective_to: string | null;
}

/** A contracted block with its id, which the screen needs in order to end or remove one. */
export interface ContactHoursRow extends ContactHoursBlock {
  id: string;
  staffMemberId: string;
}

function toHours(r: HoursRow): ContactHoursRow {
  return {
    id: r.id,
    staffMemberId: r.staff_member_id,
    weekday: r.weekday,
    fromTime: r.from_time,
    toTime: r.to_time,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}

/**
 * Every contracted block for the given people, superseded ones included.
 *
 * Paged, and **not** filtered to a date in SQL, deliberately. Two reasons: a screen
 * that lets somebody supersede a contract has to show them the history they are
 * superseding, and `blocksOn` in `@ece/core` is the one place the effective-date
 * rule is written down — filtering here as well would be a second copy of it, and the
 * two would disagree the first time one was changed.
 *
 * Paging is not belt-and-braces. This table accumulates: a contract superseded twice a
 * year for thirty staff across seven weekdays passes a thousand rows within a decade,
 * and a truncated read would silently drop somebody's Tuesday from a Crown return.
 */
export async function listContactHours(db: Db, staffMemberIds: string[]): Promise<ContactHoursRow[]> {
  if (staffMemberIds.length === 0) return [];
  const rows = await fetchAll<HoursRow>('listContactHours', (from, to) =>
    db
      .from('staff_contact_hours')
      .select(HOURS_COLUMNS)
      .in('staff_member_id', staffMemberIds)
      .order('staff_member_id')
      .order('weekday')
      .order('from_time')
      .order('id')
      .range(from, to),
  );
  return rows.map(toHours);
}

interface CodeRow {
  code: string;
  label: string;
  effective_from: string | null;
  effective_to: string | null;
  code_sets: { domain: string } | { domain: string }[] | null;
}

/**
 * The current code set for each named domain.
 *
 * Returns only domains that actually have a current set, so a caller can tell "loaded
 * and this code is not in it" from "no set loaded" — the distinction `codesChecked`
 * renders as a third state. `0080` ships every one of these empty, so today this
 * returns nothing at all, and that is correct rather than broken.
 */
export async function loadCodeSets(db: Db, domains: CodeDomain[]): Promise<LoadedCodeSet[]> {
  if (domains.length === 0) return [];
  const rows = await fetchAll<CodeRow>('loadCodeSets', (from, to) =>
    db
      .from('codes')
      .select('code, label, effective_from, effective_to, code_sets!inner(domain)')
      .eq('code_sets.is_current', true)
      .in('code_sets.domain', domains)
      .order('code')
      .range(from, to),
  );

  const byDomain = new Map<CodeDomain, LoadedCodeSet>();
  for (const r of rows) {
    // PostgREST returns an embedded to-one either as an object or, depending on how it
    // resolves the relationship, as a single-element array. Both shapes are handled
    // rather than assumed, because the difference surfaces as every code silently
    // failing to resolve.
    const embedded = Array.isArray(r.code_sets) ? r.code_sets[0] : r.code_sets;
    const domain = embedded?.domain as CodeDomain | undefined;
    if (!domain) continue;
    const set = byDomain.get(domain) ?? { domain, codes: [] };
    set.codes.push({
      code: r.code,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    });
    byDomain.set(domain, set);
  }
  return [...byDomain.values()];
}

/** The domains the staffing section resolves codes against. */
const CENSUS_DOMAINS: CodeDomain[] = [
  'gender',
  'ethnic_group',
  'iwi',
  'staff_role',
  'qualification',
  'playcentre_qualification',
];

export interface CensusReadiness {
  summary: CensusSummary;
  /** Every contracted block, so a screen can show what is being superseded. */
  contactHours: ContactHoursRow[];
  /**
   * The stored values, keyed by person.
   *
   * The summary carries what was *derived* — the gaps, the hours total, the registration
   * flag. A form needs what was *entered*, and they are not the same set: a screen
   * rendering `summary` alone would show a manager their gaps and then present them with
   * empty inputs over the top of data that is already there.
   */
  details: Map<string, StaffCensusDetails>;
  /**
   * Domains that have a current code set loaded.
   *
   * Empty today, because `0080` ships every list empty. A screen uses this to say *"no
   * Ministry code list loaded"* on the fields it cannot offer, rather than rendering an
   * empty dropdown that reads as a bug.
   */
  loadedDomains: CodeDomain[];
}

/**
 * The staffing section as at a date, with its gaps.
 *
 * `asAt` is a parameter and there is no default. The caller holds a centre and can
 * compute `todayInZone(centre.timezone)`; this package connects as UTC, so a date
 * derived here would be yesterday for the whole New Zealand morning — AGENTS.md §4.3.
 */
export async function readCensusReadiness(
  db: Db,
  centreId: string,
  asAt: string,
): Promise<CensusReadiness> {
  const [members, records] = await Promise.all([
    listStaffMembers(db, centreId),
    listStaffRecords(db, centreId),
  ]);

  const ids = members.map((m) => m.id);
  const [details, hours, codeSets] = await Promise.all([
    listCensusDetails(db, ids),
    listContactHours(db, ids),
    loadCodeSets(db, CENSUS_DOMAINS),
  ]);

  const byMember = new Map<string, ContactHoursRow[]>();
  for (const h of hours) {
    const list = byMember.get(h.staffMemberId) ?? [];
    list.push(h);
    byMember.set(h.staffMemberId, list);
  }

  const inputs: CensusStaffInput[] = members.map((member) => ({
    member,
    details: details.get(member.id) ?? null,
    contactHours: byMember.get(member.id) ?? [],
  }));

  return {
    summary: summariseCensus(inputs, records, asAt, codeSets),
    contactHours: hours,
    details,
    loadedDomains: codeSets.map((s) => s.domain),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CensusDetailsPatch {
  genderCode?: string | null;
  ageBand?: string | null;
  ethnicGroupCodes?: string[];
  iwiCodes?: string[];
  roleKind?: string | null;
  roleCode?: string | null;
  highestQualificationCode?: string | null;
  playcentreQualificationCode?: string | null;
  isPaid?: boolean | null;
  isPermanent?: boolean | null;
  isFullTime?: boolean | null;
  minAgeTaughtMonths?: number | null;
  maxAgeTaughtMonths?: number | null;
  previouslyWorkedAsTeacher?: boolean | null;
  arrivedFromAnotherService?: boolean | null;
  leavingDestinationCode?: string | null;
}

const COLUMN_OF: Record<keyof CensusDetailsPatch, string> = {
  genderCode: 'gender_code',
  ageBand: 'age_band',
  ethnicGroupCodes: 'ethnic_group_codes',
  iwiCodes: 'iwi_codes',
  roleKind: 'role_kind',
  roleCode: 'role_code',
  highestQualificationCode: 'highest_qualification_code',
  playcentreQualificationCode: 'playcentre_qualification_code',
  isPaid: 'is_paid',
  isPermanent: 'is_permanent',
  isFullTime: 'is_full_time',
  minAgeTaughtMonths: 'min_age_taught_months',
  maxAgeTaughtMonths: 'max_age_taught_months',
  previouslyWorkedAsTeacher: 'previously_worked_as_teacher',
  arrivedFromAnotherService: 'arrived_from_another_service',
  leavingDestinationCode: 'leaving_destination_code',
};

/**
 * Record or amend one person's census details.
 *
 * An upsert, because the row's primary key IS the person and a first save has nothing
 * to update. `updated_by` is not accepted from the caller: it is stamped from the
 * session, for the reason `audit_events` pins `actor_id` — a field that says who
 * recorded something is worthless if a caller can say somebody else did.
 *
 * **An empty patch is a no-op rather than a touch.** Writing `updated_at` for a form
 * submitted with nothing changed would make the audit trail claim an edit that did not
 * happen, and `audit_trigger` already declines to write a row for an update that
 * changed no column.
 */
export async function saveCensusDetails(
  db: Db,
  staffMemberId: string,
  patch: CensusDetailsPatch,
  updatedBy: string | null,
): Promise<void> {
  const row: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    const value = patch[key as keyof CensusDetailsPatch];
    if (value !== undefined) row[column] = value;
  }
  if (Object.keys(row).length === 0) return;

  row.staff_member_id = staffMemberId;
  row.updated_by = updatedBy;
  row.updated_at = new Date().toISOString();

  // Zero-row check, as everywhere in this package: under RLS a refusal is "matched
  // nothing", which PostgREST reports as success with an empty array.
  const { data, error } = await db
    .from('staff_census_details')
    .upsert(row, { onConflict: 'staff_member_id' })
    .select('staff_member_id');
  if (error) throw new Error(`saveCensusDetails: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'saveCensusDetails: nothing was written. Either the person does not exist or the policy refused it.',
    );
  }
}

export interface ContactHoursInput {
  staffMemberId: string;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  fromTime: string;
  toTime: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/**
 * Add a contracted block.
 *
 * The overlap constraint refuses a block that collides with a live one on the same
 * weekday, and **that includes a block in a later period while the existing one is
 * open-ended**, because a null `effective_to` is infinity. So superseding contracted
 * hours is two calls — `endContactHours` then this — and the error below says so,
 * because `23P01` on its own sends somebody looking for a duplicate.
 */
export async function addContactHours(db: Db, input: ContactHoursInput, createdBy: string | null): Promise<string> {
  const { data, error } = await db
    .from('staff_contact_hours')
    .insert({
      staff_member_id: input.staffMemberId,
      weekday: input.weekday,
      from_time: input.fromTime,
      to_time: input.toTime,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo ?? null,
      created_by: createdBy,
    })
    .select('id');
  if (error) {
    if (error.code === '23P01') {
      throw new Error(
        'addContactHours: these hours overlap an existing block on that weekday. ' +
          'End the existing block first — an open-ended contract covers every later date.',
      );
    }
    throw new Error(`addContactHours: ${error.message}`);
  }
  const id = data?.[0]?.id;
  if (!id) {
    throw new Error('addContactHours: nothing was written. The policy refused it.');
  }
  return id as string;
}

/** Close an open-ended block, which is the first half of superseding one. */
export async function endContactHours(db: Db, id: string, effectiveTo: string): Promise<void> {
  const { data, error } = await db
    .from('staff_contact_hours')
    .update({ effective_to: effectiveTo })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`endContactHours: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('endContactHours: nothing was updated. Either the id is wrong or the policy refused it.');
  }
}

/**
 * Remove a contracted block outright.
 *
 * Available, unlike on the append-only ledgers, because a contract entered wrongly has
 * to be removable: a mistaken Tuesday left in place corrupts the derived hours total
 * for every return that reads it. What is not removable is the record of what
 * *happened* — `staff_attendance_events` and `staff_records` keep their refusal.
 */
export async function deleteContactHours(db: Db, id: string): Promise<void> {
  const { data, error } = await db
    .from('staff_contact_hours')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`deleteContactHours: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('deleteContactHours: nothing was deleted. Either the id is wrong or the policy refused it.');
  }
}

/** Re-exported so a screen can filter without importing two packages. */
export { blocksOn };
