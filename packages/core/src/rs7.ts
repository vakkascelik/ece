/**
 * The RS7 return's daily counts — Handbook §9-2, §9-4 and §14-4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SIX FIGURES ARE, BECAUSE THE ELEMENT NAMES READ LIKE HEADCOUNTS
 *
 * `SubsidyFundedChildUnderTwoCount` and its siblings are **hours**, not children. Checked
 * rather than assumed, and four of the six are sourced directly:
 *
 *   - §14-4 names two of them *"daily total of 20 Hours ECE Funded Hours (20 Hours ECE)"* and
 *     *"…(Plus 10)"*.
 *   - §9-4 says of the staff figures *"Round the total to the nearest hour. For example: 68
 *     hours and 30 minutes would be rounded to 69 hours"*.
 *   - §9-2's step 4 for the subsidy figures is *"Add together the claimable hours for each
 *     day"*, and step 5 rounds that total.
 *
 * The Glossary explains the naming: a **funded child hour** is *"an occupied child-place that
 * is funded for 1 hour"*, so `SubsidyFundedChild…Count` is a count of funded child *hours*.
 * `StaffHourQualifiedCount` makes the construction plain — it is a count of `StaffHour`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ROUNDING — ITEM 52, AND IT HAS TWO HALVES
 *
 * §9-2 step 5: *"Round the total to the nearest whole number. Numbers ending in 0.5 or above
 * should be rounded up to the next whole number. Numbers ending in 0.4 or below should be
 * rounded down to the previous number."*
 *
 * So: **to nearest, and at the aggregate.** Rounding each child's hours and summing gives a
 * different answer, and it is the answer a per-child calculation produces naturally.
 *
 * `toHours` in `./hours` **floors**, deliberately, because a preparation figure must never
 * overstate what a service may claim. This file must not reuse it, and there is deliberately
 * no shared helper with a `mode` parameter: that puts the choice at the call site, where it
 * gets got wrong once, silently, on a return to the Crown.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE ALLOCATIONS THE HANDBOOK DOES NOT MAKE, AND WHY THEY ARE UNAVOIDABLE HERE
 *
 * Everywhere else this product reports rather than adjusts when a rule is ambiguous. That is
 * not available here: RS7 asks for a **daily** figure and the Handbook's rules are weekly, so
 * some projection onto days is forced. Each one below is chronological — hours are claimed as
 * they occur — which is the only order that preserves the weekly totals the Handbook does
 * state. All three are disclosed in `assumptions`, not buried.
 *
 *   1. **Which days lose the excess when a week is capped.** `funding.ts` refuses to answer
 *      this and says why: the Handbook states the 30-hour maximum and never says which days
 *      go. Chronological here means the later days lose it.
 *   2. **Which of a week's hours are 20 Hours ECE and which are Plus 10.** §9-3 caps 20 Hours
 *      at 20 a week and calls Plus 10 *"the remainder (up to 30 hours)"*, so the first twenty
 *      of a week are the entitlement. This is the same split `childFunding` already applies
 *      weekly, projected onto dates in the only order that preserves it.
 *   3. **Which replacement child loses their hours under §6-4.** Largest claim first, so the
 *      figure never runs high. See `sixFourOverlaps`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STAFF FIGURES ARE SUPPLIED, NOT COMPUTED HERE
 *
 * `countedStaffHours` in `./staffHours` answers §9-4 — paired staff attendance minus the
 * off-floor intervals `0094` records — and this file only rounds and places the result. Kept
 * separate because the two have nothing in common: one transposes children's funded hours
 * across a period, the other subtracts intervals from a person's day.
 *
 * **A caller that supplies nothing still gets `null`, never `0`.** A service reporting zero
 * staff hours would be making a different and false statement, and a centre whose
 * `ratio_source` is `'declared'` records no per-person attendance at all — for that centre
 * there is nothing to compute and the figure is genuinely unavailable.
 */

import { ageInMonths } from './children';
import type { ChildFunding } from './funding';
import type { FundingPeriod } from './funding';
import type { OperatingDays } from './closures';
import type { StaffDayTotals } from './staffHours';
import { mondayOf, nextMonth } from './weekdayBlock';

/**
 * How the two-and-over subsidy figure treats Plus 10 hours — [[unverified-claims]] item 56.
 *
 * §9-2's two-and-over step is *"Repeat Step 1 (above) for children aged 2 or over **less any
 * hours for children claimed as 20 Hours ECE**."* Whether Plus 10 hours are "claimed as 20
 * Hours ECE" for that deduction is unanswered — §14-4 lists both under the heading **20 Hours
 * ECE Funded Hours**, which is suggestive and is a heading, not a rule.
 *
 * Getting it wrong makes an attested child's Plus 10 hours appear **once** or **twice** on a
 * return to the Crown, up to ten hours a week per child.
 */
export type PlusTenTreatment =
  /** Both the first twenty and the Plus 10 hours come out of the subsidy figure. Under-claims. */
  | 'deduct-both'
  /** Only the first twenty come out. Risks double-counting the Plus 10 hours. */
  | 'deduct-twenty-only';

/**
 * The six pay-parity steps, verbatim from the public ELI schema's enumeration, retrieved
 * 2026-09-03.
 *
 * **Nothing in this product knows what they mean, and nothing may guess.** A parity step is a
 * legal statement by the service about how it pays its teachers; AGENTS §4's rule 5 lands here
 * exactly. They are listed so a form can offer them and a CHECK can refuse an unlisted one —
 * not so anything can reason about them.
 */
export const PARITY_ATTESTATION_CODES = [
  'NOSTEP',
  'STEP1',
  'STEP1-6',
  'STEP1-11',
  'STP1-11P',
  'STP1-11F',
] as const;

export type ParityAttestationCode = (typeof PARITY_ATTESTATION_CODES)[number];

/**
 * The RS7 `Declaration` — six fields, every one of them recorded from the service.
 *
 * Every field is nullable and **`null` means not stated**, which is what an unsigned
 * declaration is. It is emphatically not `false`: a service that has not answered has not
 * answered "no", and an attestation defaulted to false would be this product making a legal
 * statement on the service's behalf.
 */
export interface Rs7Declaration {
  /** `YYYY-MM-DD`, and always the first of February, June or October. */
  periodStartDate: string;
  salariesAttestation: boolean | null;
  parityAttestation: boolean | null;
  parityAttestationCode: ParityAttestationCode | null;
  submitterName: string | null;
  contactNumber: string | null;
  designation: string | null;
}

/**
 * Which of the declaration's six fields are still unanswered.
 *
 * Returned as field names rather than a boolean, because "the declaration is incomplete" is
 * not something a manager can act on and "the parity step is not stated" is. The screen lists
 * them; the return reports them as gaps.
 */
export function missingDeclarationFields(
  declaration: Rs7Declaration | null,
): string[] {
  if (declaration === null) {
    return ['the whole declaration — nothing has been recorded for this period'];
  }
  const missing: string[] = [];
  if (declaration.salariesAttestation === null) missing.push('the salaries attestation');
  if (declaration.parityAttestation === null) missing.push('the pay parity attestation');
  if (declaration.parityAttestationCode === null) missing.push('the pay parity step');
  if (declaration.submitterName === null) missing.push('who is submitting');
  if (declaration.contactNumber === null) missing.push('a contact number');
  if (declaration.designation === null) missing.push('their designation');
  return missing;
}

/** One calendar date's six figures. Hours, rounded to the nearest whole number. */
export interface Rs7Day {
  date: string;
  subsidyFundedChildUnderTwo: number;
  subsidyFundedChildTwoAndOver: number;
  twentyHoursFundedChild: number;
  twentyHoursFundedChildPlusTen: number;
  /** `null` until §9-4's staff hours can be recorded — never `0`. */
  staffHourQualified: number | null;
  /** `null` until §9-4's staff hours can be recorded — never `0`. */
  staffHourNotQualified: number | null;
}

export interface Rs7DayCounts {
  period: FundingPeriod;
  days: Rs7Day[];
  /**
   * Which reading of item 56 produced `subsidyFundedChildTwoAndOver`. Returned so the figure
   * can be recomputed when the Ministry answers, and so a screen can say which was used —
   * two readings that differ by ten hours a week per child must not look alike.
   */
  plusTenTreatment: PlusTenTreatment;
  /**
   * The allocations this file had to make, in words, and anything it could not compute.
   * Empty means every figure is derived from a stated rule.
   */
  assumptions: string[];
  /** Dates where a figure exceeded the schema's `0..9999` bound. Reported, never clamped. */
  outOfRangeDates: string[];
  /**
   * The declaration as recorded, or `null` where none exists for the period. Carried through
   * rather than merged into the days, because it is a statement about the return rather than
   * about any date in it.
   */
  declaration: Rs7Declaration | null;
  /** Which of the six declaration fields are unanswered. Empty when it is complete. */
  missingDeclarationFields: string[];
  /**
   * `AdvanceMonthCounts` — four forward months of operating days by service model. Empty where
   * the caller did not supply an operating calendar, which is not the same as four months of
   * zero and is why they are absent rather than blank.
   */
  advanceMonths: Rs7AdvanceMonth[];
}

/** The whole-hours rounding §9-2 step 5 and §9-4 both direct. Never exported — item 52. */
function roundToNearestHour(hours: number): number {
  /*
    `Math.round` is half-up for positives, which is exactly *"0.5 or above should be rounded up"*.
    Hours are never negative here — every input is a duration — so the half-to-even and
    half-away-from-zero distinctions do not arise.
  */
  return Math.round(hours);
}

/** A child's hours on one date, already split into the buckets the return wants. */
interface Allocation {
  childId: string;
  date: string;
  /** Funded hours after the daily and weekly caps. */
  hours: number;
  /** Of `hours`, the part that is 20 Hours ECE entitlement. */
  twentyHours: number;
  /** Of `hours`, the part that is Plus 10. */
  plusTen: number;
  underTwo: boolean | null;
  /** Casual or conditional — §6-4's replacement candidates. */
  replacement: boolean;
}

/**
 * The per-date allocation `funding.ts` deliberately does not produce.
 *
 * `dailyCappedByDate` is **pre-weekly-cap** — `funding.ts` says so and refuses a `fundedByDate`
 * because the Handbook does not say which days lose a capped week's excess. RS7 needs a daily
 * figure anyway, so the week is walked in date order and the later days lose it.
 */
function allocate(
  child: ChildFunding,
  dateOfBirth: string | null,
  caps: { maxHoursPerWeek: number; twentyHoursWeeklyCap: number },
  cappedWeeks: Set<string>,
): Allocation[] {
  const byWeek = new Map<string, string[]>();
  for (const date of Object.keys(child.dailyCappedByDate)) {
    const key = mondayOf(date);
    const list = byWeek.get(key);
    if (list) list.push(date);
    else byWeek.set(key, [date]);
  }

  const out: Allocation[] = [];
  for (const [week, dates] of byWeek) {
    let weekRemaining = caps.maxHoursPerWeek;
    let twentyRemaining = child.twentyHoursEce ? caps.twentyHoursWeeklyCap : 0;

    for (const date of [...dates].sort()) {
      const uncapped = child.dailyCappedByDate[date] ?? 0;
      const hours = Math.min(uncapped, weekRemaining);
      if (hours < uncapped) cappedWeeks.add(week);
      weekRemaining -= hours;

      /*
        BOTH COMPONENTS ARE ZERO FOR AN UNATTESTED CHILD, and the first draft of this got it
        backwards: with `twentyRemaining` at 0 the subtraction below made every one of their
        hours "Plus 10". An unattested child has neither entitlement — their hours are subsidy
        and nothing else, which is what `childFunding` reports for the period. The tests caught
        it because they assert the figures a real `childFunding` result produces.
      */
      const twentyHours = child.twentyHoursEce ? Math.min(hours, twentyRemaining) : 0;
      const plusTen = child.twentyHoursEce ? hours - twentyHours : 0;
      twentyRemaining -= twentyHours;

      out.push({
        childId: child.childId,
        date,
        hours,
        twentyHours,
        plusTen,
        /*
          Age as at the day being counted, never as at today — the same rule `childFunding`
          applies to the 20 Hours band and `replayDay` to the ratio bands. A child who turned
          two in March was under two in February, and using today's age would rewrite that.

          `null` where no date of birth is recorded: the hours are still funded and still
          belong in a total, but nothing here may guess which age bucket they fall in.
        */
        underTwo: dateOfBirth === null ? null : ageInMonths(dateOfBirth, date) < 24,
        replacement: child.enrolmentType === 'casual' || child.enrolmentType === 'conditional',
      });
    }
  }
  return out;
}

/**
 * The RS7 return's six figures, per calendar date.
 *
 * Takes `ChildFunding` results rather than raw events, so every Handbook rule already applied
 * to them — the caps, the absence rules, §9-2's hours source — applies here without being
 * reimplemented. What this adds is the transposition: per child per period becomes per date
 * per category.
 */
export function rs7DayCounts(input: {
  children: readonly ChildFunding[];
  /**
   * Date of birth by child id. A child missing from the map, or mapped to `null`, has hours
   * that cannot be placed in an age bucket — reported as an assumption, never guessed into one.
   */
  datesOfBirth: ReadonlyMap<string, string | null>;
  period: FundingPeriod;
  /**
   * Defaults to `deduct-both`, which **under-claims**. Chosen as the default deliberately:
   * item 56 is unanswered, and of the two readings only this one cannot double-count hours on
   * a Crown return. The caller may override once the Ministry answers.
   */
  plusTenTreatment?: PlusTenTreatment;
  /** §6-4's overlaps from `sixFourOverlaps`, if the caller computed them. */
  sixFourOverlapHours?: ReadonlyMap<string, number>;
  /**
   * §9-4's counted staff hours, from `countedStaffHours`. Omitted where they cannot be
   * computed — a centre on `ratio_source = 'declared'` has no per-person attendance — and the
   * two staff figures are then `null` on every date, with a gap saying why.
   */
  staffHours?: readonly StaffDayTotals[];
  /** Anything `countedStaffHours` could not place, passed through to `assumptions`. */
  staffHourGaps?: readonly string[];
  /** The declaration for this period, from `rs7_declarations` (0096). */
  declaration?: Rs7Declaration | null;
  /** `AdvanceMonthCounts`, from `rs7AdvanceMonths`. Its gaps join `assumptions`. */
  advance?: { months: Rs7AdvanceMonth[]; gaps: readonly string[] };
  caps?: { maxHoursPerWeek: number; twentyHoursWeeklyCap: number };
}): Rs7DayCounts {
  const caps = input.caps ?? { maxHoursPerWeek: 30, twentyHoursWeeklyCap: 20 };
  const plusTenTreatment = input.plusTenTreatment ?? 'deduct-both';
  const assumptions: string[] = [];
  const cappedWeeks = new Set<string>();

  const allocations: Allocation[] = [];
  const unknownAge = new Set<string>();
  for (const child of input.children) {
    const dob = input.datesOfBirth.get(child.childId) ?? null;
    if (dob === null && Object.keys(child.dailyCappedByDate).length > 0) {
      unknownAge.add(child.childId);
    }
    allocations.push(...allocate(child, dob, caps, cappedWeeks));
  }

  /*
    §6-4, and this is the one place the rule changes a figure rather than being reported.

    `/funding` names the days a place is claimed twice and leaves `fundedHours` alone, because
    a person reads that screen and can act on it. This is the Crown return, where the same
    double claim stops being a caveat. §7-7 supplies the attribution outright — *"another child
    may attend the absent child's place without claiming funding for that replacement child"* —
    so the hours removed are the replacement's.

    Largest claim first among several candidates, so the figure never runs high, and the
    selection is disclosed rather than silent: the Handbook decides the rule, not the tie-break.
  */
  const overlaps = input.sixFourOverlapHours ?? new Map<string, number>();
  const deductedDates: string[] = [];
  for (const [date, overlapHours] of overlaps) {
    let remaining = overlapHours;
    if (remaining <= 0) continue;
    const candidates = allocations
      .filter((a) => a.date === date && a.replacement && a.hours > 0)
      .sort((a, b) => b.hours - a.hours || a.childId.localeCompare(b.childId));
    if (candidates.length === 0) continue;
    deductedDates.push(date);

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(candidate.hours, remaining);
      remaining -= take;
      /*
        Removed from the 20 Hours part last. Those hours are an entitlement a family holds
        rather than a discretionary claim, so if any of a replacement child's hours survive the
        deduction it should be those — and a casual child is rarely attested at all, so this
        branch is usually inert.
      */
      const fromPlusTen = Math.min(candidate.plusTen, take);
      candidate.plusTen -= fromPlusTen;
      const fromTwenty = Math.min(candidate.twentyHours, take - fromPlusTen);
      candidate.twentyHours -= fromTwenty;
      candidate.hours -= take;
    }
  }

  const staffByDate = new Map((input.staffHours ?? []).map((d) => [d.date, d]));

  /*
    Every date with children OR with staff. A date where the roll was empty and an educator was
    on site is a real day on the return — §9-4's staff figures do not depend on a child being
    there — and taking the dates from the allocations alone would drop it.
  */
  const dates = [
    ...new Set([...allocations.map((a) => a.date), ...staffByDate.keys()]),
  ].sort();
  const days: Rs7Day[] = [];
  const outOfRangeDates: string[] = [];

  for (const date of dates) {
    const today = allocations.filter((a) => a.date === date);

    let underTwo = 0;
    let twoAndOver = 0;
    let twentyHours = 0;
    let plusTen = 0;

    for (const a of today) {
      twentyHours += a.twentyHours;
      plusTen += a.plusTen;

      /*
        §9-2 step 1 is the under-two subsidy total; the two-and-over step repeats it *"less any
        hours for children claimed as 20 Hours ECE"*. A child under two cannot be attested — 20
        Hours starts at three years — so no deduction arises on that side, and the deduction
        below is the whole of item 56.
      */
      if (a.underTwo === true) {
        underTwo += a.hours;
      } else if (a.underTwo === false) {
        const deducted =
          plusTenTreatment === 'deduct-both' ? a.twentyHours + a.plusTen : a.twentyHours;
        twoAndOver += Math.max(0, a.hours - deducted);
      }
      // `null` — no date of birth. The hours belong to neither bucket and are reported below.
    }

    /*
      §9-4 rounds these to the nearest hour in its own words — *"68 hours and 30 minutes would
      be rounded to 69 hours whereas 68 hours and 29 minutes would be rounded to 68 hours"* —
      which is the same rule §9-2 step 5 gives for the subsidy figures, stated twice in the
      Handbook for two different totals. One function serves both.

      `unknownMinutes` is in NEITHER figure. Those are the hours of somebody with no practising
      certificate on file, and folding them into `staffHourNotQualified` would turn a paperwork
      fact into a claim about a teacher's qualification.
    */
    const staff = staffByDate.get(date);
    const day: Rs7Day = {
      date,
      subsidyFundedChildUnderTwo: roundToNearestHour(underTwo),
      subsidyFundedChildTwoAndOver: roundToNearestHour(twoAndOver),
      twentyHoursFundedChild: roundToNearestHour(twentyHours),
      twentyHoursFundedChildPlusTen: roundToNearestHour(plusTen),
      staffHourQualified: staff ? roundToNearestHour(staff.qualifiedMinutes / 60) : null,
      staffHourNotQualified: staff ? roundToNearestHour(staff.notQualifiedMinutes / 60) : null,
    };

    /*
      `RS7DayCount` is `xs:int` with `minInclusive="0"` and `maxInclusive="9999"`. A figure past
      that is reported, never clamped: clamping would send a number the service cannot reconcile
      to its own records, and the overflow is far more likely to be a defect here than a real day.
    */
    if (
      day.subsidyFundedChildUnderTwo > 9999 ||
      day.subsidyFundedChildTwoAndOver > 9999 ||
      day.twentyHoursFundedChild > 9999 ||
      day.twentyHoursFundedChildPlusTen > 9999
    ) {
      outOfRangeDates.push(date);
    }

    days.push(day);
  }

  // ---- what had to be assumed, said plainly and only when it actually applied

  if (input.staffHours === undefined) {
    assumptions.push(
      'Staff hours are not produced. §9-4 wants hours at times when a person was counted towards regulated staff; either this centre records adult numbers as a typed total rather than per person, or no staff attendance was supplied. Both staff figures are blank rather than zero.',
    );
  }
  assumptions.push(...(input.staffHourGaps ?? []));

  if (cappedWeeks.size > 0) {
    assumptions.push(
      `${cappedWeeks.size} week${cappedWeeks.size === 1 ? '' : 's'} reached the 30-hour weekly cap. The Handbook states the maximum and does not say which days lose the excess, so the later days of those weeks were reduced.`,
    );
  }

  if (input.children.some((c) => c.twentyHoursEce)) {
    assumptions.push(
      plusTenTreatment === 'deduct-both'
        ? 'The two-and-over subsidy figure excludes both the first twenty hours and the Plus 10 hours, which under-claims if only the first twenty should come out. Unanswered — unverified-claims item 56.'
        : 'The two-and-over subsidy figure excludes only the first twenty hours, so Plus 10 hours appear in both it and the Plus 10 figure if the Handbook intends both to be deducted. Unanswered — unverified-claims item 56.',
    );
    assumptions.push(
      'Within a week the first twenty funded hours are counted as 20 Hours ECE and the remainder as Plus 10, in date order. §9-3 gives the weekly split and not the daily one.',
    );
  }

  if (unknownAge.size > 0) {
    assumptions.push(
      `${unknownAge.size} child${unknownAge.size === 1 ? ' has' : 'ren have'} no recorded date of birth, so their funded hours appear in neither age figure. Record a date of birth and they will.`,
    );
  }

  if (deductedDates.length > 0) {
    assumptions.push(
      `On ${deductedDates.length} date${deductedDates.length === 1 ? '' : 's'} §6-4 forbids claiming for both an absent permanently enrolled child and the casual or conditional child who filled their place. Those hours were removed from the replacement child, per §7-7; where more than one child could have been the replacement, the largest claim was reduced first so the figure cannot run high.`,
    );
  }

  /*
    The declaration is reported and never inferred. A return whose attestations are unanswered
    is incomplete, and saying which fields are missing is the difference between a manager
    knowing what to do and being told the form is not finished.
  */
  const declaration = input.declaration ?? null;
  const missing = missingDeclarationFields(declaration);
  if (missing.length > 0) {
    assumptions.push(
      `The declaration is incomplete: ${missing.join(', ')}. Every one of those is a statement by the service and none can be derived from its records.`,
    );
  }

  assumptions.push(...(input.advance?.gaps ?? []));

  return {
    period: input.period,
    days,
    plusTenTreatment,
    assumptions,
    outOfRangeDates,
    declaration,
    missingDeclarationFields: missing,
    advanceMonths: input.advance?.months ?? [],
  };
}


// ---------------------------------------------------------------------------
// AdvanceMonthCounts — 3C
// ---------------------------------------------------------------------------

/**
 * One forward month's operating days, split by service model.
 *
 * All three are `number | null` and **null means the model is not recorded**, not zero. A
 * service that has not told this product whether it is all-day or sessional cannot have its
 * days placed in a bucket, and putting them all in `allDayDays` because that is the common case
 * would be the product answering a question the Ministry asked the service.
 */
export interface Rs7AdvanceMonth {
  /** `YYYY-MM`. */
  month: string;
  allDayDays: number | null;
  sessionalDays: number | null;
  parentLedDays: number | null;
}

/**
 * `AdvanceMonthCounts` — forward operating days by service model, four months of them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH FOUR MONTHS IS NOT SOURCED, SO IT IS A PARAMETER
 *
 * Three things about this element are established from the public schema: the element names,
 * that there are up to four of them, and that each count is 0–99. **Ahead of what** is not
 * stated in anything read so far — not in the XSD, not in §14-4, not in the RS7 Return
 * Specification, which we do not hold.
 *
 * The structural argument for the four months *following the period* is decent: an RS7 period is
 * four months long, the advance counts are four months long, and "advance" reads as the funding
 * being paid forward. That is an inference, and it is exactly the kind this repo does not make
 * silently — so `firstMonth` is a parameter, its default is stated, and the answer goes in
 * `gaps` every time it is used. [[unverified-claims]] item 64.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT AN OPERATING DAY IS HERE
 *
 * `operatingDays()` in `./closures` — the union of the weekdays children are enrolled to attend,
 * derived per date, minus recorded closures. Forward-looking by construction: a booking schedule
 * block with no end date is effective into next year, and a closure recorded for the Christmas
 * break is already in the table.
 *
 * A service that has recorded no schedule gets `basis: 'unknown'`, and every count is `null`
 * rather than zero. Zero forward operating days is a statement that the service is closing.
 */
export function rs7AdvanceMonths(input: {
  /**
   * The operating calendar, computed by the caller over at least the four months wanted.
   * Passed in rather than computed here because it needs the centre's booking schedule and
   * closures, which are reads, and this module does no I/O.
   */
  operating: OperatingDays;
  /**
   * `all_day`, `sessional` or `parent_led` from `centres.service_model` (0083), or `null` where
   * the service has not said. Spelled out rather than imported: `ServiceModel` lives in
   * `index.ts`, which re-exports this module, so importing it would close a cycle.
   */
  serviceModel: 'all_day' | 'sessional' | 'parent_led' | null;
  /** First forward month, `YYYY-MM`. */
  firstMonth: string;
  /** How many. Four, unless a caller has a reason. */
  count?: number;
}): { months: Rs7AdvanceMonth[]; gaps: string[] } {
  const count = input.count ?? 4;
  const gaps: string[] = [];

  const operatingByMonth = new Map<string, number>();
  for (const date of input.operating.dates) {
    const month = date.slice(0, 7);
    operatingByMonth.set(month, (operatingByMonth.get(month) ?? 0) + 1);
  }

  const months: Rs7AdvanceMonth[] = [];
  let month = input.firstMonth;
  let outOfRange = 0;

  for (let i = 0; i < count; i += 1) {
    const days = operatingByMonth.get(month) ?? 0;

    /*
      `0..99` per the schema. A calendar month cannot exceed 31 operating days, so this is
      unreachable through the normal path — it is here because the bound is the Ministry's and a
      figure past it must be reported rather than sent, exactly as the daily counts do.
    */
    if (days > 99) outOfRange += 1;

    if (input.operating.basis === 'unknown' || input.serviceModel === null) {
      months.push({ month, allDayDays: null, sessionalDays: null, parentLedDays: null });
    } else {
      months.push({
        month,
        allDayDays: input.serviceModel === 'all_day' ? days : 0,
        sessionalDays: input.serviceModel === 'sessional' ? days : 0,
        parentLedDays: input.serviceModel === 'parent_led' ? days : 0,
      });
    }
    month = nextMonth(month);
  }

  if (input.operating.basis === 'unknown') {
    gaps.push(
      'Forward operating days could not be counted: no booking schedule covers these months, so nothing records which weekdays the service operates. The counts are blank rather than zero, because zero would say the service is closing.',
    );
  } else if (input.serviceModel === null) {
    gaps.push(
      'The service model is not recorded, so the forward operating days cannot be placed in the all-day, sessional or parent-led count. Setting it in Settings places them.',
    );
  }

  gaps.push(
    `The four advance months are taken as the four calendar months from ${input.firstMonth}. The schema says there are four and does not say four ahead of what — see unverified-claims item 64.`,
  );

  if (outOfRange > 0) {
    gaps.push(
      `${outOfRange} advance month exceeds the schema's 0-99 bound, which should be impossible for a calendar month and means something upstream is wrong.`,
    );
  }

  return { months, gaps };
}
