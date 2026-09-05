import { describe, expect, it } from 'vitest';
import {
  completeWeeksBefore,
  summariseWeeklyAttendance,
  summariseWeekdayPattern,
} from '../attendanceTrend';
import type { DayAttendance } from '../occupancy';
import type { OperatingDays } from '../closures';

const day = (date: string, children: number): DayAttendance => ({ date, children });

// 2026-08-03 is a Monday (occupancy.test.ts already anchors 2026-08-01/02 as Sat/Sun),
// so this fortnight is Mon..Sun, Mon..Sun across two calendar weeks.
const twoWeeks = [
  day('2026-07-27', 20), // Mon, week 1
  day('2026-07-28', 22),
  day('2026-07-29', 0), // closed
  day('2026-07-30', 18),
  day('2026-07-31', 21),
  day('2026-08-01', 0), // Sat
  day('2026-08-02', 0), // Sun
  day('2026-08-03', 30), // Mon, week 2
  day('2026-08-04', 36),
  day('2026-08-05', 24),
  day('2026-08-06', 28),
  day('2026-08-07', 32),
  day('2026-08-08', 0),
  day('2026-08-09', 0),
];

describe('summariseWeeklyAttendance', () => {
  it('buckets by the Monday of each week, oldest first', () => {
    const weeks = summariseWeeklyAttendance(twoWeeks);
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-07-27', '2026-08-03']);
    expect(weeks.map((w) => w.weekEnd)).toEqual(['2026-08-02', '2026-08-09']);
  });

  it('averages over open days within the week, same rule as the daily report', () => {
    const weeks = summariseWeeklyAttendance(twoWeeks);
    // Week 1: 20, 22, 18, 21 across 4 open days = 20.25, rounded to one decimal like every
    // other average in this module.
    expect(weeks[0]).toMatchObject({ daysWithAttendance: 4, averageChildren: 20.3 });
    // Week 2: 30, 36, 24, 28, 32 across 5 open days = 30
    expect(weeks[1]).toMatchObject({ daysWithAttendance: 5, averageChildren: 30 });
  });

  it('reports null rather than zero for a week with no attendance', () => {
    const weeks = summariseWeeklyAttendance([day('2026-08-08', 0), day('2026-08-09', 0)]);
    expect(weeks).toEqual([
      {
        weekStart: '2026-08-03',
        weekEnd: '2026-08-09',
        daysWithAttendance: 0,
        averageChildren: null,
        averageBasis: 'attendance-proxy',
        denominatorDays: 0,
      },
    ]);
  });


  /*
    THE OPERATING CALENDAR, AND WHY THESE TWO CASES ARE THE WHOLE CHANGE.

    Both functions in this module called `averageOverOpenDays` with no calendar and threw away the
    `basis` it returned, so every figure on the trends screen was on the attendance proxy and the
    screen had no way to say so. That is the flattering denominator item 59 was opened to remove,
    still in place one level up.

    Week 2 of the fixture is Mon 3 Aug to Sun 9 Aug: five weekdays at 30, 36, 24, 28, 32 and a
    weekend at zero. On the proxy the denominator is "days anybody came" = 5, giving 30.0. Tell it
    the service also operated on the Saturday and the denominator becomes 6 — the same attendance,
    a real zero in the divisor, and 25.0.

    Five points against six is not a rounding difference. It is the difference between a manager
    reading "we average thirty" and "we average twenty-five", from one Saturday nobody came.
  */
  const weekTwoOperating: OperatingDays = {
    basis: 'schedule',
    weekdays: [1, 2, 3, 4, 5, 6],
    dates: [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08', // the Saturday: open, and nobody came
    ],
    closedDates: [],
  };

  it('divides by the days the service operated, not the days anybody came', () => {
    const weeks = summariseWeeklyAttendance(twoWeeks, weekTwoOperating);
    const weekTwo = weeks.find((w) => w.weekStart === '2026-08-03')!;

    expect(weekTwo.averageBasis).toBe('operating-days');
    expect(weekTwo.denominatorDays).toBe(6);
    // 150 children over 6 operating days. The proxy says 30.0 over 5.
    expect(weekTwo.averageChildren).toBe(25);
    // Unchanged and deliberately still reported: how many days actually had anybody.
    expect(weekTwo.daysWithAttendance).toBe(5);
  });

  it('falls back to the proxy, named, when no schedule covers the range', () => {
    // `unknown` is `operatingDays()` refusing to guess rather than reporting no operating days,
    // and the distinction decides the denominator — an empty `dates` treated as authoritative
    // would make every average null.
    const unknown: OperatingDays = {
      basis: 'unknown',
      weekdays: [],
      dates: [],
      closedDates: [],
    };
    const weeks = summariseWeeklyAttendance(twoWeeks, unknown);
    const weekTwo = weeks.find((w) => w.weekStart === '2026-08-03')!;

    expect(weekTwo.averageBasis).toBe('attendance-proxy');
    expect(weekTwo.averageChildren).toBe(30);
  });

  it('puts a Sunday in the week that started the Monday before it, not the next one', () => {
    // The trap: naive "start of week = date minus (weekday - 1)" is right for Monday..Saturday
    // and wrong for Sunday if weekday is read 0 = Sunday .. 6 = Saturday without remapping —
    // it would compute a negative offset and land Sunday in the FOLLOWING week's bucket.
    const weeks = summariseWeeklyAttendance([day('2026-08-09', 5)]); // a lone Sunday
    expect(weeks).toEqual([
      {
        weekStart: '2026-08-03',
        weekEnd: '2026-08-09',
        daysWithAttendance: 1,
        averageChildren: 5,
        averageBasis: 'attendance-proxy',
        denominatorDays: 1,
      },
    ]);
  });
});

describe('summariseWeekdayPattern', () => {
  it('carries the basis through per weekday, so a screen can say which denominator it got', () => {
    // The calendar is passed whole and `averageOverOpenDays` intersects it with each weekday's
    // bucket, which is why bucketing first and filtering second is correct rather than merely
    // convenient. Saturday is in the calendar with no attendance, so it averages a real zero
    // instead of reporting null.
    const operating: OperatingDays = {
      basis: 'schedule',
      weekdays: [1, 2, 3, 4, 5, 6],
      dates: ['2026-08-03', '2026-08-08'],
      closedDates: [],
    };
    const pattern = summariseWeekdayPattern(twoWeeks, operating);

    const saturday = pattern.find((p) => p.weekday === 6)!;
    expect(saturday.averageBasis).toBe('operating-days');
    expect(saturday.denominatorDays).toBe(1);
    expect(saturday.averageChildren).toBe(0);
    // Nobody came, and that is a different fact from the service being shut.
    expect(saturday.daysWithAttendance).toBe(0);

    // Sunday is in neither the calendar nor the attendance, so it has nothing to divide by.
    const sunday = pattern.find((p) => p.weekday === 7)!;
    expect(sunday.averageChildren).toBeNull();
  });

  it('returns all seven weekdays, Monday first, even when some had no data', () => {
    const pattern = summariseWeekdayPattern(twoWeeks);
    expect(pattern.map((p) => p.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('averages one weekday across both weeks it appeared in', () => {
    // Monday: 20 (week 1) and 30 (week 2), both open -> average 25.
    const pattern = summariseWeekdayPattern(twoWeeks);
    expect(pattern[0]).toMatchObject({ weekday: 1, daysWithAttendance: 2, averageChildren: 25 });
  });

  it('excludes closed days from a weekday average rather than diluting it', () => {
    // Wednesday: 0 (week 1, closed) and 24 (week 2, open) -> average over the one open day, 24.
    const pattern = summariseWeekdayPattern(twoWeeks);
    expect(pattern[2]).toMatchObject({ weekday: 3, daysWithAttendance: 1, averageChildren: 24 });
  });

  it('reports null for a weekday that never had attendance', () => {
    const pattern = summariseWeekdayPattern([day('2026-08-01', 0), day('2026-08-08', 0)]); // both Saturdays
    const saturday = pattern.find((p) => p.weekday === 6)!;
    expect(saturday).toMatchObject({ daysWithAttendance: 0, averageChildren: null });
  });
});

describe('completeWeeksBefore', () => {
  it('excludes the week `today` falls in, even on a Sunday', () => {
    // 2026-08-09 is itself a Sunday. Treating its own week as complete would need to assume
    // what time of day it is, which no caller here knows.
    const { rangeStart, rangeEnd } = completeWeeksBefore('2026-08-09', 1);
    expect(rangeEnd).toBe('2026-08-02');
    expect(rangeStart).toBe('2026-07-27');
  });

  it('excludes the week `today` falls in on a Monday too', () => {
    const { rangeStart, rangeEnd } = completeWeeksBefore('2026-08-03', 1);
    expect(rangeEnd).toBe('2026-08-02');
    expect(rangeStart).toBe('2026-07-27');
  });

  it('spans exactly 7 * weekCount days', () => {
    const { rangeStart, rangeEnd } = completeWeeksBefore('2026-08-09', 12);
    expect(rangeEnd).toBe('2026-08-02');
    expect(rangeStart).toBe('2026-05-11');
  });
});
