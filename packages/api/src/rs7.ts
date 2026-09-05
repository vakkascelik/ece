import {
  countedStaffHours,
  rs7DayCounts,
  sixFourOverlaps,
  type OffFloorInterval,
  type ParityAttestationCode,
  type Rs7DayCounts,
  type Rs7Declaration,
  type FundingPeriod,
} from '@ece/core';

import { readFundingPeriod } from './billing';
import { listChildren } from './children';
import { listStaffRecords } from './compliance';
import { fetchAll } from './paging';
import { listStaffAttendance, listStaffMembers } from './staff';

import type { Db } from './index';

/**
 * The RS7 declaration — `rs7_declarations` (0096).
 *
 * Six fields, all recorded from the service and none derived. The policies are owner-or-manager
 * for **select** as well as the write verbs, which is narrower than most tables here and
 * deliberate: it is a legal attestation about how a service pays its teachers, and an educator
 * has no reason to read their employer's salary declaration.
 *
 * No tenant filtering, as everywhere in this package. `centre_id` is on the row and RLS decides.
 */

const COLUMNS =
  'period_start_date, salaries_attestation, parity_attestation, parity_attestation_code, submitter_name, contact_number, designation';

interface DeclarationRow {
  period_start_date: string;
  salaries_attestation: boolean | null;
  parity_attestation: boolean | null;
  parity_attestation_code: string | null;
  submitter_name: string | null;
  contact_number: string | null;
  designation: string | null;
}

const toDeclaration = (r: DeclarationRow): Rs7Declaration => ({
  periodStartDate: r.period_start_date,
  salariesAttestation: r.salaries_attestation,
  parityAttestation: r.parity_attestation,
  /*
    Cast rather than validated. The CHECK in 0096 is the guard, and it lists the same six values
    `PARITY_ATTESTATION_CODES` does — re-validating here would be a second copy of the
    enumeration that can disagree with the first, which is the divergence `tokens:check` exists
    because of.
  */
  parityAttestationCode: r.parity_attestation_code as ParityAttestationCode | null,
  submitterName: r.submitter_name,
  contactNumber: r.contact_number,
  designation: r.designation,
});

/**
 * The declaration for one funding period, or `null` where none has been recorded.
 *
 * `maybeSingle()` rather than `single()`: no declaration is the normal state for a period
 * nobody has signed yet, and an error there would make the whole RS7 screen fail to render
 * over a form somebody has not filled in.
 *
 * Bounded by the unique constraint on `(centre_id, period_start_date)`, so nothing to page.
 */
export async function readRs7Declaration(
  db: Db,
  centreId: string,
  periodStartDate: string,
): Promise<Rs7Declaration | null> {
  const { data, error } = await db
    .from('rs7_declarations')
    .select(COLUMNS)
    .eq('centre_id', centreId)
    .eq('period_start_date', periodStartDate)
    .maybeSingle();
  if (error) throw new Error(`readRs7Declaration: ${error.message}`);
  return data ? toDeclaration(data as DeclarationRow) : null;
}

export interface Rs7DeclarationInput {
  /** `undefined` leaves a field alone; `null` sets it back to not stated. */
  salariesAttestation?: boolean | null;
  parityAttestation?: boolean | null;
  parityAttestationCode?: ParityAttestationCode | null;
  submitterName?: string | null;
  contactNumber?: string | null;
  designation?: string | null;
}

/**
 * Record or amend the declaration for a period.
 *
 * AN UPSERT, AND IT IS A THIRD STATEMENT UNDER RLS. `insert … on conflict do update` is checked
 * against the insert `WITH CHECK` **and** the update `USING`/`WITH CHECK`, so a caller who may
 * do one and not the other is refused with `42501` — an error, not zero rows. Both policies here
 * are the same owner-or-manager predicate, so the three agree; this comment exists because the
 * next person to narrow one of them will not otherwise know the upsert reads all three.
 *
 * **`undefined` leaves a column alone and `null` clears it**, which is the same contract
 * `updateCentre` keeps. That distinction matters more here than usual: clearing an attestation
 * back to *not stated* is a thing a service may legitimately want to do, and a shape that could
 * only set true or false would make an accidental attestation impossible to withdraw.
 */
export async function saveRs7Declaration(
  db: Db,
  centreId: string,
  periodStartDate: string,
  input: Rs7DeclarationInput,
): Promise<Rs7Declaration> {
  const { data: auth } = await db.auth.getUser();

  const row: Record<string, unknown> = {
    centre_id: centreId,
    period_start_date: periodStartDate,
    recorded_by: auth.user?.id ?? null,
  };
  if (input.salariesAttestation !== undefined) row.salaries_attestation = input.salariesAttestation;
  if (input.parityAttestation !== undefined) row.parity_attestation = input.parityAttestation;
  if (input.parityAttestationCode !== undefined) {
    row.parity_attestation_code = input.parityAttestationCode;
  }
  if (input.submitterName !== undefined) row.submitter_name = input.submitterName;
  if (input.contactNumber !== undefined) row.contact_number = input.contactNumber;
  if (input.designation !== undefined) row.designation = input.designation;

  const { data, error } = await db
    .from('rs7_declarations')
    .upsert(row, { onConflict: 'centre_id,period_start_date' })
    .select(COLUMNS)
    .single();

  if (error) {
    /*
      The two CHECKs are transcriptions of the Ministry's own schema, so a violation means the
      value would have been rejected on submission. Saying which one, in words, beats a bare
      23514 that sends somebody looking through six fields.
    */
    if (/rs7_declarations_parity_code_known/.test(error.message)) {
      throw new Error(
        'saveRs7Declaration: that is not one of the six pay parity steps the RS7 schema allows.',
      );
    }
    if (/rs7_declarations_period_is_a_return_period/.test(error.message)) {
      throw new Error(
        'saveRs7Declaration: an RS7 period starts on 1 February, 1 June or 1 October.',
      );
    }
    if (/rs7_declarations_names_not_blank/.test(error.message)) {
      throw new Error('saveRs7Declaration: a name, contact number or designation cannot be blank.');
    }
    throw new Error(`saveRs7Declaration: ${error.message}`);
  }
  return toDeclaration(data as DeclarationRow);
}


// ---------------------------------------------------------------------------
// The whole return, assembled
// ---------------------------------------------------------------------------

interface OffFloorRow {
  staff_member_id: string;
  on_date: string;
  from_time: string;
  to_time: string;
}

/**
 * Off-floor intervals for a centre over a period — `staff_off_floor` (0094).
 *
 * Joined through `staff_members` because the table has no `centre_id` of its own: a person
 * belongs to a centre and their intervals belong to the person.
 *
 * Paged. A centre with twenty staff taking one break each is twenty rows a day, so a
 * four-month period passes a thousand comfortably, and a truncated read would silently return
 * MORE staff hours than the service worked — the direction that over-claims.
 */
async function listOffFloor(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<OffFloorInterval[]> {
  const rows = await fetchAll<OffFloorRow>('listOffFloor', (a, b) =>
    db
      .from('staff_off_floor')
      .select('staff_member_id, on_date, from_time, to_time, staff_members!inner(centre_id)')
      .eq('staff_members.centre_id', centreId)
      .gte('on_date', from)
      .lte('on_date', to)
      .order('staff_member_id')
      .order('on_date')
      .order('from_time')
      .range(a, b),
  );
  return rows.map((r) => ({
    staffMemberId: r.staff_member_id,
    onDate: r.on_date,
    fromTime: r.from_time,
    toTime: r.to_time,
  }));
}

/**
 * The RS7 return for one funding period.
 *
 * Assembles what four modules already compute rather than recomputing any of it: the children's
 * funded hours from `readFundingPeriod`, §6-4's cross-child overlaps from `sixFourOverlaps`,
 * §9-4's counted staff hours from `countedStaffHours`, and the declaration from `0096`.
 *
 * THE STAFF HALF IS CONDITIONAL, and the condition is the centre's own configuration.
 * `centres.ratio_source` decides whether per-person staff attendance exists at all: a
 * `declared` centre records a typed adult total and nothing per person, so there is nothing to
 * pair and nothing to subtract off-floor time from. For that centre the two staff figures stay
 * `null` with a named gap, which is the honest answer rather than a zero.
 */
export async function readRs7Return(
  db: Db,
  input: {
    centreId: string;
    period: FundingPeriod;
    timeZone: string;
    fromUtc: string;
    toUtc: string;
    /** From `centres.ratio_source`. Only `derived` yields per-person staff hours. */
    ratioSource: 'declared' | 'derived';
    licensedPlaces: number | null;
  },
): Promise<Rs7DayCounts> {
  const [summary, children, declaration] = await Promise.all([
    readFundingPeriod(db, {
      centreId: input.centreId,
      period: input.period,
      timeZone: input.timeZone,
      fromUtc: input.fromUtc,
      toUtc: input.toUtc,
    }),
    listChildren(db, input.centreId, { includeArchived: true }),
    readRs7Declaration(db, input.centreId, input.period.from),
  ]);

  /*
    Dates of birth come from `listChildren` and not from `summary.children`, which drops any
    child contributing nothing to the period — see `readFundingPeriod`'s filter. A child with no
    funded hours contributes no hours either way, but taking the map from the funding summary
    would make the age lookup silently depend on that filter's rules.
  */
  const datesOfBirth = new Map(children.map((c) => [c.id, c.dateOfBirth ?? null]));

  const overlaps = new Map(
    sixFourOverlaps({ children: summary.children, licensedPlaces: input.licensedPlaces }).map(
      (o) => [o.date, o.overlapHours],
    ),
  );

  let staff:
    | { totals: ReturnType<typeof countedStaffHours>['totals']; gaps: string[] }
    | undefined;

  if (input.ratioSource === 'derived') {
    const [members, events, offFloor, records] = await Promise.all([
      listStaffMembers(db, input.centreId),
      listStaffAttendance(db, input.centreId, input.fromUtc, input.toUtc),
      listOffFloor(db, input.centreId, input.period.from, input.period.to),
      listStaffRecords(db, input.centreId, { includeArchived: true }),
    ]);

    const byMember = new Map<string, typeof events>();
    for (const e of events) {
      const list = byMember.get(e.staffMemberId);
      if (list) list.push(e);
      else byMember.set(e.staffMemberId, [e]);
    }

    /*
      Certificates per person, as at the date being counted rather than as at today.

      The currency rule is `countCertificated`'s, restated here because that function answers a
      different question — how many of the current roster are certificated NOW — and cannot be
      asked about a past date. A null `expiresOn` is NOT current: every practising certificate
      has one, so a blank is an unfinished record rather than a document that never lapses.

      `null` where the person has no practising certificate on file at all, which puts their
      hours in neither RS7 bucket. Archived records are excluded; an archived certificate is one
      somebody removed, not one that lapsed.
    */
    const certificatesOf = new Map<string, string[]>();
    for (const r of records) {
      if (r.kind !== 'practising_certificate' || r.archivedAt !== null) continue;
      if (r.staffMemberId === null || r.expiresOn === null) continue;
      const list = certificatesOf.get(r.staffMemberId);
      if (list) list.push(r.expiresOn);
      else certificatesOf.set(r.staffMemberId, [r.expiresOn]);
    }

    const computed = countedStaffHours({
      staff: members.map((m) => ({
        staffMemberId: m.id,
        events: (byMember.get(m.id) ?? []).map((e) => ({
          id: e.id,
          kind: e.kind,
          at: e.at,
          corrects: e.corrects,
        })),
        qualifiedOn: (date: string) => {
          const expiries = certificatesOf.get(m.id);
          if (expiries === undefined) return null;
          return expiries.some((expiresOn) => expiresOn >= date);
        },
      })),
      offFloor,
      timeZone: input.timeZone,
    });
    staff = { totals: computed.totals, gaps: [...computed.gaps] };
  }

  return rs7DayCounts({
    children: summary.children,
    datesOfBirth,
    period: input.period,
    sixFourOverlapHours: overlaps,
    staffHours: staff?.totals,
    staffHourGaps: staff?.gaps,
    declaration,
  });
}
