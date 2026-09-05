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
 * WHAT THIS FILE WILL NOT DO
 *
 * Produce a staff-hour figure. §9-4 wants hours *"at times when they were counted towards
 * regulated (ratio) staff"* and nothing records that yet — `staff_attendance_events` is a
 * two-state in/out and there is no notion of a break. Both staff figures are `null` with a
 * named gap, never `0`, because a service reporting zero staff hours would be making a
 * different and false statement.
 */

import { ageInMonths } from './children';
import type { ChildFunding } from './funding';
import type { FundingPeriod } from './funding';
import { mondayOf } from './weekdayBlock';

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

  const dates = [...new Set(allocations.map((a) => a.date))].sort();
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

    const day: Rs7Day = {
      date,
      subsidyFundedChildUnderTwo: roundToNearestHour(underTwo),
      subsidyFundedChildTwoAndOver: roundToNearestHour(twoAndOver),
      twentyHoursFundedChild: roundToNearestHour(twentyHours),
      twentyHoursFundedChildPlusTen: roundToNearestHour(plusTen),
      staffHourQualified: null,
      staffHourNotQualified: null,
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

  assumptions.push(
    'Staff hours are not produced. §9-4 wants hours at times when a person was counted towards regulated staff, and nothing records when an adult was off the floor, so both staff figures are blank rather than zero.',
  );

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

  return { period: input.period, days, plusTenTreatment, assumptions, outOfRangeDates };
}
