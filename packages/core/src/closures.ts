/**
 * Days the service did not operate — `0088`.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT PART OF `occupancy.ts`, which is where its first
 * consumer lives: it is about to have three. §6-6 suspends the Three Week Rule while a
 * service is closed for two weeks or more; RS7 counts forward operating days; and the
 * occupancy average currently guesses at a closed day. Putting the type in whichever file
 * needed it first is how `contactHoursOn` ended up somewhere it did not belong until it had
 * to be pulled out again.
 *
 * NOT A SECURITY BOUNDARY, like everything in `@ece/core`. The policies in `0088` decide who
 * sees a closure: every member of the centre, parents included, because a family needs to
 * know the centre is shut next Thursday.
 */

import { shiftLocalDate } from './children';
import { blocksOn, coversDate, isoWeekdayOf, type WeekdayBlock } from './weekdayBlock';

export interface ServiceClosure {
  id: string;
  centreId: string;
  /** ISO date. The first closed day, inclusive. */
  startsOn: string;
  /**
   * The last closed day, **inclusive** — and null means closed with no stated end.
   *
   * A flood on Tuesday with no known reopening is a real closure, and recording it as a
   * one-day one would be false. That is not the same distinction as an enrolment's open end:
   * here it also means the service is *currently* shut, so anything that asks "were we open
   * on this date" answers no for every later date until somebody sets an end.
   */
  endsOn: string | null;
  /**
   * `ClosureReasonCode` from the ELI schema — a `LookupCode` with **no published list**, so a
   * value here cannot be resolved to a label. `code_sets` reserves a `closure_reason` domain
   * and ships it empty. Rendered as the raw code with a caveat, never as a guessed name.
   */
  reasonCode: string | null;
  /** What the service can actually say today. Free text, never serialised. */
  reasonNote: string | null;
}

/**
 * Was the service closed on this date?
 *
 * `coversDate` is reused rather than reimplemented, and this is its **third** consumer after
 * the booking schedule and the code-set effective windows. Its inclusive-at-both-ends
 * semantics are exactly right here — a closure from Monday to Friday includes Friday — and
 * they match the `[]` range bound the exclusion constraint in `0088` uses, so the database
 * and this function cannot disagree about a boundary day.
 */
export function isClosedOn(closures: readonly ServiceClosure[], date: string): boolean {
  return closures.some((c) => coversDate(c.startsOn, c.endsOn, date));
}

/**
 * The closure covering a date, if any — for a screen that has to say *why* it was shut.
 *
 * Returns the first match rather than all of them, which is safe here and not merely
 * convenient: `service_closures_no_overlap` means at most one closure can cover any given
 * date, and there is an RLS assertion pinning that. If the constraint were ever dropped this
 * would quietly pick one of several, so the two belong together.
 */
export function closureOn(
  closures: readonly ServiceClosure[],
  date: string,
): ServiceClosure | null {
  return closures.find((c) => coversDate(c.startsOn, c.endsOn, date)) ?? null;
}

// ---------------------------------------------------------------------------
// Which days does this service operate?
// ---------------------------------------------------------------------------

/**
 * How `operatingDays` arrived at its answer. **Never inferred by a caller from the other
 * fields** — an empty `dates` means "no operating days in this range" on the `schedule` basis
 * and "could not tell" on the `unknown` one, and those must not be confused.
 */
export type OperatingBasis =
  /** A booking schedule covers part of the range, so the operating weekdays are derived. */
  | 'schedule'
  /** No schedule block is effective anywhere in the range. Nothing is claimed. */
  | 'unknown';

export interface OperatingDays {
  basis: OperatingBasis;
  /** ISO weekdays the service operates, ascending. Empty when `basis` is `unknown`. */
  weekdays: number[];
  /** Dates in range the service operated, ascending. Empty when `basis` is `unknown`. */
  dates: string[];
  /**
   * Dates in range a closure covered, ascending. Populated on **both** bases, because a
   * closure is recorded directly and does not depend on knowing the weekday pattern.
   */
  closedDates: string[];
}

/**
 * The days a service operated over a range — closures excluded, weekdays derived.
 *
 * TWO CONSUMERS, WHICH IS WHY IT IS HERE AND NOT IN EITHER OF THEM
 *
 * RS7's `AdvanceMonthCounts` wants forward operating days by service model, and the occupancy
 * average needs to tell a closed day from an open one nobody attended
 * ([[unverified-claims]] item 59). Both reduce to this question. `averageOverOpenDays` was
 * about to answer it with `d.children > 0`, which is a proxy that reports a fraction of the
 * truth and looks precise doing it.
 *
 * WHY THE WEEKDAYS COME FROM THE CHILDREN'S SCHEDULE
 *
 * Nothing records a centre's opening pattern. Every `weekday` column in this schema is per
 * child (`child_booking_schedule`, `enrolments.days`) or per staff member
 * (`staff_contact_hours`) — measured, not assumed. So the operating weekdays are the **union
 * of the days children are enrolled to attend**, which is a proxy too, and a defensible one:
 * a service that has nobody enrolled on a Friday does not operate on Fridays in any sense
 * that matters to a funding return or an occupancy figure.
 *
 * It is derived **per date** rather than as a union over the range, so a block that ends
 * mid-range stops contributing from the day it ends. A range-wide union would keep a Friday
 * alive for a month after the last Friday child left.
 *
 * WHAT IT REFUSES TO DO
 *
 * With no schedule anywhere in the range it returns `unknown` and an empty `dates`, rather
 * than falling back to a proxy of its own. The fallback belongs to the caller, which knows
 * what its figure means and can say which basis produced it — the same division
 * `hoursBasis` keeps in the funding calculation. A helper that quietly substituted a worse
 * answer would make the two bases indistinguishable, which is the defect item 59 is about.
 */
export function operatingDays(input: {
  /** Every booking-schedule block for the centre's children, superseded ones included. */
  blocks: readonly WeekdayBlock[];
  closures: readonly ServiceClosure[];
  /** Inclusive ISO date range. */
  from: string;
  to: string;
}): OperatingDays {
  const blocks = [...input.blocks];
  const weekdays = new Set<number>();
  const dates: string[] = [];
  const closedDates: string[] = [];
  let sawAnyBlock = false;

  for (let date = input.from; date <= input.to; date = shiftLocalDate(date, 1)) {
    /*
      A closed day is recorded, and it is recorded whether or not a schedule exists — which is
      why `closedDates` is populated on both bases. It also comes FIRST: a closure beats the
      pattern, so a Tuesday the service was shut is not an operating day even though Tuesdays
      normally are.
    */
    if (isClosedOn(input.closures, date)) {
      closedDates.push(date);
      continue;
    }

    const today = blocksOn(blocks, date);
    if (today.length === 0) continue;
    sawAnyBlock = true;

    const weekday = isoWeekdayOf(date);
    if (today.some((b) => b.weekday === weekday)) {
      weekdays.add(weekday);
      dates.push(date);
    }
  }

  /*
    `sawAnyBlock` is set by a block being EFFECTIVE on some open date in the range, not by the
    input array being non-empty. A centre whose only blocks expired last year has blocks and no
    schedule for this range, and answering `schedule` for it would claim the service operates
    zero days — which reads as permanently closed rather than as unknown.
  */
  if (!sawAnyBlock) {
    return { basis: 'unknown', weekdays: [], dates: [], closedDates };
  }

  return {
    basis: 'schedule',
    weekdays: [...weekdays].sort((a, b) => a - b),
    dates,
    closedDates,
  };
}
