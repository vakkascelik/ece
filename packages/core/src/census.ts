/**
 * The annual ECE Return's staffing section: what it asks for, what we hold, and —
 * the part that matters — what is missing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR, AND WHAT IT REFUSES TO DO
 *
 * The ELI schema's `EceReturn` carries a `StaffInformationList`, and each
 * `StaffInformation` requires a gender code and, inside an educational role, a role
 * code, a highest qualification, a registration flag, at least one ethnic group, three
 * employment booleans and a list of contracted contact hours.
 *
 * This module assembles that from `staff_members`, `staff_census_details`,
 * `staff_contact_hours` and the practising certificates already in `staff_records` —
 * and where a required field is absent it **names the person and the field**. It does
 * not default, does not infer and does not omit the person quietly.
 *
 * That is the same rule `funding.ts` follows for a broken attendance day, and it is
 * here for the same reason: a census that silently reports a manager as unregistered,
 * or unpaid, or as teaching no age group, is a return that looks complete and is
 * wrong. A return the Ministry accepts and later audits is worse than one it rejects.
 *
 * **Nothing here reads a clock.** The return date is a parameter, as it is everywhere
 * else in this package, because "as at today" computed on a server in UTC is how a New
 * Zealand morning becomes yesterday.
 *
 * WHY `isRegistered` IS THREE-STATE AND NOT A BOOLEAN
 *
 * The schema types `IsRegistered` as a required `xs:boolean`, so the wire has two
 * values and no third. But **"we hold no practising certificate for this person" is
 * not "this person is not registered"** — 0038 leaves every `staff_records` link null
 * on purpose, so an unlinked centre holds a folder of certificates and would report
 * every teacher as unregistered.
 *
 * Sending `false` there is an assertion about a named individual's professional
 * standing, made on the strength of a missing row. So this module returns `null`, the
 * caller cannot send the return, and the report says which people need linking.
 * `countCertificated` already refuses to draw conclusions from the same data for the
 * same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { currentStaff, type StaffMember } from './staff';
import type { StaffRecord } from './compliance';

import {
  blockMinutes,
  blocksOn,
  coversDate,
  timeToMinutes,
  type WeekdayBlock,
} from './weekdayBlock';

// Re-exported so every existing importer of `@ece/core` keeps working unchanged.
export { blockMinutes, blocksOn, coversDate, timeToMinutes, type WeekdayBlock };

// ---------------------------------------------------------------------------
// Sourced value domains
//
// Every constant in this section is enumerated by the public ELI schema at
// https://eli.minedu.govt.nz/eli.xsd, read 2026-09-02. They are transcribed rather
// than recalled, and they are the ONLY ELI code values in this repository — the rest
// (gender, ethnicity, iwi, language, staff role, qualification) are typed there as an
// unenumerated 10-character `LookupCode` and live in the `code_sets` tables, empty,
// until somebody imports a published list. See AGENTS.md §7.
//
// The schema carries no version stamp, so these may be superseded without notice.
// Tracked as unverified-claims item 47.
// ---------------------------------------------------------------------------

/** The five `StaffRoles` shapes. Each asks for a different set of fields. */
export const STAFF_ROLE_KINDS = [
  'educational',
  'home_based_educator',
  'management',
  'support',
  'specialist',
] as const;
export type StaffRoleKind = (typeof STAFF_ROLE_KINDS)[number];

/** `AgeBandCode` — twelve five-year bands. */
export const STAFF_AGE_BANDS = [
  'UN_20', '20_25', '26_30', '31_35', '36_40', '41_45',
  '46_50', '51_55', '56_60', '61_65', '66_70', 'OV_70',
] as const;
export type StaffAgeBand = (typeof STAFF_AGE_BANDS)[number];

/**
 * `LeavingTeacherDestinationCode`.
 *
 * The schema enumerates the codes and **does not say what they mean**, so no label for
 * them exists anywhere in this product and none may be invented. A code whose meaning
 * is unknown can be stored and transmitted; it cannot be displayed.
 */
export const LEAVING_DESTINATION_CODES = ['D01', 'D02', 'D03', 'D04', 'UNK'] as const;
export type LeavingDestinationCode = (typeof LEAVING_DESTINATION_CODES)[number];

/**
 * `WeekdayCode`, and the mapping from the ISO weekday this product stores.
 *
 * Here rather than at the API boundary because it is two lines of sourced fact that
 * somebody would otherwise reconstruct from memory, and getting Sunday wrong shifts a
 * whole week of contracted hours onto the wrong day.
 */
export const ELI_WEEKDAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
export type EliWeekdayCode = (typeof ELI_WEEKDAY_CODES)[number];

/** ISO weekday (1 = Monday) to the schema's two-letter code. */
export function eliWeekday(isoWeekday: number): EliWeekdayCode | null {
  if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7) return null;
  // The guard above makes the index safe, and `noUncheckedIndexedAccess` is right not
  // to take that on trust — a `!` here would be the assertion this package avoids.
  return ELI_WEEKDAY_CODES[isoWeekday - 1] ?? null;
}

/** The reference domains 0080 knows about. */
export const CODE_DOMAINS = [
  'gender',
  'ethnic_group',
  'iwi',
  'language',
  'staff_role',
  'qualification',
  'playcentre_qualification',
  'wait_time',
  'closure_reason',
] as const;
export type CodeDomain = (typeof CODE_DOMAINS)[number];

/** The `LookupCode` bound: `minLength 1, maxLength 10`. */
export const LOOKUP_CODE_MAX_LENGTH = 10;

/** `ReturnWeekHoursWorked`: `xs:int`, 0 to 100 inclusive. */
export const RETURN_WEEK_HOURS_MAX = 100;

/** `MinAgeTaught` / `MaxAgeTaught`: `xs:int`, 0 to 72 inclusive, in months. */
export const AGE_TAUGHT_MAX_MONTHS = 72;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/*
  A `staff_contact_hours` row is a `WeekdayBlock` — see the alias further down, and the note on
  why the shape moved out of this file.
*/

/** A `staff_census_details` row. Every field nullable — see the migration header. */
export interface StaffCensusDetails {
  genderCode: string | null;
  ageBand: string | null;
  ethnicGroupCodes: string[];
  iwiCodes: string[];
  roleKind: string | null;
  roleCode: string | null;
  highestQualificationCode: string | null;
  playcentreQualificationCode: string | null;
  isPaid: boolean | null;
  isPermanent: boolean | null;
  isFullTime: boolean | null;
  minAgeTaughtMonths: number | null;
  maxAgeTaughtMonths: number | null;
  previouslyWorkedAsTeacher: boolean | null;
  arrivedFromAnotherService: boolean | null;
  leavingDestinationCode: string | null;
}

/** One loaded reference set. `codes` holds the values effective-dated per 0080. */
export interface LoadedCodeSet {
  domain: CodeDomain;
  codes: { code: string; effectiveFrom: string | null; effectiveTo: string | null }[];
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

export const CENSUS_FIELDS = [
  'censusRecord',
  'genderCode',
  'roleKind',
  'roleCode',
  'highestQualificationCode',
  'isRegistered',
  'ethnicGroupCodes',
  'isPaid',
  'isPermanent',
  'isFullTime',
  'contactHours',
] as const;
export type CensusField = (typeof CENSUS_FIELDS)[number];

export type CodeProblem =
  /** Longer than the schema's `LookupCode` allows, so the message would be rejected. */
  | 'too-long'
  /** Not in the loaded reference set for its domain. */
  | 'not-in-set'
  /** In the set, but its effective window does not cover the return date. */
  | 'not-effective'
  /** Not one of the values the schema itself enumerates. */
  | 'not-a-schema-value';

export interface CensusCodeIssue {
  field: string;
  code: string;
  problem: CodeProblem;
  domain: CodeDomain | null;
}

export interface CensusStaffRow {
  staffMemberId: string;
  fullName: string;
  roleKind: StaffRoleKind | null;

  /**
   * Contracted contact hours for the return week, as the schema wants them: an
   * integer. Null when there is no contract at all, which is a gap rather than zero.
   */
  hoursWorked: number | null;
  /**
   * The exact contracted minutes the integer above was derived from.
   *
   * Reported because `hoursWorked` floors — the schema takes an `xs:int` and this
   * package's rule is that a rounding error never favours the party doing the
   * rounding. A 37½-hour contract goes on the wire as 37, and a screen that shows only
   * the 37 has quietly lost half an hour a week per person. Null when there is no
   * contract.
   */
  contractedMinutes: number | null;
  /** The blocks effective at the return date, in weekday then start order. */
  contactHours: ContactHoursBlock[];

  /**
   * From a current practising certificate in `staff_records`.
   *
   * **Three-state, and `null` is not `false`.** Null means no linked, unexpired,
   * unarchived certificate was found — which includes the common case of a certificate
   * on file whose `staff_member_id` link has never been made. See the module header.
   */
  isRegistered: boolean | null;

  /** Required fields with no value, for this person's role kind. */
  missing: CensusField[];
  /** Codes present but unusable. Separate from `missing`: a wrong code is not a blank. */
  codeIssues: CensusCodeIssue[];

  /** Nothing missing and no code issues. The only state in which this row is sendable. */
  reportable: boolean;
}

export interface CensusSummary {
  /** The return date every derivation was made as at. */
  asAt: string;
  rows: CensusStaffRow[];
  /** People on the roster at `asAt` who cannot yet be reported. */
  incompleteCount: number;
  /**
   * Every person on the roster is reportable.
   *
   * Note what this does NOT claim: that the return is correct, or that the roster is
   * the right set of people, or that the codes mean what somebody thinks. It claims
   * that no required field is blank and no present code is unusable.
   */
  complete: boolean;
  /**
   * Were the codes checked against reference sets?
   *
   * `true` — every domain a code was given for had a loaded set. `false` — at least
   * one domain had none, so those codes are unvalidated. `null` — no sets were
   * supplied at all, so no checking was attempted.
   *
   * The `overdue: null` contract. A screen must render the third state as "not
   * checked" rather than as a pass, because `code_sets` ships empty and the day the
   * first set is imported must look different from the day before it.
   */
  codesChecked: boolean | null;
}

// ---------------------------------------------------------------------------
// Time and dates
// ---------------------------------------------------------------------------

/**
 * MOVED to `./weekdayBlock` on 2026-09-04, when `child_booking_schedule` (0085) became the second
 * consumer of the same shape. `timeToMinutes`, the effective-window rule and the per-week minutes
 * sum are not census concepts — they are properties of a recurring weekday block, and `0085` reused
 * `0081`'s idiom deliberately, so a second copy here would be the divergence risk that
 * `tokens:check` exists to prevent, in a place where it changes a funding figure.
 *
 * The census names survive as thin aliases below, because `contractedMinutes` reads correctly in
 * the census's own vocabulary and `ContactHoursRow extends ContactHoursBlock` in `@ece/api` reads
 * better than the neutral name would. The FUNCTION that filters by date does not get an alias:
 * one behaviour with two exported names is the thing a reviewer would rightly object to, so
 * `contactHoursOn` is gone and `blocksOn` is the one name.
 */

/** The census's name for a `WeekdayBlock`. Identical shape; kept for local vocabulary. */
export type ContactHoursBlock = WeekdayBlock;

/** The census's name for `blockMinutes`. Contracted, per §14-2's open question — item 50. */
export const contractedMinutes = blockMinutes;

// ---------------------------------------------------------------------------
// Code resolution
// ---------------------------------------------------------------------------

function checkCode(
  field: string,
  code: string,
  domain: CodeDomain,
  sets: LoadedCodeSet[] | undefined,
  asAt: string,
): { issue: CensusCodeIssue | null; checked: boolean } {
  if (code.length > LOOKUP_CODE_MAX_LENGTH) {
    return { issue: { field, code, problem: 'too-long', domain }, checked: true };
  }
  const set = sets?.find((s) => s.domain === domain);
  // No set loaded is not a code problem — it is an unchecked code, and the caller is
  // told through `codesChecked` rather than through a per-row issue that would read
  // like a data error the centre could fix.
  if (!set) return { issue: null, checked: false };

  const match = set.codes.find((c) => c.code === code);
  if (!match) return { issue: { field, code, problem: 'not-in-set', domain }, checked: true };

  // A set imported with no dates at all leaves both null, which 0080 defines as "not
  // dated" rather than "always valid". Treating undated as effective is the reading
  // that lets a superseded code through; treating it as ineffective would make every
  // undated set unusable. Undated passes, and the gap is the set's missing dates.
  if (!coversDate(match.effectiveFrom, match.effectiveTo, asAt)) {
    return { issue: { field, code, problem: 'not-effective', domain }, checked: true };
  }
  return { issue: null, checked: true };
}

// ---------------------------------------------------------------------------
// Required fields per role kind
// ---------------------------------------------------------------------------

/**
 * What the schema requires, by role shape.
 *
 * Transcribed from the `StaffRoles` complex types: `EducationalStaffRole` requires a
 * role code, qualification, registration flag, ethnic groups, all three employment
 * booleans and a contact-hours list; `HomeBasedEducatorStaffRole` requires the same
 * minus `IsPaid` and the contact hours; and management, support and specialist roles
 * are `OtherStaffRole`, which requires only a role code and the three booleans.
 *
 * `GenderCode` sits on `StaffInformation` above the role block and is required for
 * everybody, which is why it is not in this table.
 */
const REQUIRED_BY_ROLE_KIND: Record<StaffRoleKind, CensusField[]> = {
  educational: [
    'roleCode',
    'highestQualificationCode',
    'isRegistered',
    'ethnicGroupCodes',
    'isPaid',
    'isPermanent',
    'isFullTime',
    'contactHours',
  ],
  home_based_educator: [
    'roleCode',
    'highestQualificationCode',
    'isRegistered',
    'ethnicGroupCodes',
    'isPermanent',
    'isFullTime',
  ],
  management: ['roleCode', 'isPaid', 'isPermanent', 'isFullTime'],
  support: ['roleCode', 'isPaid', 'isPermanent', 'isFullTime'],
  specialist: ['roleCode', 'isPaid', 'isPermanent', 'isFullTime'],
};

function isRoleKind(value: string | null): value is StaffRoleKind {
  return value !== null && (STAFF_ROLE_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface CensusStaffInput {
  member: StaffMember;
  /** Null when no `staff_census_details` row exists for this person at all. */
  details: StaffCensusDetails | null;
  contactHours: ContactHoursBlock[];
}

/**
 * Is this person registered, as at the return date?
 *
 * Reuses `countCertificated`'s currency rule deliberately rather than restating it: a
 * practising certificate with no expiry is treated as NOT current, because every one
 * has an expiry and a blank is an unfinished record rather than a document that never
 * lapses. Restating the rule here is how the census and the licensing binder end up
 * disagreeing about the same person.
 */
function registrationOf(
  staffMemberId: string,
  records: StaffRecord[],
  asAt: string,
): boolean | null {
  const linked = records.filter(
    (r) =>
      r.kind === 'practising_certificate' &&
      r.archivedAt === null &&
      r.staffMemberId === staffMemberId,
  );
  if (linked.length === 0) return null;
  return linked.some((r) => r.expiresOn !== null && r.expiresOn >= asAt);
}

export function censusRow(
  input: CensusStaffInput,
  records: StaffRecord[],
  asAt: string,
  codeSets?: LoadedCodeSet[],
): CensusStaffRow & { codesChecked: boolean } {
  const { member, details } = input;
  const missing: CensusField[] = [];
  const codeIssues: CensusCodeIssue[] = [];
  let allChecked = true;

  const note = (issue: CensusCodeIssue | null, checked: boolean) => {
    if (issue) codeIssues.push(issue);
    if (!checked) allChecked = false;
  };

  const blocks = blocksOn(input.contactHours, asAt);
  const minutes = contractedMinutes(blocks);
  const isRegistered = registrationOf(member.id, records, asAt);

  // Hours are reported even when they exceed the schema's bound, and the excess is a
  // code issue rather than a clamp. Silently sending 100 for a 120-hour contract would
  // hide a data error behind a valid message — the failure this whole module exists to
  // avoid, and the same argument `funding.ts` makes for naming a capped day.
  const hoursWorked = minutes === null ? null : Math.floor(minutes / 60);
  if (hoursWorked !== null && hoursWorked > RETURN_WEEK_HOURS_MAX) {
    codeIssues.push({
      field: 'hoursWorked',
      code: String(hoursWorked),
      problem: 'not-a-schema-value',
      domain: null,
    });
  }

  if (details === null) {
    // One gap, not eleven. A person with no census record needs a record, and listing
    // every field they are missing buries that under noise.
    missing.push('censusRecord');
    return {
      staffMemberId: member.id,
      fullName: member.fullName,
      roleKind: null,
      hoursWorked,
      contractedMinutes: minutes,
      contactHours: blocks,
      isRegistered,
      missing,
      codeIssues,
      reportable: false,
      codesChecked: allChecked,
    };
  }

  const roleKind = isRoleKind(details.roleKind) ? details.roleKind : null;
  if (details.roleKind !== null && roleKind === null) {
    codeIssues.push({
      field: 'roleKind',
      code: details.roleKind,
      problem: 'not-a-schema-value',
      domain: null,
    });
  }

  // Required for everybody, above the role block.
  if (details.genderCode === null) missing.push('genderCode');
  else {
    const r = checkCode('genderCode', details.genderCode, 'gender', codeSets, asAt);
    note(r.issue, r.checked);
  }

  if (roleKind === null) missing.push('roleKind');

  // Optional fields, validated only where present. An absent age band is not a gap —
  // the schema marks it minOccurs="0" nillable — but a band the schema does not define
  // is an error worth naming.
  if (details.ageBand !== null && !(STAFF_AGE_BANDS as readonly string[]).includes(details.ageBand)) {
    codeIssues.push({ field: 'ageBand', code: details.ageBand, problem: 'not-a-schema-value', domain: null });
  }
  if (
    details.leavingDestinationCode !== null &&
    !(LEAVING_DESTINATION_CODES as readonly string[]).includes(details.leavingDestinationCode)
  ) {
    codeIssues.push({
      field: 'leavingDestinationCode',
      code: details.leavingDestinationCode,
      problem: 'not-a-schema-value',
      domain: null,
    });
  }
  for (const field of ['minAgeTaughtMonths', 'maxAgeTaughtMonths'] as const) {
    const value = details[field];
    if (value !== null && (value < 0 || value > AGE_TAUGHT_MAX_MONTHS)) {
      codeIssues.push({ field, code: String(value), problem: 'not-a-schema-value', domain: null });
    }
  }
  if (details.playcentreQualificationCode !== null) {
    const r = checkCode(
      'playcentreQualificationCode',
      details.playcentreQualificationCode,
      'playcentre_qualification',
      codeSets,
      asAt,
    );
    note(r.issue, r.checked);
  }
  // Iwi is optional in the schema — zero to three — so an empty array is not a gap.
  details.iwiCodes.forEach((code, i) => {
    const r = checkCode(`iwiCodes[${i}]`, code, 'iwi', codeSets, asAt);
    note(r.issue, r.checked);
  });

  // Role-dependent requirements.
  const required = roleKind === null ? [] : REQUIRED_BY_ROLE_KIND[roleKind];
  for (const field of required) {
    switch (field) {
      case 'roleCode':
        if (details.roleCode === null) missing.push('roleCode');
        break;
      case 'highestQualificationCode':
        if (details.highestQualificationCode === null) missing.push('highestQualificationCode');
        break;
      case 'isRegistered':
        if (isRegistered === null) missing.push('isRegistered');
        break;
      case 'ethnicGroupCodes':
        // The schema requires `EthnicGroup1Code` and makes the second and third
        // optional, so one is enough and none is a gap.
        if (details.ethnicGroupCodes.length === 0) missing.push('ethnicGroupCodes');
        break;
      case 'isPaid':
        if (details.isPaid === null) missing.push('isPaid');
        break;
      case 'isPermanent':
        if (details.isPermanent === null) missing.push('isPermanent');
        break;
      case 'isFullTime':
        if (details.isFullTime === null) missing.push('isFullTime');
        break;
      case 'contactHours':
        if (blocks.length === 0) missing.push('contactHours');
        break;
      default:
        break;
    }
  }

  // Codes for the role block, checked wherever they are present — including on a role
  // kind that does not require them, because a wrong code is wrong either way.
  if (details.roleCode !== null) {
    const r = checkCode('roleCode', details.roleCode, 'staff_role', codeSets, asAt);
    note(r.issue, r.checked);
  }
  if (details.highestQualificationCode !== null) {
    const r = checkCode(
      'highestQualificationCode',
      details.highestQualificationCode,
      'qualification',
      codeSets,
      asAt,
    );
    note(r.issue, r.checked);
  }
  details.ethnicGroupCodes.forEach((code, i) => {
    const r = checkCode(`ethnicGroupCodes[${i}]`, code, 'ethnic_group', codeSets, asAt);
    note(r.issue, r.checked);
  });

  return {
    staffMemberId: member.id,
    fullName: member.fullName,
    roleKind,
    hoursWorked,
    contractedMinutes: minutes,
    contactHours: blocks,
    isRegistered,
    missing,
    codeIssues,
    reportable: missing.length === 0 && codeIssues.length === 0,
    codesChecked: allChecked,
  };
}

/**
 * The staffing section of an ECE Return, as at a date, with its gaps.
 *
 * The roster is `currentStaff(members, asAt)` — people who had started and had not
 * finished by the return date — rather than everybody the centre has ever held a
 * record for. A person who left in March is not on the return, and a person hired in
 * December is, which is a decision the caller can override by filtering first.
 */
export function summariseCensus(
  inputs: CensusStaffInput[],
  records: StaffRecord[],
  asAt: string,
  codeSets?: LoadedCodeSet[],
): CensusSummary {
  const roster = new Set(currentStaff(inputs.map((i) => i.member), asAt).map((m) => m.id));
  const onRoster = inputs.filter((i) => roster.has(i.member.id));

  const assembled = onRoster.map((i) => censusRow(i, records, asAt, codeSets));
  const rows: CensusStaffRow[] = assembled.map(({ codesChecked: _ignored, ...row }) => row);

  // Three states, and the distinction is the point: no sets supplied at all means
  // nothing was attempted, which must not render the same as everything passing.
  const codesChecked =
    codeSets === undefined || codeSets.length === 0
      ? null
      : assembled.every((r) => r.codesChecked);

  const incompleteCount = rows.filter((r) => !r.reportable).length;

  return {
    asAt,
    rows,
    incompleteCount,
    complete: rows.length > 0 && incompleteCount === 0,
    codesChecked,
  };
}
