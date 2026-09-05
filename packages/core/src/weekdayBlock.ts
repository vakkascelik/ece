/**
 * A recurring block on one weekday, with an effective window.
 *
 * Extracted from `census.ts` on 2026-09-04, when the second consumer arrived and not before.
 *
 * WHY IT WAITED, WHICH IS THE POINT OF THIS COMMENT
 *
 * `staff_contact_hours` (0081) and `child_booking_schedule` (0085) are the same shape — ISO
 * weekday, start and end time, an effective window with a null upper bound meaning open-ended —
 * because `0085` reused `0081`'s idiom deliberately and says so in its header. So the as-at rule
 * and the time parser are shared, and duplicating them would be the two-copies-of-the-design-tokens
 * problem in a place where a divergence changes a funding figure rather than a shade of grey.
 *
 * But on 2026-09-03 there was exactly ONE consumer, and extracting a neutral module then — renaming
 * a working function across a test file to prepare for code not yet written — would have been
 * speculative refactoring. The extraction is justified by the second consumer, not by the shape.
 *
 * WHAT THIS DELIBERATELY DOES NOT KNOW
 *
 * Anything about staff, children, funding or the wire format. It does not know that
 * `ELI_WEEKDAY_CODES` exists, because a weekday integer is not a wire code until something maps it
 * at the boundary — `eliWeekday()` in `census.ts` does that, and the mapping belongs there rather
 * than here. It does not know what a block MEANS: a staff contact-hours block is a contract that
 * §14-2 may want measured instead (unverified-claims item 50), and a child booking-schedule block
 * is an agreement that §6-5 and §6-7 compare attendance against. Same shape, different meanings,
 * and only the Funding Handbook distinguishes them.
 */

/**
 * `YYYY-MM` plus one.
 *
 * Extracted from `absence.ts` on 2026-09-05, when `rs7.ts` became the second consumer — the
 * same rule this module's own header describes, and the same rule that brought `isoWeekdayOf`
 * and `mondayOf` here a few hours earlier.
 *
 * Throws on a malformed month rather than returning a plausible one. A silent rollover from
 * `2026-13` would put a funding month a year out and look entirely ordinary in a table.
 */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m || m > 12) throw new Error(`Not an ISO month: ${month}`);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** The last day of `YYYY-MM`, without a table of month lengths and without a leap-year rule. */
export function lastDayOf(month: string): string {
  return shiftLocalDate(`${nextMonth(month)}-01`, -1);
}

/**
 * The ISO weekday of an already-resolved local date, Monday = 1 .. Sunday = 7.
 *
 * `Date.UTC` on the components, never `new Date(string)` and never
 * `.toISOString().slice(0, 10)` — the latter is the pattern `localDates.test.ts` scans for and
 * refuses a second exemption on. This never asks what day it is: `date` was resolved by a caller
 * holding the centre's timezone, and `Date.UTC` on its parts cancels the offset the same way
 * `shiftLocalDate` does.
 *
 * Throws on a malformed date rather than returning a plausible number. Two of the copies this
 * replaces validated and one cast, and a silent `NaN` weekday puts a session on the wrong day of
 * an agreement.
 */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${date}`);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
  return utcDay === 0 ? 7 : utcDay;
}

import { shiftLocalDate } from './children';

/**
 * The Monday of the week `date` falls in — the calendar bucket every weekly rule here uses.
 *
 * FOUR COPIES OF THIS EXISTED BEFORE 2026-09-04. Two identical private `mondayOf`s in
 * `attendanceTrend.ts` and `verificationChase.ts`, `isoWeekKey` in `funding.ts` bucketing the
 * same seven days into a different string, and an inline weekday conversion in `absence.ts`.
 * §6-7's monthly check needed a fourth, which is one more than this repo tolerates: two
 * hand-maintained copies of the design tokens had already diverged silently, and a divergence
 * here moves a funding figure rather than a shade of grey.
 *
 * `funding.ts`'s `isoWeekKey` is deliberately left where it is. It returns `2026-W36` rather than
 * a Monday, the weekly cap is built on that shape, and changing the bucketing of a cap is not a
 * side errand of adding an absence rule. It now carries a pointer here so a fifth copy is not
 * written next to it.
 *
 * THE IMPORT THIS MODULE SAID IT WOULD NOT HAVE. The header above states that this file knows
 * nothing about children, and `shiftLocalDate` lives in `children.ts` — beside the other date
 * helpers rather than in a module of its own. The alternative was a second copy of local-date
 * shifting inside this file in order to avoid importing the first, which is the exact failure
 * this extraction exists to end. So: a date helper is imported, and the module still knows
 * nothing about children.
 */
export function mondayOf(date: string): string {
  return shiftLocalDate(date, -(isoWeekdayOf(date) - 1));
}

/** ISO weekday, 1 = Monday. Matches `enrolments.days` and both tables' `weekday` columns. */
export interface WeekdayBlock {
  weekday: number;
  /** `HH:MM` or `HH:MM:SS`, as Postgres `time` serialises. */
  fromTime: string;
  toTime: string;
  effectiveFrom: string;
  /** Null means open-ended, and it behaves as infinity in both tables' overlap constraints. */
  effectiveTo: string | null;
}

/**
 * Does an effective window cover a date?
 *
 * **Exported, and used by two unrelated subjects.** Weekday blocks are one; `codes` rows in
 * `census.ts` are the other, where 0080 defines a set imported with no dates as "not dated"
 * rather than "always valid" and this predicate is what lets an undated set pass. A four-line
 * date comparison is exactly the size of thing that gets copied rather than imported, and then
 * one copy learns about a null bound and the other does not.
 *
 * Both bounds inclusive, and a null bound is unbounded on that side. String comparison on
 * `YYYY-MM-DD`, which sorts lexicographically — no `Date` is constructed, so no timezone is
 * consulted and there is nothing here for `localDates.test.ts` to catch.
 */
export function coversDate(from: string | null, to: string | null, asAt: string): boolean {
  if (from !== null && from > asAt) return false;
  if (to !== null && to < asAt) return false;
  return true;
}

/**
 * The blocks in force on a date, in a stable order.
 *
 * Generic over the caller's own row type so a reader gets back what it passed in — a
 * `ContactHoursRow` with its id and staff member, or a child schedule row — rather than a
 * flattened `WeekdayBlock`. That matters because every caller needs the id to end or delete a
 * block, and a non-generic signature would have thrown it away.
 *
 * Sorted by weekday then start time, because the wire order has to be stable across runs: an
 * `EceReturn` or a `ChildBookingSchedule` whose detail list reorders between two submissions of the
 * same data looks like a change to whatever is diffing them.
 *
 * ~~`contactHoursOn`~~ — renamed 2026-09-04. The behaviour is identical; the old name asserted a
 * subject it no longer has.
 */
export function blocksOn<T extends WeekdayBlock>(blocks: T[], asAt: string): T[] {
  return blocks
    .filter((b) => coversDate(b.effectiveFrom, b.effectiveTo, asAt))
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.fromTime.localeCompare(b.fromTime));
}

/**
 * `HH:MM` or `HH:MM:SS` to minutes past midnight, or null if it will not parse.
 *
 * Both forms, because Postgres serialises `time` as `HH:MM:SS` and an HTML `<input type="time">`
 * submits `HH:MM`, and a helper that took only one would have failed at exactly one of its two
 * call sites. Seconds are parsed and discarded: no rule in the Funding Handbook turns on a second,
 * and rounding a session to the minute is what every worked example does.
 *
 * **Null is not zero.** A block whose times will not parse contributes nothing and is reported by
 * its caller rather than silently counted as a zero-length session — the same contract as a broken
 * attendance day being named instead of estimated. Zero would be midnight, which silently
 * lengthens a contract.
 *
 * MOVED HERE UNCHANGED, and one line of that was harder than it looks. The first draft of this
 * extraction relaxed `hours > 23` to allow `24:00` — a session ending at midnight, which Postgres
 * `time` accepts and which both tables' `to_time > from_time` CHECKs would happily store. The
 * existing test rejects `'25:00'` and never exercises `'24:00'`, so **the change would have passed
 * the suite**, which is exactly what makes it the dangerous kind.
 *
 * Reverted, because an extraction that changes behaviour is not an extraction. Whether a block may
 * end at `24:00` is a real question with a real answer somewhere in the Handbook's session rules,
 * and it deserves its own commit, its own test, and a source — not a silent widening inside a
 * refactor nobody would think to re-read.
 */
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  // Seconds are parsed to validate the shape and then discarded: the schema's ContactHoursDetail
  // carries xs:time, but a block measured to the second is a precision this product does not have
  // and should not imply.
  return hours * 60 + minutes;
}

/**
 * Minutes across a set of blocks, or null if none of them yields a usable duration.
 *
 * A block whose times will not parse, or whose end is not after its start, contributes nothing and
 * is **not** silently treated as zero. Both tables carry a `to_time > from_time` CHECK so a bad row
 * should be impossible; this is the second check, because "the constraint exists" is an assumption
 * about a database that a unit test cannot see.
 *
 * Null rather than 0 when nothing parses, so a caller can tell "no usable blocks" from "blocks
 * totalling nothing" — which are different sentences on a return.
 */
/**
 * The ISO weekdays a schedule covers on a given date, ascending and de-duplicated.
 *
 * ADDED FOR THE DISAGREEMENT, not for a new feature — [[unverified-claims]] item 53.
 *
 * Two things record which days a child attends: `enrolments.days` (0004, a `smallint[]`, the
 * coarse older form) and `child_booking_schedule` (0085, effective-dated blocks with times).
 * `0085`'s header states the rule — **where a block exists it is authoritative** — and until
 * 2026-09-04 that rule cost nothing, because the table was empty and the two could not
 * contradict each other.
 *
 * Then the funding calculation started reading the schedule while two screens went on rendering
 * `enrolments.days`, so a children list could say Mon/Wed beside a funded figure derived from a
 * Tue/Thu agreement, with nothing on either screen saying which the money came from.
 *
 * This is the cheap half of the fix: a screen with blocks in hand renders the days they say.
 * The lossless backfill is still blocked on deciding what an unstated time means, and does not
 * need deciding for a screen to stop disagreeing with a claim.
 *
 * A sessional service can have two blocks on one weekday — a morning and an afternoon — which is
 * why this de-duplicates rather than counting.
 */
export function weekdaysOn<T extends WeekdayBlock>(blocks: T[], asAt: string): number[] {
  return [...new Set(blocksOn(blocks, asAt).map((b) => b.weekday))].sort((a, b) => a - b);
}

export function blockMinutes(blocks: WeekdayBlock[]): number | null {
  let total = 0;
  let any = false;
  for (const b of blocks) {
    const from = timeToMinutes(b.fromTime);
    const to = timeToMinutes(b.toTime);
    if (from === null || to === null || to <= from) continue;
    total += to - from;
    any = true;
  }
  return any ? total : null;
}
