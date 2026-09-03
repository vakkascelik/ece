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
