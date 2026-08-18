import { describe, expect, it } from 'vitest';
import {
  assessRatio,
  requiredAdultsFor,
  splitByAgeBand,
  RATIO_TABLES_VERIFIED,
  TWO_AND_OVER_TABLE,
  UNDER_TWO_TABLE,
  type RatioTable,
} from '../ratios';

/**
 * These test the arithmetic, not the law.
 *
 * A test cannot confirm a regulation — it can only confirm that whatever numbers are in
 * the table are applied correctly. That distinction survived the bands being checked
 * against Schedule 2 on 2026-08-18: a green suite here still does not mean the ratios are
 * right, it means the maths is. The evidence that they are right is a transcription in the
 * commit and in ratios.ts, not anything below.
 *
 * The one exception is `the published rows`, which asserts this table reproduces every row
 * Schedule 2 actually prints. That is as close to testing the law as is available, and it
 * is what makes `thereafterPerAdult` a claim rather than a convenience.
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

  it('carries the verification flag through to the caller', () => {
    // So the UI cannot show a compliance figure without also being able to say whether the
    // figures have been checked. Flipping the constant is a claim about the law, and this
    // asserts the wiring rather than the value — a centre on a licence variation passes its
    // own table in and that one has been read by nobody.
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

describe('the published rows of Schedule 2', () => {
  /*
    Transcribed from Schedule 2 as at 29 June 2026, legislation.govt.nz, all-day
    centre-based. This is the assertion that makes the tables a claim about the law
    rather than a plausible shape: `thereafterPerAdult` compresses everything past the
    last band, so without checking it against the printed rows there is nothing to stop
    "one more adult per 10" being wrong from 51 children upward and nobody noticing.
  */
  const UNDER_TWO_PUBLISHED: Array<[number, number]> = [
    [5, 1],
    [10, 2],
    [15, 3],
    [20, 4],
    [25, 5],
  ];

  const TWO_AND_OVER_PUBLISHED: Array<[number, number]> = [
    [6, 1],
    [20, 2],
    [30, 3],
    [40, 4],
    [50, 5],
    [60, 6],
    [70, 7],
    [80, 8],
    [90, 9],
    [100, 10],
    [110, 11],
    [120, 12],
    [130, 13],
    [140, 14],
    [150, 15],
  ];

  it('reproduces every under-2 row, at both ends of each band', () => {
    let low = 1;
    for (const [high, adults] of UNDER_TWO_PUBLISHED) {
      expect(requiredAdultsFor(low, UNDER_TWO_TABLE), `${low} children under 2`).toBe(adults);
      expect(requiredAdultsFor(high, UNDER_TWO_TABLE), `${high} children under 2`).toBe(adults);
      low = high + 1;
    }
  });

  it('reproduces every 2-and-over row, at both ends of each band', () => {
    let low = 1;
    for (const [high, adults] of TWO_AND_OVER_PUBLISHED) {
      expect(requiredAdultsFor(low, TWO_AND_OVER_TABLE), `${low} children 2+`).toBe(adults);
      expect(requiredAdultsFor(high, TWO_AND_OVER_TABLE), `${high} children 2+`).toBe(adults);
      low = high + 1;
    }
  });
});

describe('three or fewer children of mixed ages', () => {
  /*
    A row of its own in Schedule 2, and it was missing until 2026-08-18: "Up to 3 children
    of mixed ages … 1". Everything larger is the sum of the two bands, which the schedule
    states explicitly rather than leaving to inference.
  */
  it('needs one adult, not the sum of the two bands', () => {
    // Two infants and a three-year-old. Summing gives 2; the schedule says 1.
    const r = assessRatio({ underTwo: 2, twoAndOver: 1, adultsPresent: 1 });
    expect(r.adultsRequired).toBe(1);
    expect(r.status).not.toBe('breach');
  });

  it('stops applying at the fourth child', () => {
    // The boundary. Four mixed children fall back to the sum: 1 + 1 = 2.
    expect(assessRatio({ underTwo: 2, twoAndOver: 2, adultsPresent: 1 }).adultsRequired).toBe(2);
  });

  it('does not apply to a single-age group, which uses its own table', () => {
    expect(assessRatio({ underTwo: 3, twoAndOver: 0, adultsPresent: 1 }).adultsRequired).toBe(1);
    expect(assessRatio({ underTwo: 0, twoAndOver: 3, adultsPresent: 1 }).adultsRequired).toBe(1);
  });

  it('really does require BOTH groups, proved with a table that can show the difference', () => {
    /*
      The assertion above cannot fail. Both published tables give 1 adult for 1–3 children,
      so "mixed only" and "any group of 3 or fewer" produce identical answers everywhere —
      which a mutation run proved: changing `underTwo > 0 && twoAndOver > 0` to `||` broke
      nothing at all. A condition no test can see is a condition that will be deleted by
      somebody simplifying, and Schedule 2 does say *mixed*.

      A stricter table makes the difference observable. This is what `assessRatio` taking
      tables as arguments is for — a centre on a licence variation is the real case.
    */
    const strict: RatioTable = {
      label: 'Strict under 2',
      citation: 'Not a regulation — a fixture that makes the mixed-age condition observable.',
      bands: [{ upTo: 1, adults: 1 }, { upTo: 3, adults: 2 }],
      thereafterPerAdult: 2,
    };

    // Three under-2s alone: the strict table applies and asks for 2.
    expect(
      assessRatio({ underTwo: 3, twoAndOver: 0, adultsPresent: 1, underTwoTable: strict })
        .adultsRequired,
    ).toBe(2);

    // Two under-2s and one over-2 — mixed, three children — is 1 by the schedule's own row,
    // whatever the band tables would have said separately.
    expect(
      assessRatio({ underTwo: 2, twoAndOver: 1, adultsPresent: 1, underTwoTable: strict })
        .adultsRequired,
    ).toBe(1);
  });

  it('keeps the at-limit warning honest across the boundary', () => {
    // Three mixed children with one adult is legal. A fourth needs a second adult, so the
    // room is at the limit — and it must say so BEFORE the child is in it. If the
    // look-ahead did not go through the same rule, this would read "ok".
    const r = assessRatio({ underTwo: 2, twoAndOver: 1, adultsPresent: 1 });
    expect(r.status).toBe('at-limit');
    expect(r.warning).toMatch(/would need another adult/);
  });
});
