import { describe, expect, it } from 'vitest';
import {
  averageOverOpenDays,
  dayOccupancy,
  summariseOccupancy,
  type DayAttendance,
} from '../occupancy';
import type { OperatingDays } from '../closures';

const day = (date: string, children: number): DayAttendance => ({ date, children });

describe('dayOccupancy', () => {
  it('computes a percentage when the licence is stated', () => {
    const r = dayOccupancy(day('2026-08-03', 26), 40);
    expect(r).toMatchObject({ stated: true, percent: 65, licensedPlaces: 40 });
  });

  it('reports NOT STATED rather than zero when no licence has been entered', () => {
    /*
      The assertion this module exists for. `percent: 0` would render as an empty centre,
      which reads as a crisis rather than as a blank settings field — and a manager would
      act on it. The type has no `percent` on this branch at all, so a caller cannot
      accidentally read one.
    */
    const r = dayOccupancy(day('2026-08-03', 26), null);
    expect(r.stated).toBe(false);
    expect(r).not.toHaveProperty('percent');
    // The attendance itself is still real and still reported.
    expect(r.children).toBe(26);
  });

  it('treats a nonsensical licence as not stated rather than dividing by it', () => {
    // The CHECK in 0050 refuses these, so this is the second line. A zero denominator
    // would produce Infinity and render as "Infinity%".
    expect(dayOccupancy(day('2026-08-03', 26), 0).stated).toBe(false);
    expect(dayOccupancy(day('2026-08-03', 26), -5).stated).toBe(false);
  });

  it('does NOT cap the percentage at 100', () => {
    /*
      A day over the licence is the most important row this report can hold, and clamping
      it would hide precisely what somebody is looking for.

      It is also reachable without a rule being broken: `children` counts everyone present
      at any point, so a morning child leaving before an afternoon child arrives can
      exceed the licence across a day while never exceeding it at any instant. The screen
      has to say that, because the alternative is accusing a centre of a breach it did
      not commit.
    */
    const r = dayOccupancy(day('2026-08-03', 45), 40);
    expect(r).toMatchObject({ stated: true, percent: 112.5 });
  });

  it('rounds to one decimal rather than showing a repeating fraction', () => {
    expect(dayOccupancy(day('2026-08-03', 1), 3)).toMatchObject({ percent: 33.3 });
  });
});

describe('summariseOccupancy', () => {
  const fortnight = [
    day('2026-08-01', 0), // Saturday
    day('2026-08-02', 0), // Sunday
    day('2026-08-03', 30),
    day('2026-08-04', 36),
    day('2026-08-05', 24),
  ];

  it('averages over OPEN days, not calendar days', () => {
    /*
      The bug this is written against. Averaging 90 children over five calendar days gives
      18; over the three days the centre was actually open it gives 30. The first figure
      is a third low and is exactly the one somebody would put in a board paper, and
      nothing about it looks wrong.
    */
    const s = summariseOccupancy(fortnight, 40);
    expect(s.daysWithAttendance).toBe(3);
    expect(s.averageChildren).toBe(30);
  });

  it('names the busiest day', () => {
    expect(summariseOccupancy(fortnight, 40).busiest).toEqual(day('2026-08-04', 36));
  });

  it('reports no average and no busiest day when nothing was recorded', () => {
    // Null rather than 0: "we have no attendance data" and "no children came" are
    // different statements, and only one of them is alarming.
    const s = summariseOccupancy([day('2026-08-01', 0), day('2026-08-02', 0)], 40);
    expect(s.averageChildren).toBeNull();
    expect(s.busiest).toBeNull();
    expect(s.daysWithAttendance).toBe(0);
  });

  it('lists days AT the licence as well as over it', () => {
    // At capacity is the operationally interesting number — it is the day a centre turned
    // a family away. `>` rather than `>=` would omit it.
    const s = summariseOccupancy([day('2026-08-03', 40), day('2026-08-04', 41), day('2026-08-05', 39)], 40);
    expect(s.daysAtOrOverLicence).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('lists no such days when the licence is not stated, rather than guessing one', () => {
    const s = summariseOccupancy(fortnight, null);
    expect(s.daysAtOrOverLicence).toEqual([]);
    // But the attendance figures survive — they do not depend on the licence.
    expect(s.averageChildren).toBe(30);
    expect(s.busiest).toEqual(day('2026-08-04', 36));
  });
});

/*
  THE AVERAGE'S DENOMINATOR — [[unverified-claims]] item 59.

  `averageOverOpenDays` filtered with `d.children > 0` and called the result "open days". The
  assertions below are the two cases that proxy cannot tell apart, and the figure differs by a
  third between them.
*/

const schedule = (dates: string[], closedDates: string[] = []): OperatingDays => ({
  basis: 'schedule',
  weekdays: [1, 2, 3, 4, 5],
  dates,
  closedDates,
});

describe('averageOverOpenDays — which days are the denominator', () => {
  /*
    One week. The service operated Monday to Friday. Thirty children on four of those days and
    a wet Tuesday when four came.

    Proxy: 5 days had attendance, mean (30+4+30+30+30)/5 = 24.8 — same answer here, because
    every operating day happened to have somebody on it. The divergence needs a ZERO day.
  */
  const wetTuesday: DayAttendance[] = [
    day('2026-08-03', 30),
    day('2026-08-04', 4),
    day('2026-08-05', 30),
    day('2026-08-06', 30),
    day('2026-08-07', 30),
  ];

  it('counts a day the service operated and nobody attended', () => {
    /*
      THE ASSERTION THE WHOLE FIX EXISTS FOR. Nobody came on the Wednesday — a real zero, and
      on the operating calendar it belongs in the denominator.

      Proxy: (30+4+30+30)/4 = 23.5 over four days.
      Calendar: (30+4+0+30+30)/5 = 18.8 over five.

      Nearly five children of difference, in the flattering direction, on a figure that ends
      up in a board paper.
    */
    const withAZero: DayAttendance[] = [
      day('2026-08-03', 30),
      day('2026-08-04', 4),
      day('2026-08-05', 0),
      day('2026-08-06', 30),
      day('2026-08-07', 30),
    ];
    const dates = withAZero.map((d) => d.date);

    const proxy = averageOverOpenDays(withAZero);
    expect(proxy.basis).toBe('attendance-proxy');
    expect(proxy.averageChildren).toBe(23.5);
    expect(proxy.denominatorDays).toBe(4);

    const calendar = averageOverOpenDays(withAZero, schedule(dates));
    expect(calendar.basis).toBe('operating-days');
    expect(calendar.averageChildren).toBe(18.8);
    expect(calendar.denominatorDays).toBe(5);

    // `daysWithAttendance` keeps its old meaning on BOTH bases. Redefining it silently would
    // be the drift this repo has paid for twice.
    expect(calendar.daysWithAttendance).toBe(4);
  });

  it('leaves a closed day out of the denominator', () => {
    // A weekend, or a term break: not a data point, and averaging it in reports a fraction of
    // the truth. The calendar simply does not list it.
    const withAWeekend = [...wetTuesday, day('2026-08-08', 0), day('2026-08-09', 0)];
    const r = averageOverOpenDays(withAWeekend, schedule(wetTuesday.map((d) => d.date)));
    expect(r.denominatorDays).toBe(5);
    expect(r.averageChildren).toBe(24.8);
  });

  it('still counts a day with attendance the calendar does not list', () => {
    /*
      The calendar says Monday to Friday; somebody was demonstrably there on the Saturday. The
      children were present, so the CALENDAR is what is wrong — dropping the day would hide an
      attendance record that contradicts the schedule, which is the opposite of what this
      product does with a contradiction.
    */
    const withASaturday = [...wetTuesday, day('2026-08-08', 6)];
    const r = averageOverOpenDays(withASaturday, schedule(wetTuesday.map((d) => d.date)));
    expect(r.denominatorDays).toBe(6);
  });

  it('falls back to the proxy, and says so, when the calendar cannot tell', () => {
    // `unknown` is not an empty calendar. Treating it as one would make every average null.
    const unknown: OperatingDays = {
      basis: 'unknown',
      weekdays: [],
      dates: [],
      closedDates: ['2026-08-08'],
    };
    const r = averageOverOpenDays(wetTuesday, unknown);
    expect(r.basis).toBe('attendance-proxy');
    expect(r.averageChildren).toBe(24.8);
  });

  it('reports null rather than zero when there is nothing to average', () => {
    const r = averageOverOpenDays([], schedule([]));
    expect(r.averageChildren).toBeNull();
    expect(r.denominatorDays).toBe(0);
  });

  it('carries the basis out through summariseOccupancy, because a screen must render it', () => {
    const withAZero = [day('2026-08-03', 30), day('2026-08-04', 0)];
    const dates = withAZero.map((d) => d.date);

    const proxied = summariseOccupancy(withAZero, 40);
    expect(proxied.averageBasis).toBe('attendance-proxy');
    expect(proxied.averageChildren).toBe(30);

    const calendared = summariseOccupancy(withAZero, 40, schedule(dates));
    expect(calendared.averageBasis).toBe('operating-days');
    expect(calendared.averageChildren).toBe(15);
    expect(calendared.denominatorDays).toBe(2);
  });
});
