import { describe, expect, it } from 'vitest';
import { dayOccupancy, summariseOccupancy, type DayAttendance } from '../occupancy';

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
