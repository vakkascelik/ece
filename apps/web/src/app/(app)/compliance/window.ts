/**
 * Working out what "a day at the centre" means as a pair of instants.
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

/** Today and the six days before it, oldest first. */
export function lastSevenDays(today: string): string[] {
  const [y, m, d] = today.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${today}`);
  const out: string[] = [];
  for (let back = 6; back >= 0; back -= 1) {
    out.push(new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10));
  }
  return out;
}
