/**
 * Funded hours, and the RS7 preparation figures.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE RELYING ON THE NUMBERS
 *
 * `FUNDING_RULES_VERIFIED` is **false**, and what that now covers is narrower than it was.
 *
 * **Confirmed 2026-08-18** against the Ministry's ELI data collection business rules and the RS7
 * return specification, both supplied by the Ministry: the 20 Hours ECE caps of 6 hours per day and
 * 20 per week, the age band they apply to (3 or older, under 6), and the three four-monthly funding
 * periods in `ministryFundingPeriods`.
 *
 * **Read 2026-08-18, and now a known gap rather than an unknown one.** Chapter 6 of the Funding
 * Handbook — sections 6-4, 6-5 and 6-7 — says absence funding is real:
 *
 *   6-4  Funding may be claimed for hours a **permanently enrolled** child did not attend, if the
 *        absence falls under one of the absence rules. For a **casual or conditional** child,
 *        funding is on attendance ONLY, and a booked no-show must not be claimed.
 *   6-5  Three Week Rule: claim every enrolled-but-absent session within three weeks of the FIRST
 *        day of absence. Nothing from the fourth week on. Funding resumes when the child returns,
 *        and stops the moment a parent says the child is not coming back — even mid-window, or the
 *        Ministry recovers it.
 *   6-7  Frequent Absence Rule: attendance must match the enrolment agreement for at least half of
 *        each calendar month. Flagged in month 1, reconfirmed in month 2, month 3 claimable only if
 *        reconfirmed, month 4 not claimable and the agreement must change.
 *
 * **This file claims none of it, and cannot yet.** Funded hours come from attendance events, so an
 * absent day contributes zero. Two things follow, and the second is why the gap is not a bug here:
 *
 * - For a casual or conditional child, attendance-only is **exactly what 6-4 requires**. This
 *   calculation is already correct for them.
 * - For a permanently enrolled child it **under-claims**, and losing a centre funding it is owed is
 *   the same class of failure as over-claiming — it is the reason a broken day is named rather than
 *   silently zeroed.
 *
 * The blocker is the schema, not the arithmetic: `enrolments` has no permanent/casual distinction,
 * and 6-4 turns on exactly that. Adding absence funding means an enrolment type, a three-week
 * window per absence spell, monthly frequent-absence checks and a record of reconfirmations. That is
 * a feature with decisions in it, not a patch, so it is named here and in `exportDisclaimer` rather
 * than half-built.
 *
 * **The flag stays `false` for that reason**, and it is now precise about why: the rules are read,
 * the caps and periods are confirmed, and a whole class of claimable day is not implemented. A flag
 * reading "verified" over that would be worse than one that says nothing — the same discipline as
 * the ratio bands in `ratios.ts`.
 *
 * There are **no funding rates here at all** — no dollars per child-hour. A rate is a number the
 * Ministry publishes and changes, and inventing one would let a centre budget against a figure this
 * product made up. Rates belong in a fee schedule the centre enters, or nowhere.
 *
 * Confirm the caps and the periods, then flip the flag in a commit that says who read what.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS CANNOT DO, BY DESIGN
 *
 * It cannot submit anything. Submitting a funding return requires being a Ministry-approved student
 * management system integrated with ELI, and this product is not one. So the output is a
 * **preparation export**: figures a manager keys into ELI Web themselves.
 *
 * CORRECTED 2026-09-02: this comment said "the Ministry is not accepting integration applications
 * — confirmed by the Ministry on 2026-08-18 as still under review, with no published end date."
 * That was true when written and is now false. The review concluded and the Ministry's page, last
 * updated 2026-09-01, opens a 2026 tranche closing 5pm Friday 30 October 2026 with **one** place
 * available, decided on a readiness assessment. What has not changed is the sentence above it:
 * this product cannot submit, because it is not an approved SMS and would not become one for
 * 12–18 months after being selected. See docs/eli-integration-2026-tranche.md.
 *
 * CORRECTED 2026-08-18: this comment used to add "and approval requires supporting 50 services
 * *before* applying". That is wrong. The requirement is that the product be *capable* of supporting
 * 50 services across the licence types, not that fifty already use it. Left visible rather than
 * deleted because the customer-count reading is what put an ELI integration in the roadmap's
 * "deliberately not doing this" list. See llm-wiki/wiki/funding-and-billing.md.
 *
 * Every label in the product says "preparation", never "return" or "submission", so nobody can
 * believe a return was filed because a screen looked finished.
 */

import { ageInMonths } from './children';
import { attendedHours, toHours, type HoursEvent } from './hours';

/** Has anybody checked these against the Funding Handbook? Flipping this is a claim about policy. */
export const FUNDING_RULES_VERIFIED = false;

export interface FundingCaps {
  /**
   * Maximum funded hours in one day.
   *
   * Basis: 20 Hours ECE is commonly described as capped at 6 hours per day and 20 per week.
   * **Unverified.**
   */
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  /** Where these came from, shown wherever the figures are. */
  basis: string;
}

export const DEFAULT_CAPS: FundingCaps = {
  maxHoursPerDay: 6,
  maxHoursPerWeek: 20,
  basis:
    '20 Hours ECE: 6 hours per day and 20 per week, for a child aged 3 or older and under 6. Confirmed 2026-08-18 against the Ministry ELI data collection business rules.',
};

/**
 * The 20 Hours ECE age band, in whole months.
 *
 * The entitlement runs from a child's third birthday to their sixth: "3 years or older but less
 * than 6 years old". The Ministry states this as a business rule it checks automatically and raises
 * with vendors, which is what makes it worth enforcing here rather than trusting the tick box.
 *
 * Months rather than years because `ageInMonths` does calendar arithmetic and a birthday must land
 * on the day it falls, not somewhere inside a rounding error.
 */
const TWENTY_HOURS_MIN_MONTHS = 36;
const TWENTY_HOURS_MAX_MONTHS = 72;

/**
 * A funding period.
 *
 * Deliberately supplied by the caller rather than computed. The Ministry's funding periods have
 * published boundaries this file does not know, and deriving them from a guess would put a wrong
 * date range on every figure in the export — where it would look authoritative.
 */
export interface FundingPeriod {
  label: string;
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive. */
  to: string;
}

export interface ChildFunding {
  childId: string;
  /** What the child actually attended, from the events. */
  attendedHours: number;
  /**
   * What may be claimed: attended hours with the caps applied, complete days only.
   *
   * Never greater than `attendedHours`, and never includes a day whose record is broken.
   */
  fundedHours: number;
  /** Hours on days that could not be computed. Not claimable until the record is fixed. */
  unresolvedHours: number;
  /** Days needing a human before this child's figure is complete. */
  unresolvedDates: string[];
  /** Days where the daily cap bit, so a manager can see why attended and funded differ. */
  cappedDates: string[];
  /**
   * Days this child was attested for 20 Hours ECE and was outside the 3-to-under-6 band.
   *
   * **The hours are still counted.** Two reasons, and the second is the one that decides it: the
   * hours are not in doubt — only the entitlement is — so excluding them would be the estimating
   * this file exists not to do; and the attestation belongs to the centre, which is the party that
   * can fix it. So this names the problem and leaves the arithmetic alone, the same way a capped
   * day is reported rather than silently trimmed.
   *
   * Empty when the child has no date of birth, which is not the same as "eligible" — it means no
   * check was possible. An attested child with no date of birth is an enrolment somebody has not
   * finished, and it shows up as that on the child's record rather than as a funding figure.
   */
  ineligibleDates: string[];
  twentyHoursEce: boolean;
}

export interface FundingSummary {
  period: FundingPeriod;
  children: ChildFunding[];
  totalFundedHours: number;
  /**
   * True when every child's record is complete for the period.
   *
   * The export leads with this. A summary that looks final while three children have missing
   * sign-outs is a summary that gets keyed into ELI Web.
   */
  complete: boolean;
  unresolvedChildCount: number;
  /**
   * Children attested for 20 Hours ECE on at least one day they were outside the age band.
   *
   * Separate from `complete`, because it is a different kind of problem: an incomplete record
   * cannot be calculated, while this one calculates fine and may not be claimable. Folding it into
   * `complete` would either block an export over somebody else's tick box or hide it entirely.
   */
  ineligibleChildCount: number;
  /**
   * The first day this centre has any attendance record for, in its own timezone.
   *
   * Null means either "no attendance events at all" or "the caller did not supply it" —
   * `periodPrecedesRecord` is what tells those apart, and it is the field to read.
   */
  recordStartsOn: string | null;
  /**
   * Does this period begin before the attendance record does?
   *
   * **Three states, and null is not false.** `true` = the record does not cover the whole
   * period. `false` = it does. `null` = nobody said, so nothing is claimed either way — the
   * `overdue: null` contract from `drillStatuses`, and it must render differently from `false`.
   *
   * WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL
   *
   * `childFunding` filters a child's days into `complete` and `unresolved`. A child with **no
   * attendance rows at all** in the period yields an empty `inPeriod`, so both lists are empty:
   * `fundedHours` is 0 and `unresolvedDates` is `[]`. `unresolvedChildCount` is therefore 0 and
   * `complete` is **true**. The period reports zero hours and declares itself final.
   *
   * That is correct arithmetic on the rows that exist and a false picture of the period. The
   * "excluded and named" treatment this file insists on for a *broken* day cannot fire, because
   * a period with no records is not a broken record — it is silence, and silence reads as zero.
   *
   * It bites the moment a centre starts using this product partway through a funding period,
   * which every centre does exactly once, and RS7 periods are four-monthly.
   *
   * WHY IT IS NOT FOLDED INTO `complete`
   *
   * The same argument `ineligibleChildCount` above makes for itself: it is a different kind of
   * problem. An incomplete record cannot be calculated; this one calculates fine over a period
   * the records do not cover. Folding it in would overload one boolean with two failures that
   * need different actions — fix the record, versus do not use this period at all.
   */
  periodPrecedesRecord: boolean | null;
  verified: boolean;
  capsBasis: string;
}

/**
 * When this centre's attendance record begins.
 *
 * A parameter object rather than a bare `string | null`, so the two nulls stay apart at the call
 * site: not passing this at all means "unknown", while passing `{ startsOn: null }` means "there
 * are no attendance events" — a much stronger statement, and the worse of the two.
 */
export interface AttendanceRecordStart {
  /**
   * The earliest attendance event for the centre, as a calendar date in the centre's timezone.
   * `null` when the centre has no attendance events at all, which makes every period precede it.
   */
  startsOn: string | null;
}

/** ISO week key, so the weekly cap can be applied to the right seven days. */
function isoWeekKey(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  // Thursday of the same ISO week determines the year and week number.
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Funded hours for one child over one period.
 *
 * Order of operations matters and is the conservative one: compute attended hours, discard days
 * whose record is broken, apply the daily cap, then apply the weekly cap to what survives. Applying
 * the weekly cap first would let an over-long Monday absorb capacity that Tuesday was entitled to.
 */
export function childFunding(input: {
  childId: string;
  events: HoursEvent[];
  timeZone: string;
  period: FundingPeriod;
  twentyHoursEce: boolean;
  /** Needed only to check the 20 Hours age band. Null means the check cannot run — see `ineligibleDates`. */
  dateOfBirth?: string | null;
  caps?: FundingCaps;
}): ChildFunding {
  const caps = input.caps ?? DEFAULT_CAPS;
  const all = attendedHours({ events: input.events, timeZone: input.timeZone });

  const inPeriod = all.days.filter((d) => d.date >= input.period.from && d.date <= input.period.to);
  const complete = inPeriod.filter((d) => d.complete);
  const unresolved = inPeriod.filter((d) => !d.complete);

  const cappedDates: string[] = [];
  const ineligibleDates: string[] = [];
  const perDay = complete.map((day) => {
    const hours = toHours(day.minutes);
    // Caps apply only to the 20 Hours ECE entitlement. Without the attestation there is nothing
    // here to cap, and pretending otherwise would understate an ordinary fee-paying enrolment.
    if (!input.twentyHoursEce) return { date: day.date, hours };
    // Age as at the day being counted, never as at today. A child who turned three in March was
    // not entitled in February, and using today's age would rewrite that in the centre's favour —
    // the same reasoning `replayDay` applies to the ratio bands.
    if (input.dateOfBirth) {
      const months = ageInMonths(input.dateOfBirth, day.date);
      if (months < TWENTY_HOURS_MIN_MONTHS || months >= TWENTY_HOURS_MAX_MONTHS) {
        ineligibleDates.push(day.date);
      }
    }
    if (hours > caps.maxHoursPerDay) {
      cappedDates.push(day.date);
      return { date: day.date, hours: caps.maxHoursPerDay };
    }
    return { date: day.date, hours };
  });

  let fundedHours = 0;
  if (!input.twentyHoursEce) {
    fundedHours = perDay.reduce((t, d) => t + d.hours, 0);
  } else {
    // Weekly cap, per ISO week, on what the daily cap already allowed.
    const byWeek = new Map<string, number>();
    for (const d of perDay) {
      byWeek.set(isoWeekKey(d.date), (byWeek.get(isoWeekKey(d.date)) ?? 0) + d.hours);
    }
    for (const weekHours of byWeek.values()) {
      fundedHours += Math.min(weekHours, caps.maxHoursPerWeek);
    }
  }

  return {
    childId: input.childId,
    attendedHours: toHours(complete.reduce((t, d) => t + d.minutes, 0)),
    // Rounded down again after summing, so the total cannot creep above the sum of its parts.
    fundedHours: Math.floor(fundedHours * 100) / 100,
    unresolvedHours: toHours(unresolved.reduce((t, d) => t + d.minutes, 0)),
    unresolvedDates: unresolved.map((d) => d.date),
    cappedDates,
    ineligibleDates,
    twentyHoursEce: input.twentyHoursEce,
  };
}

export function summariseFunding(
  period: FundingPeriod,
  children: ChildFunding[],
  /**
   * Optional so no existing caller breaks, and every caller that produces a figure somebody
   * keys into ELI Web should pass it. Omitting it yields `periodPrecedesRecord: null` —
   * "nobody said", which is honest, and is not the same as "the record covers this".
   */
  recordStart?: AttendanceRecordStart,
): FundingSummary {
  const unresolvedChildCount = children.filter((c) => c.unresolvedDates.length > 0).length;

  const periodPrecedesRecord =
    recordStart === undefined
      ? null
      : recordStart.startsOn === null
        ? // No attendance events anywhere in this centre. Every period precedes the record,
          // including this one, and the total below is zero for that reason rather than because
          // nobody attended.
          true
        : // String comparison is correct and intentional: both are `YYYY-MM-DD` in the centre's
          // own timezone, which sorts lexicographically. No Date is constructed, so no zone is
          // consulted and there is nothing here for `localDates.test.ts` to catch.
          recordStart.startsOn > period.from;

  return {
    period,
    children,
    totalFundedHours: Math.floor(children.reduce((t, c) => t + c.fundedHours, 0) * 100) / 100,
    complete: unresolvedChildCount === 0,
    unresolvedChildCount,
    ineligibleChildCount: children.filter((c) => c.ineligibleDates.length > 0).length,
    recordStartsOn: recordStart?.startsOn ?? null,
    periodPrecedesRecord,
    verified: FUNDING_RULES_VERIFIED,
    capsBasis: (children[0] ? DEFAULT_CAPS : DEFAULT_CAPS).basis,
  };
}

/**
 * The sentence at the top of the export.
 *
 * Written here rather than in the page so both the screen and any future emailed version say the
 * same thing — and so the wording is reviewable in one place, because it is the sentence that stops
 * somebody believing a return was filed.
 */
export function exportDisclaimer(summary: FundingSummary): string {
  const parts = [
    'These are preparation figures for keying into ELI Web. Nothing has been submitted to the Ministry, and this system cannot submit.',
    /*
      Added 2026-08-31, and it is the only sentence here the Ministry asked for by name. Its
      reply of that date, which confirmed a service may keep its Chapter 6 records outside an
      approved SMS, closes by addressing vendors: customers must be told that use of the
      system "does not remove the service's responsibility to comply with Ministry funding,
      record-keeping, and reporting requirements", and that RS7 figures a system produces are
      there to *support* the return — the service "remains responsible for reviewing,
      validating, and submitting", including "any over-claiming or under-claiming".

      THREE THINGS ABOUT THE SHAPE, EACH OF WHICH WAS A DECISION.

      It is UNCONDITIONAL. Every other sentence in this function is gated on something being
      wrong. This one is not, because it is true on the day every flag goes green — and the
      obvious place to put it, behind `!summary.verified`, is a wiring that deletes it exactly
      when the figures look most trustworthy and a manager is least likely to check them.

      It is in OUR WORDS, not the Ministry's. Quoting a marked government email at a customer
      implies the Ministry is speaking about this product. It is not: it described the
      conditions under which any system qualifies, and reviewed nothing here.

      It sits SECOND, not last. The sentences after it are the ones a manager can act on today
      — days to resolve, enrolments to check — and a paragraph that is skimmed should end on
      the actionable thing. This one belongs with "what this document is", which is the first
      sentence's job.
    */
    'Using this system does not move any of your obligations to the Ministry. You remain responsible for your funding, record-keeping and reporting requirements, and for reviewing and validating these figures — including any over- or under-claim in them — before anything is submitted.',
  ];

  /*
    First, and ahead of the unresolved-days sentence, because it is the more serious of the two
    and the only one that is invisible in the figures.

    An unresolved day announces itself — the total is missing hours somebody can go and fix. A
    period that starts before the records do produces a total that looks finished and is simply
    too small, with nothing on the page to suggest it. Order matters in a paragraph somebody
    skims before keying a number into a Ministry system.
  */
  if (summary.periodPrecedesRecord === true) {
    parts.push(
      summary.recordStartsOn === null
        ? 'This centre has no attendance records at all, so every figure below is zero because nothing has been recorded — not because nobody attended. Do not key these into a return.'
        : `This period starts on ${summary.period.from}, but the attendance record here does not begin until ${summary.recordStartsOn}. Days before that are missing rather than empty, so the total below is lower than what was actually attended. Use the system that holds the earlier records for this period.`,
    );
  }

  if (!summary.complete) {
    parts.push(
      `${summary.unresolvedChildCount} ${summary.unresolvedChildCount === 1 ? 'child has' : 'children have'} days that could not be calculated because the attendance record is incomplete. Those days are excluded from the totals below — resolve them and re-run before using these figures.`,
    );
  }
  if (summary.ineligibleChildCount > 0) {
    parts.push(
      `${summary.ineligibleChildCount} ${summary.ineligibleChildCount === 1 ? 'child is' : 'children are'} marked as 20 Hours ECE on days when they were under 3 or 6 and over. Their hours are included as recorded — check the enrolment before claiming, because the entitlement runs from the third birthday to the sixth.`,
    );
  }
  if (!summary.verified) {
    /*
      Narrowed 2026-08-18. This used to say the caps had not been checked; they have been, and the
      sentence was becoming the false-caveat problem the ratio banner just went through. What is
      actually missing is absence funding, so the disclaimer names it — a manager can act on "you
      may be able to claim more than this", and cannot act on "something is unverified".
    */
    parts.push(
      'These figures count attended hours only. Under sections 6-4 to 6-7 of the Funding Handbook a service may also claim funding for days a permanently enrolled child was booked but absent, and this system does not calculate that — so the total may be lower than what you are entitled to claim.',
    );
  }
  return parts.join(' ');
}

/**
 * The Ministry's three funding periods for a calendar year.
 *
 * Added 2026-08-18. `FundingPeriod` is still supplied by the caller — a centre may want an
 * arbitrary window, and a period that cannot be chosen is a screen somebody works around. What
 * changed is that the real boundaries are now known, so a manager no longer has to invent dates on
 * a document that looks official.
 *
 * The periods are four-monthly and one of them straddles the new year: February–May, June–September,
 * and October–January. `year` names the year the period **starts** in, so `2026` gives an
 * October 2026 – January 2027 period.
 *
 * Not modelled here, deliberately: the submission window (a period may be submitted from the first
 * of the month after it ends, and the electronic cut-off is three months later — 31 August,
 * 31 December, 30 April respectively). That belongs with a reminder somebody has asked for, and
 * this product cannot submit anything, so a cut-off date here would describe a deadline it plays no
 * part in.
 */
export function ministryFundingPeriods(year: number): FundingPeriod[] {
  const next = year + 1;
  return [
    { label: `February–May ${year}`, from: `${year}-02-01`, to: `${year}-05-31` },
    { label: `June–September ${year}`, from: `${year}-06-01`, to: `${year}-09-30` },
    { label: `October ${year} – January ${next}`, from: `${year}-10-01`, to: `${next}-01-31` },
  ];
}

// ---------------------------------------------------------------------------
// Claimed against received (0046)
// ---------------------------------------------------------------------------

export interface FundingReceipt {
  id: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  /** Null means the centre has not stated one. Not zero. */
  claimedCents: number | null;
  receivedCents: number;
  receivedOn: string | null;
}

export interface FundingVariance extends FundingReceipt {
  /**
   * Claimed minus received, in cents. **Null when no claim was stated** — the whole
   * point of the distinction.
   *
   * Positive means the Ministry paid less than the centre claimed, which is the case
   * worth a phone call. Negative means it paid more, which is worth one too: an
   * overpayment that nobody notices is a debt nobody has budgeted for.
   */
  varianceCents: number | null;
}

/**
 * Compare what a centre says it claimed against what arrived.
 *
 * **Nothing here computes a claim.** This product holds no funding rates — none are in
 * the repo, deliberately — so both figures are entered by the centre and this does the
 * subtraction. Multiplying the funded hours on `/funding` by a rate would put a dollar
 * sign on a number nobody has checked, which is the one thing this feature must not do.
 *
 * A period with no stated claim is **not** treated as a claim of zero. Zero would make
 * every unstated period look like a total overpayment and bury the real ones.
 */
export function summariseVariance(receipts: FundingReceipt[]): {
  rows: FundingVariance[];
  /** Total shortfall across periods where a claim WAS stated. */
  shortfallCents: number;
  /** Total overpayment, kept separate — it is a different conversation. */
  overpaidCents: number;
  /** How many periods cannot be compared at all. */
  unstated: number;
} {
  const rows = receipts.map((r) => ({
    ...r,
    varianceCents: r.claimedCents === null ? null : r.claimedCents - r.receivedCents,
  }));

  let shortfallCents = 0;
  let overpaidCents = 0;
  let unstated = 0;
  for (const row of rows) {
    if (row.varianceCents === null) unstated += 1;
    else if (row.varianceCents > 0) shortfallCents += row.varianceCents;
    else overpaidCents += -row.varianceCents;
  }

  // Worst shortfall first; unstated periods last, because they are a data problem
  // rather than a money one.
  rows.sort((a, b) => (b.varianceCents ?? -Infinity) - (a.varianceCents ?? -Infinity));

  return { rows, shortfallCents, overpaidCents, unstated };
}
