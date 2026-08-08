import { describe, expect, it } from 'vitest';
import {
  childFunding,
  DEFAULT_CAPS,
  exportDisclaimer,
  FUNDING_RULES_VERIFIED,
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
    // The caps are a good-faith reading of the Funding Handbook that nobody has checked. A green
    // suite means they are applied correctly, not that they are right.
    const summary = summariseFunding(period, []);
    expect(summary.verified).toBe(FUNDING_RULES_VERIFIED);
    expect(summary.capsBasis).toContain('NOT verified');
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

  it('warns that the caps are unchecked while the flag is false', () => {
    const text = exportDisclaimer(summariseFunding(period, []));
    expect(text).toContain('not been checked against the ECE Funding Handbook');
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
