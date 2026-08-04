import { describe, expect, it } from 'vitest';
import {
  assessRatio,
  requiredAdultsFor,
  splitByAgeBand,
  RATIO_TABLES_VERIFIED,
  TWO_AND_OVER_TABLE,
  UNDER_TWO_TABLE,
} from '../ratios';

/**
 * These test the arithmetic, not the law.
 *
 * The bands themselves are an unverified reading of Schedule 2, and a test cannot
 * confirm a regulation — it can only confirm that whatever numbers are in the table
 * are applied correctly. The distinction matters: a green suite here does not mean
 * the ratios are right, it means the maths is.
 */

describe('requiredAdultsFor', () => {
  it('needs nobody for nobody', () => {
    expect(requiredAdultsFor(0, UNDER_TWO_TABLE)).toBe(0);
    expect(requiredAdultsFor(0, TWO_AND_OVER_TABLE)).toBe(0);
    expect(requiredAdultsFor(-3, UNDER_TWO_TABLE)).toBe(0);
  });

  it('steps at the band boundaries, not through them', () => {
    // The boundary is the interesting case: 5 is one adult, 6 is two. An off-by-one
    // here understaffs a room.
    expect(requiredAdultsFor(1, UNDER_TWO_TABLE)).toBe(1);
    expect(requiredAdultsFor(5, UNDER_TWO_TABLE)).toBe(1);
    expect(requiredAdultsFor(6, UNDER_TWO_TABLE)).toBe(2);
    expect(requiredAdultsFor(10, UNDER_TWO_TABLE)).toBe(2);
    expect(requiredAdultsFor(11, UNDER_TWO_TABLE)).toBe(3);
  });

  it('follows the over-2 table', () => {
    expect(requiredAdultsFor(6, TWO_AND_OVER_TABLE)).toBe(1);
    expect(requiredAdultsFor(7, TWO_AND_OVER_TABLE)).toBe(2);
    expect(requiredAdultsFor(20, TWO_AND_OVER_TABLE)).toBe(2);
    expect(requiredAdultsFor(21, TWO_AND_OVER_TABLE)).toBe(3);
    expect(requiredAdultsFor(50, TWO_AND_OVER_TABLE)).toBe(5);
  });

  it('rounds a part-band up past the end of the table', () => {
    // "or part thereof" — 51 children is not 5.1 adults.
    expect(requiredAdultsFor(51, TWO_AND_OVER_TABLE)).toBe(6);
    expect(requiredAdultsFor(60, TWO_AND_OVER_TABLE)).toBe(6);
    expect(requiredAdultsFor(61, TWO_AND_OVER_TABLE)).toBe(7);
    expect(requiredAdultsFor(21, UNDER_TWO_TABLE)).toBe(5);
  });
});

describe('assessRatio', () => {
  it('is ok with room to spare', () => {
    const r = assessRatio({ underTwo: 2, twoAndOver: 4, adultsPresent: 3 });
    expect(r.adultsRequired).toBe(2); // 1 for the under-2s, 1 for the rest
    expect(r.status).toBe('ok');
    expect(r.shortfall).toBe(0);
    expect(r.warning).toBeNull();
  });

  it('reports a breach with the shortfall, not just a flag', () => {
    // 12 under 2 needs 3 adults; 25 over 2 needs 3. Eight short of six is a breach
    // and the useful number is how many more people are needed.
    const r = assessRatio({ underTwo: 12, twoAndOver: 25, adultsPresent: 4 });
    expect(r.adultsRequired).toBe(6);
    expect(r.status).toBe('breach');
    expect(r.shortfall).toBe(2);
  });

  it('warns BEFORE the breach, which is the whole point', () => {
    // 5 under 2 with one adult is legal. The sixth is not, and the warning has to
    // arrive while the parent is still at the door.
    const r = assessRatio({ underTwo: 5, twoAndOver: 0, adultsPresent: 1 });
    expect(r.status).toBe('at-limit');
    expect(r.shortfall).toBe(0);
    expect(r.warning).toContain('under 2');
    expect(r.headroomUnderTwo).toBe(0);
  });

  it('names both bands when either would tip it', () => {
    // 5 under 2 (1 adult) + 6 over 2 (1 adult) = 2 required, 2 present. Either band
    // taking one more child needs a third adult.
    const r = assessRatio({ underTwo: 5, twoAndOver: 6, adultsPresent: 2 });
    expect(r.status).toBe('at-limit');
    expect(r.warning).toContain('under 2');
    expect(r.warning).toContain('2 or over');
  });

  it('does not warn when there is genuine headroom', () => {
    const r = assessRatio({ underTwo: 3, twoAndOver: 3, adultsPresent: 2 });
    expect(r.status).toBe('ok');
    expect(r.headroomUnderTwo).toBe(2);
    expect(r.headroomTwoAndOver).toBe(3);
  });

  it('treats an empty room as ok, not as being at the limit', () => {
    // A closed centre satisfies "one more child would need an adult" trivially, and
    // an indicator that cries wolf on an empty room is one people learn to ignore.
    const r = assessRatio({ underTwo: 0, twoAndOver: 0, adultsPresent: 0 });
    expect(r.status).toBe('ok');
    expect(r.adultsRequired).toBe(0);
    expect(r.warning).toBeNull();
    expect(r.citations).toEqual([]);
  });

  it('but still warns the moment one child is present at the limit', () => {
    // The distinction the case above is guarding: one child and no adult is a
    // breach, and one child with the last available adult is a warning.
    expect(assessRatio({ underTwo: 1, twoAndOver: 0, adultsPresent: 0 }).status).toBe('breach');
    expect(assessRatio({ underTwo: 5, twoAndOver: 0, adultsPresent: 1 }).status).toBe('at-limit');
  });

  it('is a breach when children are present and nobody is', () => {
    const r = assessRatio({ underTwo: 1, twoAndOver: 0, adultsPresent: 0 });
    expect(r.status).toBe('breach');
    expect(r.shortfall).toBe(1);
  });

  it('cites only the rules that bear on this room', () => {
    const onlyBabies = assessRatio({ underTwo: 3, twoAndOver: 0, adultsPresent: 1 });
    expect(onlyBabies.citations).toHaveLength(1);
    expect(onlyBabies.citations[0]).toContain('under 2');

    const both = assessRatio({ underTwo: 3, twoAndOver: 3, adultsPresent: 2 });
    expect(both.citations).toHaveLength(2);
  });

  it('carries the unverified flag through to the caller', () => {
    // So the UI cannot show a compliance figure without also being able to say the
    // figures have not been checked. Flipping the constant is a claim about the law.
    expect(assessRatio({ underTwo: 1, twoAndOver: 0, adultsPresent: 1 }).verified).toBe(
      RATIO_TABLES_VERIFIED,
    );
  });

  it('ignores fractional and negative input rather than propagating it', () => {
    const r = assessRatio({ underTwo: 2.7, twoAndOver: -4, adultsPresent: 1.9 });
    expect(r.underTwo).toBe(2);
    expect(r.twoAndOver).toBe(0);
    expect(r.adultsPresent).toBe(1);
  });
});

describe('splitByAgeBand', () => {
  it('splits on the second birthday', () => {
    const almostTwo = '2024-08-05';
    const justTwo = '2024-08-03';
    // Fixed reference through todayInZone's default is not injectable here, so this
    // asserts the split is consistent rather than a specific date — the birthday
    // boundary itself is covered in children.test.ts.
    const { underTwo, twoAndOver } = splitByAgeBand([
      { dateOfBirth: almostTwo },
      { dateOfBirth: justTwo },
      { dateOfBirth: '2019-01-01' },
    ]);
    expect(underTwo + twoAndOver).toBe(3);
    expect(twoAndOver).toBeGreaterThanOrEqual(1);
  });

  it('handles an empty room', () => {
    expect(splitByAgeBand([])).toEqual({ underTwo: 0, twoAndOver: 0 });
  });
});
