/**
 * Working out what "a day at the centre" means as a pair of instants.
 *
 * Shared by the compliance binder and the funding export, both of which read attendance events by
 * local day. Duplicating it would mean two conversions that agree until one is fixed.
 *
 * Attendance events are timestamps; a day is a local concept. Getting the conversion
 * wrong shifts a whole day's evidence by up to thirteen hours, which for a report about
 * ratio compliance means attributing the morning to the wrong date.
 *
 * `Intl` rather than a fixed offset, because New Zealand moves between NZDT (+13) and
 * NZST (+12) and a hard-coded twelve is wrong for half the year — the same reasoning as
 * `todayInZone` in `@ece/core`.
 */

/** The UTC offset of a zone at a given instant, in minutes. */
function offsetMinutes(timeZone: string, at: Date): number {
  // `en-US` with an explicit zone gives the local wall clock; comparing it with the same
  // instant read as UTC yields the offset. Awkward, and the only way to do this without
  // a timezone database of one's own.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // Intl renders midnight as hour 24 in some environments.
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The instants bounding one local day, `[fromUtc, toUtc)`.
 *
 * Computed by guessing the offset from midday and correcting once, which handles the
 * two days a year when the offset changes mid-day: a single-pass conversion using the
 * offset at the guessed instant can land an hour out on exactly those dates.
 */
export function dayWindow(date: string, timeZone: string): { fromUtc: string; toUtc: string } {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${date}`);

  const startOfLocalDay = (year: number, month: number, day: number): Date => {
    // Midday is never inside a DST transition, so the offset read there is a safe first
    // guess for the day it belongs to.
    const midday = new Date(Date.UTC(year, month - 1, day, 12));
    const guess = offsetMinutes(timeZone, midday);
    const first = new Date(Date.UTC(year, month - 1, day) - guess * 60_000);
    // Re-read the offset at the candidate instant and correct if the guess crossed a
    // transition.
    const actual = offsetMinutes(timeZone, first);
    return actual === guess ? first : new Date(Date.UTC(year, month - 1, day) - actual * 60_000);
  };

  const from = startOfLocalDay(y, m, d);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const to = startOfLocalDay(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );

  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

/**
 * A wall-clock date and time in a named zone, as a UTC instant.
 *
 * WHY THIS EXISTS: `new Date('2026-08-06T08:05')` DOES NOT DO THIS.
 *
 * A datetime string with no offset is interpreted in the *parsing runtime's* zone. On a developer
 * machine set to Pacific/Auckland that is accidentally correct; in production the server runs UTC,
 * so a manager correcting a sign-in to 08:05 got `08:05Z` — 20:05 in New Zealand, eleven hours in
 * the future. The insert then failed `attendance_not_future`, so the correction path was dead for
 * the whole working day, and the corrections that did land after 9pm were stored at the wrong
 * instant and flipped a child who had gone home back onto the roll.
 *
 * It is invisible to the suite because a dev machine and a CI runner on Pacific/Auckland parse the
 * same string correctly. The bug only exists where TZ=UTC, which is only production.
 *
 * The same guess-and-correct as `startOfLocalDay`, and for the same reason: reading the offset at
 * the naive instant can be an hour out on the two days a year the offset moves, so it is re-read at
 * the candidate and corrected once.
 *
 * A time that does not exist — 02:30 on the morning New Zealand springs forward — resolves to the
 * instant one offset either side rather than raising. Deliberate: refusing it would mean a manager
 * cannot record a correction on that date at all, and being an hour out on a clock that skipped an
 * hour is the smaller wrong.
 */
export function zonedWallClockToUtc(wallClock: string, timeZone: string): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wallClock.trim());
  if (!parsed) throw new Error(`Not a local date and time: ${wallClock}`);

  const n = (i: number) => Number(parsed[i] ?? 0);
  // The wall clock read as though it were UTC. Not the answer — the starting point.
  const naive = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6));

  const guess = offsetMinutes(timeZone, new Date(naive));
  const first = new Date(naive - guess * 60_000);
  const actual = offsetMinutes(timeZone, first);
  return (actual === guess ? first : new Date(naive - actual * 60_000)).toISOString();
}

/*
 * `shiftLocalDate` used to live here and now lives in `@ece/core`.
 *
 * It moved when `packages/core/src/staff.ts` needed it and core cannot import from
 * an app. Re-exported rather than relocated at every call site, because the import
 * path is not the interesting part — and both moves happened because
 * `localDates.test.ts` refused a second allowlist entry for a duplicated copy, which
 * is the guard working rather than being appeased.
 */
import { shiftLocalDate } from '@ece/core';

export { shiftLocalDate };

/** Today and the six days before it, oldest first. */
export function lastSevenDays(today: string): string[] {
  const out: string[] = [];
  for (let back = 6; back >= 0; back -= 1) out.push(shiftLocalDate(today, -back));
  return out;
}
