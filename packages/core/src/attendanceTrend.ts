/**
 * Attendance over weeks rather than days: is it growing, and which days are busiest.
 *
 * The occupancy report already answers "how full, day by day, for the last thirty days" —
 * a log, not a trend. A manager asking "are we busier than we were last term" or "which
 * afternoon can I safely roster one fewer educator" cannot read either answer out of thirty
 * rows of daily noise. This buckets the same `DayAttendance[]` `readAttendanceByDay` already
 * produces into weeks and into weekdays instead of days, so the shape of the pattern survives
 * being looked at.
 *
 * No new query. `readAttendanceByDay` is already the paged, timezone-correct read — this is
 * arithmetic on what it returns, exactly the split `occupancy.ts` makes between the query and
 * the summary.
 */

import type { DayAttendance } from './occupancy';
import { averageOverOpenDays } from './occupancy';
import { shiftLocalDate } from './children';
import { isoWeekdayOf, mondayOf } from './weekdayBlock';

export interface WeekAttendance {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: string;
  /** Sunday, `YYYY-MM-DD`. */
  weekEnd: string;
  daysWithAttendance: number;
  /** Mean children per day across the days that had any. Null when the week had none. */
  averageChildren: number | null;
}

/**
 * Days bucketed into Monday–Sunday weeks, oldest first.
 *
 * A caller wanting only complete weeks passes a range that ends on a Sunday — this
 * function buckets whatever it is given and does not itself decide what counts as
 * complete, the same separation `dayWindow` and its caller keep for a single day.
 */
export function summariseWeeklyAttendance(days: readonly DayAttendance[]): WeekAttendance[] {
  const byWeek = new Map<string, DayAttendance[]>();
  for (const day of days) {
    const start = mondayOf(day.date);
    const bucket = byWeek.get(start);
    if (bucket) bucket.push(day);
    else byWeek.set(start, [day]);
  }

  return Array.from(byWeek.keys())
    .sort()
    .map((weekStart) => {
      const weekDays = byWeek.get(weekStart)!;
      const { daysWithAttendance, averageChildren } = averageOverOpenDays(weekDays);
      return { weekStart, weekEnd: shiftLocalDate(weekStart, 6), daysWithAttendance, averageChildren };
    });
}

export interface WeekdayAttendance {
  /** 1 = Monday .. 7 = Sunday, matching `wanted_days` throughout this schema. */
  weekday: number;
  daysWithAttendance: number;
  averageChildren: number | null;
}

/**
 * Which weekday is busiest, averaged over however many weeks were passed in.
 *
 * Exists for rostering, not compliance: a manager deciding Friday afternoon cover needs
 * "Fridays average 22 children" more than "22 children last Friday", which is one sample
 * and could be a school holiday. Closed days (weekends at most centres) fall out on their
 * own — `averageOverOpenDays` excludes them from every weekday's denominator the same way
 * it excludes them from a week's.
 */
export function summariseWeekdayPattern(days: readonly DayAttendance[]): WeekdayAttendance[] {
  const byWeekday = new Map<number, DayAttendance[]>();
  for (const day of days) {
    const weekday = isoWeekdayOf(day.date);
    const bucket = byWeekday.get(weekday);
    if (bucket) bucket.push(day);
    else byWeekday.set(weekday, [day]);
  }

  return Array.from({ length: 7 }, (_, i) => i + 1).map((weekday) => {
    const { daysWithAttendance, averageChildren } = averageOverOpenDays(byWeekday.get(weekday) ?? []);
    return { weekday, daysWithAttendance, averageChildren };
  });
}

/**
 * The most recent `weekCount` **complete** Monday–Sunday weeks before `today`, oldest first.
 *
 * Deliberately excludes the week `today` falls in. A partial week is exactly the closed-day
 * problem `averageOverOpenDays` exists to solve, one level up: Wednesday's three open days
 * would average as though the week were already over, understating it for no reason a reader
 * could see. `readAttendanceByDay` still needs the day-by-day window for this range — build
 * it from `dates` the same way the occupancy report does, this only returns the boundary.
 */
export function completeWeeksBefore(
  today: string,
  weekCount: number,
): { rangeStart: string; rangeEnd: string } {
  const lastCompleteWeekEnd = shiftLocalDate(mondayOf(today), -1); // Sunday before this week
  const rangeStart = shiftLocalDate(lastCompleteWeekEnd, -(weekCount * 7 - 1));
  return { rangeStart, rangeEnd: lastCompleteWeekEnd };
}
