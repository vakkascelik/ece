import { describe, expect, it } from 'vitest';
import { dayWindow, lastSevenDays } from '../window';

const NZ = 'Pacific/Auckland';

/**
 * Converting "a day at the centre" into a pair of instants.
 *
 * Worth testing properly because the failure is quiet and consequential: get it wrong
 * and a whole morning of attendance is attributed to the previous date, which for a
 * ratio report means the evidence describes the wrong day.
 */
describe('dayWindow', () => {
  it('spans midnight to midnight in New Zealand, not in UTC', () => {
    // 4 August 2026 is NZST (+12), so the local day begins at 12:00 UTC on the 3rd.
    const { fromUtc, toUtc } = dayWindow('2026-08-04', NZ);
    expect(fromUtc).toBe('2026-08-03T12:00:00.000Z');
    expect(toUtc).toBe('2026-08-04T12:00:00.000Z');
  });

  it('uses the +13 offset during daylight saving', () => {
    // January is NZDT.
    const { fromUtc, toUtc } = dayWindow('2026-01-15', NZ);
    expect(fromUtc).toBe('2026-01-14T11:00:00.000Z');
    expect(toUtc).toBe('2026-01-15T11:00:00.000Z');
  });

  it('produces a 23-hour day when the clocks go forward', () => {
    // NZDT begins on the last Sunday of September — 27 September 2026 — when 2am becomes
    // 3am. A naive fixed-offset conversion gives 24 hours and silently shifts everything
    // after the transition by an hour.
    const { fromUtc, toUtc } = dayWindow('2026-09-27', NZ);
    const hours = (Date.parse(toUtc) - Date.parse(fromUtc)) / 3_600_000;
    expect(hours).toBe(23);
  });

  it('produces a 25-hour day when the clocks go back', () => {
    // NZST resumes on the first Sunday of April — 5 April 2026.
    const { fromUtc, toUtc } = dayWindow('2026-04-05', NZ);
    const hours = (Date.parse(toUtc) - Date.parse(fromUtc)) / 3_600_000;
    expect(hours).toBe(25);
  });

  it('leaves no gap and no overlap between consecutive days', () => {
    // Including across a transition: an event must fall in exactly one day's window, or
    // it is either double-counted or lost from the ratio history.
    for (const [first, second] of [
      ['2026-08-04', '2026-08-05'],
      ['2026-09-26', '2026-09-27'],
      ['2026-09-27', '2026-09-28'],
      ['2026-04-04', '2026-04-05'],
      ['2026-04-05', '2026-04-06'],
    ] as const) {
      expect(dayWindow(first, NZ).toUtc).toBe(dayWindow(second, NZ).fromUtc);
    }
  });

  it('works for a zone that does not observe daylight saving', () => {
    const { fromUtc, toUtc } = dayWindow('2026-08-04', 'UTC');
    expect(fromUtc).toBe('2026-08-04T00:00:00.000Z');
    expect(toUtc).toBe('2026-08-05T00:00:00.000Z');
  });

  it('refuses a value that is not an ISO date', () => {
    expect(() => dayWindow('4 August 2026', NZ)).toThrow();
  });
});

describe('lastSevenDays', () => {
  it('returns seven days ending today, oldest first', () => {
    expect(lastSevenDays('2026-08-04')).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(lastSevenDays('2026-03-03')[0]).toBe('2026-02-25');
  });

  it('crosses a year boundary', () => {
    expect(lastSevenDays('2027-01-02')[0]).toBe('2026-12-27');
  });
});
