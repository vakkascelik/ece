/**
 * Whether a family has signed off an attendance record, derived rather than stored.
 *
 * ECE Funding Handbook 6-3 requires evidence that a parent or guardian has regularly
 * examined and confirmed the attendance record — weekly for all-day teacher-led
 * centre-based services, monthly for sessional and parent/whānau-led ones. `0061` holds the
 * signatures as append-only events. This turns those events into the state a screen shows.
 *
 * WHY THIS IS A FUNCTION AND NOT A COLUMN
 *
 * The competing product in this market stores a status on the week and moves it through
 * Awaiting → In Review → Approved. That is a stored derivation of evidence held elsewhere,
 * and it drifts the moment the attendance underneath it is corrected. It does not report
 * itself as drifted; it reports itself as Approved.
 *
 * The same argument `attendance-and-ratios` makes about `children.is_present` and
 * `ratioHistory` makes about sampling. Here it matters more, because the record it would be
 * wrong about is the basis of a claim on the Crown.
 *
 * WHAT FALLS OUT OF DERIVING IT
 *
 * `superseded` — an approval that was true when it was given and is not any more, because
 * the record moved underneath it. No stored-status design can express that state, which is
 * why the product that ships one does not have it. It is not a nicety: an approval a centre
 * believes it holds, over figures that have since changed, is exactly the row an auditor
 * finds and the centre cannot explain.
 *
 * THE ESCALATION WINDOW IS A CONVENTION AND NOT A CITATION
 *
 * `overdue` fires after `chaseWindowDays`, default 21. **6-3 states no deadline.** Three
 * weeks is ordinary market practice, in the same way `arrears.ts` uses 30/60/90 — and it is
 * treated the same way: a parameter with a documented default, no `VERIFIED` flag, and no
 * claimed consequence.
 *
 * It is deliberately NOT called `failed`, which is the word the market uses. `failed` reads
 * as a regulatory outcome and there is no regulation behind it. `overdue` says only the
 * thing that is actually true — the window passed and nobody signed — and leaves what to do
 * about it to the centre, whose answer is usually to verify the week on paper instead.
 */

import { shiftLocalDate } from './children';

export type VerificationOutcome = 'approved' | 'disputed';
export type VerificationMethod = 'portal' | 'kiosk' | 'paper';

/** One row of `attendance_verifications`. */
export interface VerificationEvent {
  outcome: VerificationOutcome;
  method: VerificationMethod;
  /** ISO timestamp. Server time, from the column default. */
  verifiedAt: string;
  guardianId: string;
  comment: string | null;
}

export interface VerificationPeriod {
  childId: string;
  /** ISO dates, inclusive both ends, already resolved in the centre's timezone. */
  periodStart: string;
  periodEnd: string;
  events: VerificationEvent[];
  /**
   * The latest `attendance_events.created_at` for this child within this period, or null
   * when the period holds no attendance at all.
   *
   * `created_at` — when the server received it — and emphatically not `at`, which is when
   * the device says it happened. An offline sign-in flushed on Friday for Monday morning
   * carries Monday in `at` and Friday in `created_at`, and it is Friday that decides
   * whether a Wednesday approval is stale.
   */
  recordLastChangedAt: string | null;
}

/**
 * `superseded` and `overdue` are the two a centre has to act on, so they are listed
 * before the states that need nothing.
 */
export type VerificationStatus =
  | 'superseded'
  | 'overdue'
  | 'in-review'
  | 'awaiting'
  | 'approved'
  | 'not-yet-due';

export interface VerificationSummary {
  childId: string;
  periodStart: string;
  periodEnd: string;
  status: VerificationStatus;
  /** The event the status was derived from. Null when nobody has responded. */
  latest: VerificationEvent | null;
  /** True only for `overdue`: the paper fallback 6-3 preserves is the way out. */
  needsPaperFallback: boolean;
}

/**
 * Market practice, not a Handbook deadline. See the note in the module header before
 * treating this number as meaning anything.
 */
export const DEFAULT_CHASE_WINDOW_DAYS = 21;

export interface VerificationOptions {
  /** Days after `periodEnd` before an unanswered period reads `overdue`. */
  chaseWindowDays?: number;
}

/**
 * Compare two ISO timestamps as instants.
 *
 * NOT as strings, which is the obvious version and is wrong. `2026-08-10T09:00:00Z` and
 * `2026-08-10T09:00:00+00:00` are the same instant and sort differently — `Z` is above the
 * digits, `+` is below them — so a string comparison of a Postgres `timestamptz` (which
 * PostgREST renders with an offset) against anything produced by JavaScript's
 * `toISOString()` (which renders `Z`) silently returns the wrong answer.
 *
 * The calendar-date comparisons in this module are string comparisons on purpose and are
 * safe: a `date` has no zone and no format variation. Timestamps have both.
 */
function isAfter(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

/**
 * The newest event wins, transitively — the rule `funding.ts` already applies to attendance
 * corrections. Sorted here rather than trusted from the caller because a PostgREST ordering
 * is one forgotten `.order()` from arriving backwards, and the last row would then decide
 * whether a family has approved their child's funded hours.
 */
function newest(events: VerificationEvent[]): VerificationEvent | null {
  if (events.length === 0) return null;
  return events.reduce((a, b) => (isAfter(b.verifiedAt, a.verifiedAt) ? b : a));
}

/**
 * Derive the state of one period.
 *
 * `today` is an ISO date the caller has already resolved with `todayInZone(centre.timezone)`.
 * It is not defaulted, deliberately: every date bug in this repo has come from a calendar
 * day computed in the wrong zone, and a default here would make the correct call and the
 * dangerous one look identical at the call site.
 */
export function summariseVerification(
  period: VerificationPeriod,
  today: string,
  options: VerificationOptions = {},
): VerificationSummary {
  const chaseWindowDays = options.chaseWindowDays ?? DEFAULT_CHASE_WINDOW_DAYS;
  const latest = newest(period.events);

  const base = {
    childId: period.childId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    latest,
    needsPaperFallback: false,
  };

  // The period is still running. Nothing can be signed off, and asking would produce a
  // signature over a record that is not finished.
  //
  // String comparison rather than date arithmetic: both sides are ISO calendar dates in the
  // same zone, and ISO orders lexicographically. It also avoids a third copy of the
  // `daysBetween` helper that `arrears.ts` and `compliance.ts` each already have.
  if (today <= period.periodEnd) {
    return { ...base, status: 'not-yet-due' };
  }

  const chaseDeadline = shiftLocalDate(period.periodEnd, chaseWindowDays);

  if (latest === null) {
    // Nobody has responded. Overdue once the window passes, and the way out is paper.
    return today >= chaseDeadline
      ? { ...base, status: 'overdue', needsPaperFallback: true }
      : { ...base, status: 'awaiting' };
  }

  /*
   * A dispute outranks the chase window, and does not age into `overdue`.
   *
   * `overdue` means the family never answered. They did answer — they said the record is
   * wrong, and the ball is with the centre. Letting a dispute age into `overdue` would file
   * the centre's own unfinished correction under the family's non-response, and would hide
   * the one state in this function that always requires somebody to do something.
   */
  if (latest.outcome === 'disputed') {
    return { ...base, status: 'in-review' };
  }

  /*
   * Approved, but is it still true?
   *
   * This is the comparison the whole append-only design exists to make cheap. If any
   * attendance for this period reached the server after the signature was given, the
   * signature is over figures that no longer stand.
   *
   * It does NOT age into `overdue` either, for the same reason a dispute does not: the
   * family answered, and the record changed afterwards. That is the centre's event, not
   * theirs.
   */
  if (period.recordLastChangedAt !== null && isAfter(period.recordLastChangedAt, latest.verifiedAt)) {
    return { ...base, status: 'superseded' };
  }

  return { ...base, status: 'approved' };
}

/**
 * The periods a centre has to do something about, in the order they should be worked.
 *
 * `superseded` first: it is the only state where the product is holding a signature it
 * knows to be out of date, and it is invisible to the family until the centre re-releases
 * the week.
 */
const ACTIONABLE: readonly VerificationStatus[] = ['superseded', 'overdue', 'in-review'];

export function needsAttention(summaries: VerificationSummary[]): VerificationSummary[] {
  return summaries
    .filter((s) => ACTIONABLE.includes(s.status))
    .sort((a, b) => {
      const byStatus = ACTIONABLE.indexOf(a.status) - ACTIONABLE.indexOf(b.status);
      return byStatus !== 0 ? byStatus : a.periodStart.localeCompare(b.periodStart);
    });
}

/**
 * The most recent Monday-to-Sunday week that has fully ended, as of `today`.
 *
 * This is the period the kiosk offers a signatory, and the Monday start is not a
 * preference: funding.ts already applies the weekly cap per ISO week, and a verification
 * week that disagreed with the funding week would have a family signing off a slice of two
 * claims and the whole of neither.
 *
 * "Fully ended" means the Sunday is strictly before `today`. On a Sunday the running week
 * still has hours left in it, so the answer is the week before — asking a family to sign a
 * week that is still happening is the same mistake as `not-yet-due`, made by the caller
 * instead of the summary.
 *
 * `today` is an ISO date already resolved with `todayInZone(centre.timezone)`, not
 * defaulted, for the reason `summariseVerification` gives.
 */
export function lastCompletedWeek(today: string): { periodStart: string; periodEnd: string } {
  const [y, m, d] = today.split('-').map(Number);
  // UTC on the parts, so no local timezone can shift the weekday — the daysBetween trick.
  const dow = new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay();
  // Distance back to the most recent Sunday strictly before today. On Sunday itself
  // (dow 0) that is a full seven days, because today's week has not ended.
  const back = dow === 0 ? 7 : dow;
  const periodEnd = shiftLocalDate(today, -back);
  return { periodStart: shiftLocalDate(periodEnd, -6), periodEnd };
}
