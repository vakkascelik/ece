import { describe, expect, it } from 'vitest';
import { dayWindow, lastSevenDays, zonedWallClockToUtc } from '../dayWindow';

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

/**
 * `zonedWallClockToUtc` — the conversion that `new Date(string)` gets wrong on a server.
 *
 * Every case below is asserted as an absolute instant rather than round-tripped, because a
 * round trip through the same wrong offset passes.
 */
describe('zonedWallClockToUtc', () => {
  it('reads a wall clock in the centre’s zone, not the runtime’s', () => {
    // August is NZST, +12. 08:05 in Auckland is 20:05 the previous day in UTC.
    // `new Date('2026-08-06T08:05')` under TZ=UTC gives 2026-08-06T08:05:00.000Z, which is the
    // production bug: eleven hours in the future, refused by attendance_not_future.
    expect(zonedWallClockToUtc('2026-08-06T08:05', 'Pacific/Auckland')).toBe(
      '2026-08-05T20:05:00.000Z',
    );
  });

  it('uses +13 in daylight time, so it is not a hard-coded twelve', () => {
    // January is NZDT, +13. This is the assertion that fails if somebody "simplifies" the Intl
    // lookup into a constant offset.
    expect(zonedWallClockToUtc('2026-01-15T08:05', 'Pacific/Auckland')).toBe(
      '2026-01-14T19:05:00.000Z',
    );
  });

  it('handles the evening case that used to be stored at the wrong instant', () => {
    // A correction entered at 21:30 NZST cleared the two-hour future window under the old code
    // and was stored 12 hours late, which flipped a child who had gone home back onto the roll.
    expect(zonedWallClockToUtc('2026-08-06T21:30', 'Pacific/Auckland')).toBe(
      '2026-08-06T09:30:00.000Z',
    );
  });

  it('accepts seconds, and a space instead of the T', () => {
    expect(zonedWallClockToUtc('2026-08-06T08:05:30', 'Pacific/Auckland')).toBe(
      '2026-08-05T20:05:30.000Z',
    );
    expect(zonedWallClockToUtc('2026-08-06 08:05', 'Pacific/Auckland')).toBe(
      '2026-08-05T20:05:00.000Z',
    );
  });

  it('refuses something that is not a local date and time', () => {
    // The old code accepted 'not a time' as Invalid Date and reported it; this must still refuse
    // rather than silently producing an instant.
    expect(() => zonedWallClockToUtc('08:05', 'Pacific/Auckland')).toThrow(/local date and time/);
    expect(() => zonedWallClockToUtc('', 'Pacific/Auckland')).toThrow();
  });

  it('crosses a daylight-saving transition without landing an hour out', () => {
    // NZ moves to NZDT at 2am on the last Sunday in September. 2026-09-27. Midnight that day is
    // still NZST (+12); midday is NZDT (+13). A single-pass conversion using one offset for both
    // is wrong for one of them, which is why the offset is re-read at the candidate instant.
    expect(zonedWallClockToUtc('2026-09-27T00:30', 'Pacific/Auckland')).toBe(
      '2026-09-26T12:30:00.000Z',
    );
    expect(zonedWallClockToUtc('2026-09-27T12:30', 'Pacific/Auckland')).toBe(
      '2026-09-26T23:30:00.000Z',
    );
  });
});
