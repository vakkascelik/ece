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

import { coversDate } from './weekdayBlock';

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
