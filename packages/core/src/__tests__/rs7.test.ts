import { describe, expect, it } from 'vitest';
import { childFunding, type ChildFunding, type FundingPeriod } from '../funding';
import type { HoursEvent } from '../hours';
import { rs7DayCounts } from '../rs7';

/**
 * §9-2, §9-4 and §14-4 — the RS7 return's daily figures.
 *
 * Every expected number below is arithmetic done by hand in the comment above it, never a
 * snapshot of what the code produced. A snapshot test on a Crown return would lock in whatever
 * the first draft happened to compute, which is the opposite of what these assertions are for.
 *
 * The inputs are real `ChildFunding` results rather than hand-built objects, so the caps, the
 * absence rules and §9-2's hours source all apply exactly as they do in the product. Building
 * the input by hand would let a field drift from what `childFunding` actually returns —
 * `dailyCappedByDate` is pre-weekly-cap and it would be easy to write a fixture that forgets.
 */

const NZ = 'Pacific/Auckland';
const period: FundingPeriod = { label: 'Test', from: '2026-08-01', to: '2026-08-31' };

let seq = 0;
const ev = (kind: 'in' | 'out', when: string): HoursEvent => ({
  id: ++seq,
  kind,
  at: when,
  corrects: null,
});

/** A day of `hours` from 09:00, in August (NZST, +12:00). */
const day = (date: string, hours: number): HoursEvent[] => [
  ev('in', `${date}T09:00:00+12:00`),
  ev('out', `${date}T${String(9 + hours).padStart(2, '0')}:00:00+12:00`),
];

function fund(
  childId: string,
  events: HoursEvent[],
  over: { twentyHoursEce?: boolean; dateOfBirth?: string; enrolmentType?: 'casual' | 'permanent' } = {},
): ChildFunding {
  return childFunding({
    childId,
    events,
    timeZone: NZ,
    period,
    twentyHoursEce: over.twentyHoursEce ?? false,
    dateOfBirth: over.dateOfBirth,
    enrolmentType: over.enrolmentType ?? 'permanent',
  });
}

/** Born 2025-01-01: under two for all of August 2026 (19 months). */
const BABY = '2025-01-01';
/** Born 2022-01-01: four in August 2026, so two-and-over and old enough for 20 Hours. */
const OLDER = '2022-01-01';

describe('rs7DayCounts — the age split, per date', () => {
  it('puts each child in the bucket their age says ON THAT DATE, and rounds the total', () => {
    /*
      Two children on Monday 3 August, both attending 5 hours.
        under two:      5
        two and over:   5, and neither is attested, so nothing is deducted
      Both round to 5 exactly.
    */
    const children = [
      fund('baby', day('2026-08-03', 5), { dateOfBirth: BABY }),
      fund('older', day('2026-08-03', 5), { dateOfBirth: OLDER }),
    ];
    const r = rs7DayCounts({
      children,
      datesOfBirth: new Map([
        ['baby', BABY],
        ['older', OLDER],
      ]),
      period,
    });

    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({
      date: '2026-08-03',
      subsidyFundedChildUnderTwo: 5,
      subsidyFundedChildTwoAndOver: 5,
      twentyHoursFundedChild: 0,
      twentyHoursFundedChildPlusTen: 0,
    });
  });

  it('rounds the DAILY TOTAL ACROSS CHILDREN, not each child, and to NEAREST', () => {
    /*
      The assertion item 52 exists for, and the one a per-child implementation gets wrong.

      Three two-and-over children attending 2.5 hours each on one day.
        Per child, rounded first:  3 + 3 + 3 = 9   (and 2.5 floors to 2 under `toHours`, giving 6)
        Aggregate, rounded once:   7.5 → 8

      Three different answers from the same attendance. Only 8 is what §9-2 asks for.
    */
    const children = ['a', 'b', 'c'].map((id) =>
      fund(id, [ev('in', '2026-08-03T09:00:00+12:00'), ev('out', '2026-08-03T11:30:00+12:00')], {
        dateOfBirth: OLDER,
      }),
    );
    const r = rs7DayCounts({
      children,
      datesOfBirth: new Map(children.map((c) => [c.childId, OLDER])),
      period,
    });

    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(8);
  });

  it('rounds 0.4 down and 0.5 up, in the Handbook\'s words', () => {
    // §9-2 step 5, quoted: "Numbers ending in 0.5 or above should be rounded up… 0.4 or below
    // should be rounded down." `toHours` would floor both, which is why this file has its own.
    const down = fund('x', [
      ev('in', '2026-08-03T09:00:00+12:00'),
      ev('out', '2026-08-03T11:24:00+12:00'), // 2.4h
    ], { dateOfBirth: OLDER });
    const up = fund('y', [
      ev('in', '2026-08-04T09:00:00+12:00'),
      ev('out', '2026-08-04T11:30:00+12:00'), // 2.5h
    ], { dateOfBirth: OLDER });

    const r = rs7DayCounts({
      children: [down, up],
      datesOfBirth: new Map([
        ['x', OLDER],
        ['y', OLDER],
      ]),
      period,
    });
    expect(r.days.find((d) => d.date === '2026-08-03')?.subsidyFundedChildTwoAndOver).toBe(2);
    expect(r.days.find((d) => d.date === '2026-08-04')?.subsidyFundedChildTwoAndOver).toBe(3);
  });

  it('places hours in NEITHER age figure when no date of birth is recorded', () => {
    // Guessing an age band on a Crown return is not available. The hours are reported missing
    // instead, which is the census's contract and this product's standing rule.
    const r = rs7DayCounts({
      children: [fund('nameless', day('2026-08-03', 5))],
      datesOfBirth: new Map(),
      period,
    });
    expect(r.days[0]?.subsidyFundedChildUnderTwo).toBe(0);
    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(0);
    expect(r.assumptions.join(' ')).toContain('no recorded date of birth');
  });
});

describe('rs7DayCounts — the 20 Hours split, which §9-3 gives weekly and RS7 wants daily', () => {
  /** An attested four-year-old at 6 hours a day, Monday to Friday: 30 hours in the week. */
  const fullWeek = () =>
    fund(
      'attested',
      ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'].flatMap((d) =>
        day(d, 6),
      ),
      { twentyHoursEce: true, dateOfBirth: OLDER },
    );

  it('spends the twenty-hour entitlement in date order, then Plus 10', () => {
    /*
      Six hours a day, five days, attested. The weekly cap is 30 and the 20 Hours cap is 20.

        Mon  6 → 20 Hours 6   (14 left)
        Tue  6 → 20 Hours 6   (8 left)
        Wed  6 → 20 Hours 6   (2 left)
        Thu  6 → 20 Hours 2, Plus 10 4
        Fri  6 → Plus 10 6

      Weekly: 20 + 10 = 30, which is exactly what `childFunding` reports for the week. The
      daily projection is this file's, and it is disclosed.
    */
    const child = fullWeek();
    expect(child.twentyHoursHours).toBe(20);
    expect(child.plusTenHours).toBe(10);

    const r = rs7DayCounts({
      children: [child],
      datesOfBirth: new Map([['attested', OLDER]]),
      period,
    });

    expect(r.days.map((d) => d.twentyHoursFundedChild)).toEqual([6, 6, 6, 2, 0]);
    expect(r.days.map((d) => d.twentyHoursFundedChildPlusTen)).toEqual([0, 0, 0, 4, 6]);
    // And the daily figures still sum to the weekly ones the Handbook does state.
    expect(r.days.reduce((s, d) => s + d.twentyHoursFundedChild, 0)).toBe(20);
    expect(r.days.reduce((s, d) => s + d.twentyHoursFundedChildPlusTen, 0)).toBe(10);
    expect(r.assumptions.join(' ')).toContain('in date order');
  });

  it('deducts both components from the two-and-over subsidy by default, which under-claims', () => {
    /*
      Item 56. The child is attested and two-and-over, so every hour is either 20 Hours or
      Plus 10 and the subsidy figure is zero under `deduct-both`.

      Under `deduct-twenty-only` the Plus 10 hours appear in the subsidy figure AS WELL as in
      the Plus 10 figure — Thursday's 4 and Friday's 6.
    */
    const child = fullWeek();
    const dobs = new Map([['attested', OLDER]]);

    const both = rs7DayCounts({ children: [child], datesOfBirth: dobs, period });
    expect(both.plusTenTreatment).toBe('deduct-both');
    expect(both.days.map((d) => d.subsidyFundedChildTwoAndOver)).toEqual([0, 0, 0, 0, 0]);

    const twentyOnly = rs7DayCounts({
      children: [child],
      datesOfBirth: dobs,
      period,
      plusTenTreatment: 'deduct-twenty-only',
    });
    expect(twentyOnly.days.map((d) => d.subsidyFundedChildTwoAndOver)).toEqual([0, 0, 0, 4, 6]);
    // Ten hours a week for one child — the size of the error item 56 is about.
    expect(
      twentyOnly.days.reduce((s, d) => s + d.subsidyFundedChildTwoAndOver, 0),
    ).toBe(10);
  });

  it('names the weekly cap when a week loses hours to it', () => {
    /*
      Six days of 6 hours is 36, and the weekly cap is 30. The Handbook says the maximum and
      never says which days lose the excess — `funding.ts` refuses to answer. Here the later
      days lose it, and the return says so rather than presenting a figure as derived.
    */
    const child = fund(
      'busy',
      ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'].flatMap(
        (d) => day(d, 6),
      ),
      { dateOfBirth: OLDER },
    );
    const r = rs7DayCounts({
      children: [child],
      datesOfBirth: new Map([['busy', OLDER]]),
      period,
    });

    // Mon–Fri take the 30; Saturday gets nothing.
    expect(r.days.map((d) => d.subsidyFundedChildTwoAndOver)).toEqual([6, 6, 6, 6, 6, 0]);
    expect(r.assumptions.join(' ')).toContain('weekly cap');
  });
});

describe('rs7DayCounts — §6-4, the one rule that changes a figure here', () => {
  it('removes the overlap from the replacement child, largest claim first', () => {
    /*
      One date. A permanent child's absence is claimed for 6 hours; two casual children
      attended, 5 hours and 3 hours. §6-4 forbids claiming for both the absent child and the
      one who filled their place, and §7-7 says the replacement's hours are the ones dropped.

      An overlap of 5 hours, taken largest-first:
        casual-big   5 → 0
        casual-small 3 → 3   (untouched, the overlap is exhausted)

      Two-and-over total: the permanent child's 6 (an absence is not modelled here, so this
      fixture uses attendance) plus 3 = 9.
    */
    const permanent = fund('perm', day('2026-08-03', 6), { dateOfBirth: OLDER });
    const big = fund('casual-big', day('2026-08-03', 5), {
      dateOfBirth: OLDER,
      enrolmentType: 'casual',
    });
    const small = fund('casual-small', day('2026-08-03', 3), {
      dateOfBirth: OLDER,
      enrolmentType: 'casual',
    });

    const r = rs7DayCounts({
      children: [permanent, big, small],
      datesOfBirth: new Map([
        ['perm', OLDER],
        ['casual-big', OLDER],
        ['casual-small', OLDER],
      ]),
      period,
      sixFourOverlapHours: new Map([['2026-08-03', 5]]),
    });

    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(9);
    expect(r.assumptions.join(' ')).toContain('largest claim was reduced first');
  });

  it('leaves the figure alone when no replacement child attended that date', () => {
    // §6-4 needs a casual or conditional child to have filled the place. Deducting without one
    // would remove hours from a permanently enrolled child, which is the opposite of §7-7.
    const permanent = fund('perm', day('2026-08-03', 6), { dateOfBirth: OLDER });
    const r = rs7DayCounts({
      children: [permanent],
      datesOfBirth: new Map([['perm', OLDER]]),
      period,
      sixFourOverlapHours: new Map([['2026-08-03', 5]]),
    });
    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(6);
    expect(r.assumptions.join(' ')).not.toContain('largest claim');
  });
});

describe('rs7DayCounts — what it refuses to produce', () => {
  it('leaves both staff figures NULL, never zero, when none were supplied', () => {
    // A service reporting zero staff hours would be making a different and false statement —
    // and a centre recording adult numbers as a typed total has none to supply.
    const r = rs7DayCounts({
      children: [fund('a', day('2026-08-03', 5), { dateOfBirth: OLDER })],
      datesOfBirth: new Map([['a', OLDER]]),
      period,
    });
    expect(r.days[0]?.staffHourQualified).toBeNull();
    expect(r.days[0]?.staffHourNotQualified).toBeNull();
    expect(r.assumptions.join(' ')).toContain('§9-4');
  });

  it('places supplied staff hours, rounded to the nearest hour as §9-4 directs', () => {
    /*
      §9-4's own example: "68 hours and 30 minutes would be rounded to 69 hours whereas 68
      hours and 29 minutes would be rounded to 68 hours." Both, asserted directly.

      `unknownMinutes` is in neither figure — those are the hours of somebody with no
      practising certificate on file, and folding them into the not-qualified figure would turn
      a paperwork fact into a claim about a teacher.
    */
    const r = rs7DayCounts({
      children: [fund('a', day('2026-08-03', 5), { dateOfBirth: OLDER })],
      datesOfBirth: new Map([['a', OLDER]]),
      period,
      staffHours: [
        {
          date: '2026-08-03',
          qualifiedMinutes: 68 * 60 + 30,
          notQualifiedMinutes: 68 * 60 + 29,
          unknownMinutes: 480,
          unresolvedMinutes: 0,
        },
      ],
      staffHourGaps: ['1 person has no practising certificate on file'],
    });

    expect(r.days[0]?.staffHourQualified).toBe(69);
    expect(r.days[0]?.staffHourNotQualified).toBe(68);
    expect(r.assumptions.join(' ')).toContain('no practising certificate');
    expect(r.assumptions.join(' ')).not.toContain('Staff hours are not produced');
  });

  it('keeps a date where staff worked and no child attended', () => {
    // §9-4's figures do not depend on a child being there. Taking the dates from the children
    // alone would drop a day an educator was on site with an empty roll.
    const r = rs7DayCounts({
      children: [],
      datesOfBirth: new Map(),
      period,
      staffHours: [
        {
          date: '2026-08-04',
          qualifiedMinutes: 300,
          notQualifiedMinutes: 0,
          unknownMinutes: 0,
          unresolvedMinutes: 0,
        },
      ],
    });
    expect(r.days.map((d) => d.date)).toEqual(['2026-08-04']);
    expect(r.days[0]?.staffHourQualified).toBe(5);
    expect(r.days[0]?.subsidyFundedChildUnderTwo).toBe(0);
  });

  it('says nothing at all when there is no attendance', () => {
    const r = rs7DayCounts({ children: [], datesOfBirth: new Map(), period });
    expect(r.days).toEqual([]);
    expect(r.outOfRangeDates).toEqual([]);
  });
});

describe('rs7DayCounts — the three boundaries the mutation drill found unasserted', () => {
  it('treats a child ON their second birthday as two-and-over', () => {
    /*
      Born 3 August 2024, so exactly 24 months old on 3 August 2026. `ageInMonths(...) < 24` is
      false, and the child belongs in the two-and-over figure from that day.

      `<=` would move them into the under-two figure — a subsidy figure at a different rate, on
      the child's birthday, for one day. Nothing else in the suite could see the difference.
    */
    const TURNS_TWO = '2024-08-03';
    const r = rs7DayCounts({
      children: [fund('birthday', day('2026-08-03', 5), { dateOfBirth: TURNS_TWO })],
      datesOfBirth: new Map([['birthday', TURNS_TWO]]),
      period,
    });
    expect(r.days[0]?.subsidyFundedChildUnderTwo).toBe(0);
    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(5);

    // And the day before, they were still under two.
    const before = rs7DayCounts({
      children: [fund('birthday', day('2026-08-02', 5), { dateOfBirth: TURNS_TWO })],
      datesOfBirth: new Map([['birthday', TURNS_TWO]]),
      period,
    });
    expect(before.days[0]?.subsidyFundedChildUnderTwo).toBe(5);
    expect(before.days[0]?.subsidyFundedChildTwoAndOver).toBe(0);
  });

  it('reduces the largest replacement claim first, which only shows when the buckets differ', () => {
    /*
      WHY THE FIRST §6-4 TEST COULD NOT SEE THIS, and it is worth knowing.

      With both replacement children in the same bucket the tie-break is invisible at the
      aggregate: five hours come out of the two-and-over total whichever child loses them. The
      order only changes an ANSWER when the candidates sit in different buckets.

      So: an under-two casual child at 5 hours and a two-and-over casual child at 3, with a
      five-hour overlap and a permanent two-and-over child at 6.

        largest first (correct): the under-two child loses all 5
          under two    0
          two and over 6 + 3 = 9
        smallest first:          the 3-hour child loses 3, then the under-two child loses 2
          under two    3
          two and over 6 + 0 = 6

      Both remove five hours in total. They are different returns.
    */
    const permanent = fund('perm', day('2026-08-03', 6), { dateOfBirth: OLDER });
    const casualBaby = fund('casual-baby', day('2026-08-03', 5), {
      dateOfBirth: BABY,
      enrolmentType: 'casual',
    });
    const casualOlder = fund('casual-older', day('2026-08-03', 3), {
      dateOfBirth: OLDER,
      enrolmentType: 'casual',
    });

    const r = rs7DayCounts({
      children: [permanent, casualBaby, casualOlder],
      datesOfBirth: new Map([
        ['perm', OLDER],
        ['casual-baby', BABY],
        ['casual-older', OLDER],
      ]),
      period,
      sixFourOverlapHours: new Map([['2026-08-03', 5]]),
    });

    expect(r.days[0]?.subsidyFundedChildUnderTwo).toBe(0);
    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(9);
  });

  it('reports a figure past the schema bound rather than clamping it', () => {
    /*
      `RS7DayCount` is `xs:int` bounded 0..9999. Clamping would send a number the service cannot
      reconcile against its own records, and an overflow is far more likely to be a defect in
      this file than a real day — 1,700 children at six hours is 10,200.

      The fixture replicates one REAL `childFunding` result rather than hand-building 1,700,
      so every field is the shape the product actually produces.
    */
    const base = fund('c0', day('2026-08-03', 6), { dateOfBirth: OLDER });
    const many = Array.from({ length: 1700 }, (_, i) => ({ ...base, childId: `c${i}` }));

    const r = rs7DayCounts({
      children: many,
      datesOfBirth: new Map(many.map((c) => [c.childId, OLDER])),
      period,
    });

    expect(r.days[0]?.subsidyFundedChildTwoAndOver).toBe(10200);
    expect(r.outOfRangeDates).toEqual(['2026-08-03']);
  });
});
