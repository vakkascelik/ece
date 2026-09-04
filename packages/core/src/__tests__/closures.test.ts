import { describe, expect, it } from 'vitest';
import { closureOn, isClosedOn, type ServiceClosure } from '../closures';

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
