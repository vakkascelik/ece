import { describe, expect, it } from 'vitest';
import {
  childFunding,
  DEFAULT_CAPS,
  exportDisclaimer,
  FUNDING_RULES_VERIFIED,
  ministryFundingPeriods,
  summariseFunding,
  summariseVariance,
  type FundingPeriod,
} from '../funding';
import type { HoursEvent } from '../hours';

const NZ = 'Pacific/Auckland';
const at = (day: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 7, day, hh - 12, mm)).toISOString();

let seq = 0;
const ev = (kind: 'in' | 'out', when: string, corrects: number | null = null): HoursEvent => ({
  id: ++seq,
  kind,
  at: when,
  corrects,
});

/** Mon 3 Aug to Fri 7 Aug 2026 is one ISO week. */
const period: FundingPeriod = { label: 'Test period', from: '2026-08-01', to: '2026-08-31' };

/** A full day, 8am to 4pm — eight hours, above the daily cap. */
const fullDay = (day: number) => [ev('in', at(day, 8)), ev('out', at(day, 16))];

describe('these test the arithmetic, not the policy', () => {
  it('carries the unverified flag to the caller', () => {
    // A green suite means the caps are APPLIED correctly, not that policy has been read. The flag
    // is the only thing that speaks to the second, and it must reach the caller unchanged.
    const summary = summariseFunding(period, []);
    expect(summary.verified).toBe(FUNDING_RULES_VERIFIED);
  });

  it('states where the caps came from, in the string the export prints', () => {
    // This used to assert the basis contained "NOT verified". The caps were confirmed against the
    // Ministry's own business rules on 2026-08-18, so that assertion was pinning a disclaimer that
    // had become untrue. What has to hold now is that the basis names a source and the age band —
    // an empty or vague basis on an official-looking figure is the failure this string prevents.
    expect(DEFAULT_CAPS.basis).toMatch(/Ministry/);
    expect(DEFAULT_CAPS.basis).toMatch(/3 or older and under 6/);
  });
});

describe('the daily cap', () => {
  it('caps a long day for a 20 Hours ECE child', () => {
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: true,
    });
    expect(r.attendedHours).toBe(8);
    expect(r.fundedHours).toBe(DEFAULT_CAPS.maxHoursPerDay);
    expect(r.cappedDates).toEqual(['2026-08-03']);
  });

  it('does not cap a child without the attestation', () => {
    // There is nothing to cap without the entitlement, and pretending otherwise would understate an
    // ordinary fee-paying enrolment.
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
    });
    expect(r.fundedHours).toBe(8);
    expect(r.cappedDates).toEqual([]);
  });

  it('leaves a short day alone', () => {
    const r = childFunding({
      childId: 'c',
      events: [ev('in', at(3, 9)), ev('out', at(3, 13))],
      timeZone: NZ,
      period,
      twentyHoursEce: true,
    });
    expect(r.fundedHours).toBe(4);
    expect(r.cappedDates).toEqual([]);
  });
});

describe('the weekly cap, applied AFTER the daily one', () => {
  it('caps a full week at the weekly maximum', () => {
    // Five eight-hour days: 40 attended, 30 after the daily cap, 20 after the weekly one.
    const events = [3, 4, 5, 6, 7].flatMap((d) => fullDay(d));
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.attendedHours).toBe(40);
    expect(r.fundedHours).toBe(DEFAULT_CAPS.maxHoursPerWeek);
  });

  it('does not let a long Monday absorb capacity Tuesday was entitled to', () => {
    // THE ORDERING TEST. Monday 8h, Tuesday 4h.
    //   Daily cap first:  min(8,6) + min(4,6) = 10, then weekly min(10,20) = 10.
    //   Weekly cap first: min(12,20) = 12 — which claims two hours nobody was entitled to,
    //                     because Monday's excess is not transferable.
    const events = [...fullDay(3), ev('in', at(4, 9)), ev('out', at(4, 13))];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.attendedHours).toBe(12);
    expect(r.fundedHours).toBe(10);
  });

  it('applies the weekly cap per ISO week, not per seven days from the start', () => {
    // Mon 3 – Fri 7 is one week; Mon 10 – Tue 11 is the next. Each gets its own 20-hour allowance,
    // so a fortnight is not capped at 20.
    const events = [...[3, 4, 5, 6, 7].flatMap(fullDay), ...[10, 11].flatMap(fullDay)];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    // Week one caps at 20; week two is 2 × 6 = 12, under the cap.
    expect(r.fundedHours).toBe(32);
  });

  it('does not cap weekly for a child without the attestation', () => {
    const events = [3, 4, 5, 6, 7].flatMap((d) => fullDay(d));
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: false });
    expect(r.fundedHours).toBe(40);
  });
});

describe('a broken record is excluded, not estimated', () => {
  it('excludes an unresolved day and names it', () => {
    const events = [...fullDay(3), ev('in', at(4, 8))]; // Tuesday never signed out
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.fundedHours).toBe(6); // Monday only, capped
    expect(r.unresolvedDates).toEqual(['2026-08-04']);
    expect(r.unresolvedHours).toBe(0); // no closed session on that day
  });

  it('reports what an unresolved day is worth so far', () => {
    const events = [ev('in', at(3, 8)), ev('out', at(3, 11)), ev('in', at(3, 12))];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.fundedHours).toBe(0);
    expect(r.unresolvedHours).toBe(3);
  });

  it('never funds more than was attended', () => {
    // The invariant that matters. Whatever the caps do, the claim cannot exceed the record.
    for (const twentyHoursEce of [true, false]) {
      const events = [3, 4, 5].flatMap(fullDay);
      const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce });
      expect(r.fundedHours).toBeLessThanOrEqual(r.attendedHours);
    }
  });
});

describe('the period boundary', () => {
  it('ignores days outside the period', () => {
    const narrow: FundingPeriod = { label: 'Aug 3–4', from: '2026-08-03', to: '2026-08-04' };
    const events = [...fullDay(3), ...fullDay(4), ...fullDay(5)];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period: narrow, twentyHoursEce: true });
    expect(r.fundedHours).toBe(12); // two capped days, the 5th excluded
  });

  it('includes both boundary dates', () => {
    const oneDay: FundingPeriod = { label: 'Aug 3', from: '2026-08-03', to: '2026-08-03' };
    const r = childFunding({ childId: 'c', events: fullDay(3), timeZone: NZ, period: oneDay, twentyHoursEce: false });
    expect(r.fundedHours).toBe(8);
  });
});

describe('a period the records do not cover — the silence that reads as zero', () => {
  /*
    The defect this exists for, stated as a test rather than as a comment: a child with NO
    attendance rows in the period yields an empty `inPeriod`, so `complete` and `unresolved` are
    both empty, `unresolvedChildCount` is 0 and `complete` is TRUE. Correct arithmetic on the rows
    that exist, and a false picture of the period.
  */
  it('reports a period with no records at all as complete — which is why the flag is needed', () => {
    const summary = summariseFunding(period, []);
    expect(summary.complete).toBe(true);
    expect(summary.totalFundedHours).toBe(0);
    // Nobody said whether the record covers this, so nothing is claimed either way.
    expect(summary.periodPrecedesRecord).toBeNull();
  });

  it('flags a period that begins before the record does', () => {
    const summary = summariseFunding(period, [], { startsOn: '2026-08-15' });
    expect(summary.periodPrecedesRecord).toBe(true);
    expect(summary.recordStartsOn).toBe('2026-08-15');
    // `complete` is deliberately untouched — a different kind of problem, the argument
    // `ineligibleChildCount` already makes for itself.
    expect(summary.complete).toBe(true);
  });

  it('does not flag a record that starts on the first day of the period', () => {
    // The boundary. Starting ON the first day covers it; the comparison is `>`, not `>=`.
    const summary = summariseFunding(period, [], { startsOn: period.from });
    expect(summary.periodPrecedesRecord).toBe(false);
  });

  it('does not flag a record that starts before the period', () => {
    const summary = summariseFunding(period, [], { startsOn: '2026-07-01' });
    expect(summary.periodPrecedesRecord).toBe(false);
  });

  it('treats a centre with no attendance events at all as the worst case, not the unknown one', () => {
    // `{ startsOn: null }` is a much stronger statement than omitting the argument: somebody
    // looked and there is nothing. Every period precedes a record that does not exist.
    const summary = summariseFunding(period, [], { startsOn: null });
    expect(summary.periodPrecedesRecord).toBe(true);
    expect(summary.recordStartsOn).toBeNull();
  });

  it('keeps null and false apart, because they render differently', () => {
    // The `overdue: null` contract. If these ever collapse to one value the banner stops being
    // able to say "not checked" and starts saying "covered".
    expect(summariseFunding(period, []).periodPrecedesRecord).toBeNull();
    expect(summariseFunding(period, [], { startsOn: '2026-07-01' }).periodPrecedesRecord).toBe(false);
  });

  it('leads the disclaimer with the gap, ahead of the unresolved-days sentence', () => {
    /*
      Order is asserted, not incidental. An unresolved day announces itself in the total; a period
      the records do not cover produces a total that looks finished and is simply too small. In a
      paragraph somebody skims before keying a number into a Ministry system, the invisible
      problem goes first.
    */
    const bad = childFunding({ childId: 'b', events: [ev('in', at(3, 8))], timeZone: NZ, period, twentyHoursEce: false });
    const text = exportDisclaimer(summariseFunding(period, [bad], { startsOn: '2026-08-15' }));
    expect(text).toContain('does not begin until 2026-08-15');
    expect(text).toContain('lower than what was actually attended');
    expect(text.indexOf('does not begin until')).toBeLessThan(text.indexOf('could not be calculated'));
  });

  it('says something different when there is no record at all', () => {
    const text = exportDisclaimer(summariseFunding(period, [], { startsOn: null }));
    expect(text).toContain('no attendance records at all');
    expect(text).toContain('not because nobody attended');
  });

  it('says nothing about coverage when nobody checked', () => {
    // Silence on an unknown is wrong in the UI, which renders it; it is right in a sentence that
    // would otherwise assert something nobody established.
    const text = exportDisclaimer(summariseFunding(period, []));
    expect(text).not.toContain('does not begin until');
    expect(text).not.toContain('no attendance records at all');
  });
});

describe('summariseFunding and the disclaimer', () => {
  it('is not complete while any child has an unresolved day', () => {
    const good = childFunding({ childId: 'a', events: fullDay(3), timeZone: NZ, period, twentyHoursEce: false });
    const bad = childFunding({ childId: 'b', events: [ev('in', at(3, 8))], timeZone: NZ, period, twentyHoursEce: false });
    const summary = summariseFunding(period, [good, bad]);
    expect(summary.complete).toBe(false);
    expect(summary.unresolvedChildCount).toBe(1);
    expect(summary.totalFundedHours).toBe(8);
  });

  it('is complete when every record is', () => {
    const summary = summariseFunding(period, [
      childFunding({ childId: 'a', events: fullDay(3), timeZone: NZ, period, twentyHoursEce: false }),
    ]);
    expect(summary.complete).toBe(true);
    expect(summary.unresolvedChildCount).toBe(0);
  });

  it('says nothing has been submitted, always', () => {
    // The sentence that stops somebody believing a return was filed because a screen looked done.
    const summary = summariseFunding(period, []);
    const text = exportDisclaimer(summary);
    expect(text).toContain('Nothing has been submitted');
    expect(text).toContain('cannot submit');
    expect(text).not.toMatch(/\bsubmitted to the Ministry successfully\b/);
  });

  it('names the incomplete records in the disclaimer', () => {
    const bad = childFunding({ childId: 'b', events: [ev('in', at(3, 8))], timeZone: NZ, period, twentyHoursEce: false });
    const text = exportDisclaimer(summariseFunding(period, [bad]));
    expect(text).toContain('1 child has');
    expect(text).toContain('excluded from the totals');
    expect(text).toContain('re-run');
  });

  it('names absence funding as the gap while the flag is false', () => {
    /*
      This asserted the disclaimer said the caps had "not been checked against the ECE Funding
      Handbook". The caps were checked on 2026-08-18 and found correct, so that sentence was on its
      way to being the same false caveat the ratio banner had just been rid of — a disclaimer that
      states something untrue teaches people to skip the disclaimers.

      What the flag actually covers now is narrower and worth stating in words a manager can act on:
      the export counts attended hours only, and sections 6-4 to 6-7 allow a claim for a permanently
      enrolled child who was booked and absent. "You may be entitled to more than this" is
      actionable. "Something is unverified" is not.
    */
    const text = exportDisclaimer(summariseFunding(period, []));
    expect(text).toContain('attended hours only');
    expect(text).toContain('booked but absent');
    // And it must not overstate the direction of the error: this under-claims, never over-claims.
    expect(text).toContain('lower than what you are entitled to claim');
  });
});

describe('summariseVariance', () => {
  const receipts = [
    { id: 'a', periodLabel: 'Feb-Mar', periodFrom: '2026-02-01', periodTo: '2026-03-31', claimedCents: 1_200_000, receivedCents: 1_150_000, receivedOn: '2026-04-10' },
    { id: 'b', periodLabel: 'Apr-May', periodFrom: '2026-04-01', periodTo: '2026-05-31', claimedCents: 900_000, receivedCents: 950_000, receivedOn: '2026-06-10' },
    { id: 'c', periodLabel: 'Jun-Jul', periodFrom: '2026-06-01', periodTo: '2026-07-31', claimedCents: null, receivedCents: 800_000, receivedOn: '2026-08-10' },
  ];

  it('reports a shortfall and an overpayment separately', () => {
    const v = summariseVariance(receipts);
    // Netting them would hide a $500 under-claim behind a $500 overpayment, and they
    // are two different phone calls.
    expect(v.shortfallCents).toBe(50_000);
    expect(v.overpaidCents).toBe(50_000);
  });

  it('does NOT treat an unstated claim as a claim of zero', () => {
    const v = summariseVariance(receipts);
    // Zero would make every unstated period look like a total overpayment and bury the
    // real ones.
    expect(v.rows.find((r) => r.id === 'c')?.varianceCents).toBeNull();
    expect(v.unstated).toBe(1);
    expect(v.overpaidCents).toBe(50_000);
  });

  it('puts the worst shortfall first and the unstated periods last', () => {
    expect(summariseVariance(receipts).rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is empty rather than wrong with nothing recorded', () => {
    const v = summariseVariance([]);
    expect(v.rows).toEqual([]);
    expect(v.shortfallCents).toBe(0);
    expect(v.unstated).toBe(0);
  });
});

describe('the 20 Hours age band', () => {
  // "3 years or older but less than 6 years old" — a Ministry business rule it checks
  // automatically. The tick box on the enrolment is the centre's claim; this is the check on it.
  const attested = (dateOfBirth: string | null, days: number[]) =>
    childFunding({
      childId: 'c',
      events: days.flatMap((d) => fullDay(d)),
      timeZone: NZ,
      period,
      twentyHoursEce: true,
      dateOfBirth,
    });

  it('flags a child who is too young, and still counts the hours', () => {
    const r = attested('2024-08-05', [3]);
    expect(r.ineligibleDates).toEqual(['2026-08-03']);
    // The hours are not in doubt — only the entitlement is. Dropping them would be the estimating
    // this whole file refuses to do.
    expect(r.attendedHours).toBe(8);
    expect(r.fundedHours).toBe(6);
  });

  it('flags only the days BEFORE a third birthday that falls mid-period', () => {
    // Turns 3 on Wednesday 5 August. Monday and Tuesday are outside the entitlement; Wednesday
    // onward is inside it. Using today's age instead would wrongly clear all five.
    const r = attested('2023-08-05', [3, 4, 5, 6, 7]);
    expect(r.ineligibleDates).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('treats the third birthday itself as eligible and the sixth as not', () => {
    // Both boundaries pinned, because "3 or older" and "less than 6" are inclusive at one end and
    // exclusive at the other, and a mutation at either end has to fail something.
    expect(attested('2023-08-05', [5]).ineligibleDates).toEqual([]);
    expect(attested('2020-08-05', [4]).ineligibleDates).toEqual([]);
    expect(attested('2020-08-05', [5]).ineligibleDates).toEqual(['2026-08-05']);
  });

  it('flags nothing when the date of birth is unknown, which is not the same as eligible', () => {
    expect(attested(null, [3]).ineligibleDates).toEqual([]);
  });

  it('flags nothing for a child who is not attested, whatever their age', () => {
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      dateOfBirth: '2024-08-05',
    });
    expect(r.ineligibleDates).toEqual([]);
    // And no cap applied either — there is no entitlement to cap.
    expect(r.fundedHours).toBe(8);
  });

  it('counts the children in the summary and says so in the disclaimer', () => {
    const summary = summariseFunding(period, [attested('2024-08-05', [3]), attested('2023-08-05', [5])]);
    expect(summary.ineligibleChildCount).toBe(1);
    // Separate from `complete`: the record is calculable, the entitlement is what is in doubt.
    expect(summary.complete).toBe(true);
    expect(exportDisclaimer(summary)).toContain('under 3 or 6 and over');
  });
});

describe('the Ministry funding periods', () => {
  it('gives the three four-monthly periods, with October straddling the new year', () => {
    const p = ministryFundingPeriods(2026);
    expect(p.map((x) => [x.from, x.to])).toEqual([
      ['2026-02-01', '2026-05-31'],
      ['2026-06-01', '2026-09-30'],
      ['2026-10-01', '2027-01-31'],
    ]);
  });

  it('leaves no gap and no overlap between consecutive years', () => {
    // The October period ends 31 January and the next February period starts the next day. A gap
    // here would silently drop a month of hours out of every claim made from these dates.
    const y2026 = ministryFundingPeriods(2026);
    const y2027 = ministryFundingPeriods(2027);
    expect(y2026[2]!.to).toBe('2027-01-31');
    expect(y2027[0]!.from).toBe('2027-02-01');
  });
});
