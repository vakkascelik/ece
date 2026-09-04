import { describe, expect, it } from 'vitest';
import { closureOn, isClosedOn, operatingDays, type ServiceClosure } from '../closures';
import type { WeekdayBlock } from '../weekdayBlock';

/**
 * `service_closures` (0088) — the predicates the occupancy average and §6-6 will both read.
 *
 * The assertions that matter are the two boundaries, because both are places where being
 * wrong looks right: an off-by-one at the end of a closure drops a day from a funding
 * suspension, and a null end that behaved like a one-day closure would let a second closure
 * be recorded inside an ongoing one.
 */
const closure = (over: Partial<ServiceClosure>): ServiceClosure => ({
  id: 'c1',
  centreId: 'centre',
  startsOn: '2026-07-06',
  endsOn: '2026-07-17',
  reasonCode: null,
  reasonNote: 'Term break',
  ...over,
});

describe('isClosedOn', () => {
  const term = [closure({})];

  it('covers both endpoints, because a closure from Monday to Friday includes Friday', () => {
    expect(isClosedOn(term, '2026-07-06')).toBe(true);
    expect(isClosedOn(term, '2026-07-17')).toBe(true);
  });

  /*
    The mirror of the assertion above, and the reason both are here: an inclusive end that
    was accidentally exclusive would still pass "the first day is closed", and the day it
    silently dropped is the one a §6-6 suspension turns on.

    This also has to agree with the database. `service_closures_no_overlap` uses a `[]` range,
    so if these two disagreed, a closure the constraint refuses as overlapping would be
    treated here as leaving a gap between them.
  */
  it('does not cover the day before or the day after', () => {
    expect(isClosedOn(term, '2026-07-05')).toBe(false);
    expect(isClosedOn(term, '2026-07-18')).toBe(false);
  });

  it('covers a day in the middle, so the test is not only about edges', () => {
    expect(isClosedOn(term, '2026-07-10')).toBe(true);
  });

  /*
    A closure with no stated end is the flood case: shut on Tuesday, nobody knows for how
    long. It covers every later date, which is both the truth and what the exclusion
    constraint in 0088 enforces with `coalesce(ends_on, 'infinity')`.
  */
  it('treats a null end as covering every later date, not as one day', () => {
    const open = [closure({ endsOn: null, startsOn: '2026-07-06' })];
    expect(isClosedOn(open, '2026-07-06')).toBe(true);
    expect(isClosedOn(open, '2026-07-07')).toBe(true);
    expect(isClosedOn(open, '2030-01-01')).toBe(true);
    // But still not before it started.
    expect(isClosedOn(open, '2026-07-05')).toBe(false);
  });

  it('is false for a centre with nothing recorded', () => {
    expect(isClosedOn([], '2026-07-10')).toBe(false);
  });

  it('answers across several closures', () => {
    const year = [
      closure({ id: 'a', startsOn: '2026-04-06', endsOn: '2026-04-17' }),
      closure({ id: 'b', startsOn: '2026-07-06', endsOn: '2026-07-17' }),
    ];
    expect(isClosedOn(year, '2026-04-10')).toBe(true);
    expect(isClosedOn(year, '2026-07-10')).toBe(true);
    expect(isClosedOn(year, '2026-05-10')).toBe(false);
  });
});

describe('closureOn', () => {
  it('returns the closure covering the date, so a screen can say why', () => {
    const year = [
      closure({ id: 'a', startsOn: '2026-04-06', endsOn: '2026-04-17', reasonNote: 'Easter' }),
      closure({ id: 'b', startsOn: '2026-07-06', endsOn: '2026-07-17', reasonNote: 'July' }),
    ];
    expect(closureOn(year, '2026-07-10')?.reasonNote).toBe('July');
    expect(closureOn(year, '2026-04-10')?.reasonNote).toBe('Easter');
  });

  it('returns null rather than undefined when nothing covers the date', () => {
    // Null, not undefined: a caller destructuring this into a prop needs one absent value,
    // and `?? null` at every call site is the version somebody forgets once.
    expect(closureOn([closure({})], '2026-05-10')).toBeNull();
    expect(closureOn([], '2026-05-10')).toBeNull();
  });
});

/*
  `operatingDays` — the question RS7's advance-month counts and the occupancy average both
  ask, and which nothing recorded until 2026-09-05.

  Every case below is one where being wrong looks plausible: a closure that loses to the
  weekday pattern, a schedule that expired but still votes, a range with no schedule at all
  answering "zero operating days" instead of "cannot tell".
*/

/** A Monday-and-Wednesday pattern, effective for ever unless told otherwise. */
const monWed = (over: Partial<WeekdayBlock> = {}): WeekdayBlock[] => [
  { weekday: 1, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null, ...over },
  { weekday: 3, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null, ...over },
];

describe('operatingDays', () => {
  it('derives the weekdays from the schedule and lists the dates', () => {
    // Mon 3 Aug to Sun 9 Aug 2026: one Monday, one Wednesday.
    const r = operatingDays({
      blocks: monWed(),
      closures: [],
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(r.basis).toBe('schedule');
    expect(r.weekdays).toEqual([1, 3]);
    expect(r.dates).toEqual(['2026-08-03', '2026-08-05']);
    expect(r.closedDates).toEqual([]);
  });

  it('lets a closure beat the pattern', () => {
    // The service normally operates that Wednesday. It was shut.
    const r = operatingDays({
      blocks: monWed(),
      closures: [closure({ startsOn: '2026-08-05', endsOn: '2026-08-05' })],
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(r.dates).toEqual(['2026-08-03']);
    expect(r.closedDates).toEqual(['2026-08-05']);
    // And the weekday is no longer claimed at all, because no Wednesday in range operated.
    expect(r.weekdays).toEqual([1]);
  });

  it('records closed days even when it cannot tell what the pattern is', () => {
    /*
      Both bases populate `closedDates`, and this is the assertion that pins it. A closure is
      recorded directly and does not depend on knowing the weekday pattern — so a caller that
      only wants "were we shut" gets an answer even with no schedule.
    */
    const r = operatingDays({
      blocks: [],
      closures: [closure({ startsOn: '2026-08-05', endsOn: '2026-08-06' })],
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(r.basis).toBe('unknown');
    expect(r.dates).toEqual([]);
    expect(r.weekdays).toEqual([]);
    expect(r.closedDates).toEqual(['2026-08-05', '2026-08-06']);
  });

  it('answers UNKNOWN, not zero, when every block expired before the range', () => {
    /*
      The distinction the three-state basis exists for. Blocks exist, so an implementation
      testing `blocks.length === 0` would answer `schedule` with no dates — which reads as a
      permanently closed service rather than as a service whose schedule nobody has updated.
    */
    const r = operatingDays({
      blocks: monWed({ effectiveTo: '2026-07-31' }),
      closures: [],
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(r.basis).toBe('unknown');
    expect(r.dates).toEqual([]);
  });

  it('derives per date, so a block that ends mid-range stops contributing', () => {
    // The Wednesday pattern ends on the 5th; the following Wednesday must not operate.
    const r = operatingDays({
      blocks: [
        { weekday: 1, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
        { weekday: 3, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: '2026-08-05' },
      ],
      closures: [],
      from: '2026-08-03',
      to: '2026-08-16',
    });
    expect(r.dates).toEqual(['2026-08-03', '2026-08-05', '2026-08-10']);
    // A range-wide union of weekdays would have kept the 12th, which is the bug this catches.
    expect(r.dates).not.toContain('2026-08-12');
  });

  it('unions the days across children rather than taking one child as the pattern', () => {
    const r = operatingDays({
      blocks: [
        { weekday: 1, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
        { weekday: 5, fromTime: '09:00', toTime: '12:00', effectiveFrom: '2026-01-01', effectiveTo: null },
      ],
      closures: [],
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(r.weekdays).toEqual([1, 5]);
    expect(r.dates).toEqual(['2026-08-03', '2026-08-07']);
  });
});
