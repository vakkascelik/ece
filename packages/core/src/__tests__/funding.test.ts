import { describe, expect, it } from 'vitest';
import {
  childFunding,
  DEFAULT_CAPS,
  exportDisclaimer,
  FUNDING_RULES,
  FUNDING_RULES_VERIFIED,
  ministryFundingPeriods,
  placeCapExceedances,
  summariseFunding,
  summariseVariance,
  type FundingPeriod,
} from '../funding';
import type { HoursEvent } from '../hours';
import { enrolledSessions } from '../absence';

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

  it('the roll-up flag is derived from the named rules, not asserted beside them', () => {
    /*
      `FUNDING_RULES_VERIFIED` was a hand-maintained `false` until 2026-09-04. One boolean had to
      stand for "the caps are confirmed" AND "absence funding does not exist", which are different
      statements, and a reader could take it either way — the same defect `ratios.ts` had a day
      earlier with one flag covering one of four ratio schedules.

      It is now `Object.values(FUNDING_RULES).every(r => r.verified)`. This test asserts that it is
      genuinely a roll-up: false BECAUSE named rules are false. Hard-code it back to `false` and the
      first assertion still passes, so the third is the one that matters — it fails the moment the
      roll-up and the detail can disagree.
    */
    const unverified = Object.entries(FUNDING_RULES)
      .filter(([, rule]) => !rule.verified)
      .map(([name]) => name);

    expect(FUNDING_RULES_VERIFIED).toBe(false);
    expect(unverified.length).toBeGreaterThan(0);
    expect(FUNDING_RULES_VERIFIED).toBe(Object.values(FUNDING_RULES).every((r) => r.verified));

    // Every rule names where to go and re-read it. A flag with no source is a flag nobody can
    // ever responsibly flip, which is how RATIO_TABLES_VERIFIED sat unexamined for weeks.
    for (const [name, rule] of Object.entries(FUNDING_RULES)) {
      expect(rule.source, name).toMatch(/§|Handbook|XSD|business rules|Specification/);
      expect(rule.source.length, name).toBeGreaterThan(40);
    }
  });

  it('the disclaimer no longer warns about things that have been fixed', () => {
    /*
      This test asserted the OPPOSITE this morning, and the change is the point.

      On 2026-09-04 the disclaimer gained a sentence saying the figure could run HIGH for a child
      with no 20 Hours attestation, because the caps were gated on the attestation. Later the same
      day the caps were fixed — 6 a day and 30 a week for every child — so that sentence became
      false, and a false caveat is what `ratios.ts` and `DEFAULT_CAPS.basis` have each had to have
      removed already. It teaches people to skip the disclaimers.

      Same for Plus 10: it said the remaining entitlement was not computed, and now `plusTenHours`
      is on every child.

      What must still be there is absence funding, which is genuinely missing — asserted below.
      So this test pins the ABSENCE of two warnings, which is the only way to stop a stale caveat
      quietly surviving its own fix.
    */
    const text = exportDisclaimer(summariseFunding(period, []));
    expect(text).not.toContain('runs the other way');
    expect(text).not.toContain('higher than what you can claim');
    expect(text).not.toContain('"Plus 10" — is not computed');
  });

  it('reports the basis of the caps it was given, not the default basis', () => {
    /*
      The regression test for a bug that never fired, written because it never fired.

      `summariseFunding` used to end with `capsBasis: (children[0] ? DEFAULT_CAPS :
      DEFAULT_CAPS).basis` — a ternary whose branches are identical. Every existing caller passes
      no caps, so the output was correct and the whole suite stayed green; `childFunding` however
      accepts a `caps` override, and the first caller to use it would have got a summary
      describing DEFAULT_CAPS while the figures underneath were computed from something else.

      `capsBasis` is rendered directly beneath the funded total on `/funding`, which is a figure
      somebody keys into ELI Web. A false provenance there is worse than no provenance.

      Fixed 2026-09-03 by giving `summariseFunding` the caps it is describing. This assertion is
      the only thing standing between that and the dead ternary coming back: revert the fix and
      it fails, which is more than the other 40 tests in this file can say about it.
    */
    const custom = {
      maxHoursPerDay: 4,
      maxHoursPerWeek: 12,
      twentyHoursWeeklyCap: 8,
      basis: 'A variation on the licence.',
    };
    expect(summariseFunding(period, [], undefined, custom).capsBasis).toBe(custom.basis);
    // And omitting them still describes the default, because that is then the truth.
    expect(summariseFunding(period, []).capsBasis).toBe(DEFAULT_CAPS.basis);
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

  it('caps a child WITHOUT the attestation too — the subsidy does not depend on it', () => {
    /*
      This expectation was 8 until 2026-09-04, on the reasoning that "there is nothing to cap
      without the entitlement". That conflated 20 Hours ECE with the ECE Funding Subsidy, which an
      ordinary fee-paying enrolment also attracts: §9-2, *"a maximum of 6 hours can be claimed each
      day for each licensed child-place"*.

      So an eight-hour day yields SIX, and the two hours it used to yield were an over-statement of
      what the service could claim — the one direction this file promises never to move in.

      `twentyHoursHours` and `plusTenHours` are both zero: an unattested child has no 20 Hours
      component, and the whole of their figure is subsidy.
    */
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
    });
    expect(r.attendedHours).toBe(8);
    expect(r.fundedHours).toBe(6);
    expect(r.cappedDates).toEqual(['2026-08-03']);
    expect(r.twentyHoursHours).toBe(0);
    expect(r.plusTenHours).toBe(0);
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
  it('caps a full week at the weekly maximum, and splits it into the two components', () => {
    /*
      Five eight-hour days. 40 attended; 30 after the daily cap of 6; and 30 after the weekly cap,
      which is **30** and not 20 — 20 is the cap on the 20 Hours ECE component inside it.

      Before 2026-09-04 this expected 20, discarding the ten hours §9-3 calls Plus 10: "The
      remainder (up to 30 hours) may be claimed as Plus 10 ECE hours."
    */
    const events = [3, 4, 5, 6, 7].flatMap((d) => fullDay(d));
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.attendedHours).toBe(40);
    expect(r.fundedHours).toBe(30);
    expect(r.fundedHours).toBe(DEFAULT_CAPS.maxHoursPerWeek);
    // 20 as 20 Hours ECE, the remaining 10 as Plus 10 — and they must sum to the total.
    expect(r.twentyHoursHours).toBe(20);
    expect(r.plusTenHours).toBe(10);
    expect(r.twentyHoursHours + r.plusTenHours).toBe(r.fundedHours);
  });

  it('a short week is all 20 Hours ECE and no Plus 10', () => {
    // Two six-hour days: 12 funded, under the 20-hour component cap, so nothing spills into
    // Plus 10. The boundary in the other direction from the test above.
    const events = [
      ev('in', at(3, 9)),
      ev('out', at(3, 15)),
      ev('in', at(4, 9)),
      ev('out', at(4, 15)),
    ];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.fundedHours).toBe(12);
    expect(r.twentyHoursHours).toBe(12);
    expect(r.plusTenHours).toBe(0);
  });

  it('does not let a long Monday absorb capacity Tuesday was entitled to', () => {
    // THE ORDERING TEST. Monday 8h, Tuesday 4h.
    //   Daily cap first:  min(8,6) + min(4,6) = 10, then weekly min(10,30) = 10.
    //   Weekly cap first: min(12,30) = 12 — which claims two hours nobody was entitled to,
    //                     because Monday's excess is not transferable.
    const events = [...fullDay(3), ev('in', at(4, 9)), ev('out', at(4, 13))];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    expect(r.attendedHours).toBe(12);
    expect(r.fundedHours).toBe(10);
  });

  it('applies the weekly cap per ISO week, not per seven days from the start', () => {
    // Mon 3 – Fri 7 is one week; Mon 10 – Tue 11 is the next. Each gets its own 30-hour
    // allowance, so a fortnight is not capped at 30.
    const events = [...[3, 4, 5, 6, 7].flatMap(fullDay), ...[10, 11].flatMap(fullDay)];
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: true });
    // Week one: 5 × 6 = 30, exactly at the cap. Week two: 2 × 6 = 12, under it. Expected 32 until
    // 2026-09-04, when the weekly cap went from 20 to 30.
    expect(r.fundedHours).toBe(42);
    // And the component split is per week, so week two's 12 hours are all inside ITS own 20-hour
    // allowance — 20 + 12 as 20 Hours ECE, and only week one's 10 spill into Plus 10.
    expect(r.twentyHoursHours).toBe(32);
    expect(r.plusTenHours).toBe(10);
  });

  it('caps weekly for a child without the attestation too', () => {
    /*
      Expected 40 until 2026-09-04 — every attended hour, uncapped. §9-2 caps the subsidy at 6 a
      day and 30 a week for every child, so five eight-hour days give 30, not 40. Ten hours of
      over-statement in one week for one child, on a figure keyed into ELI Web.
    */
    const events = [3, 4, 5, 6, 7].flatMap((d) => fullDay(d));
    const r = childFunding({ childId: 'c', events, timeZone: NZ, period, twentyHoursEce: false });
    expect(r.attendedHours).toBe(40);
    expect(r.fundedHours).toBe(30);
    expect(r.twentyHoursHours).toBe(0);
    expect(r.plusTenHours).toBe(0);
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
    // 6, not the 8 attended: the subsidy daily cap applies to every child as of 2026-09-04. This
    // test is about the period boundary and not about the cap, so it asserts `attendedHours` too —
    // otherwise a future cap change looks like a boundary regression.
    expect(r.attendedHours).toBe(8);
    expect(r.fundedHours).toBe(6);
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
    // 6 from the one complete eight-hour day, since 2026-09-04 — the daily subsidy cap now applies
    // to an unattested child. What this test is about is that the incomplete child contributes
    // nothing and does not make the total look finished.
    expect(summary.totalFundedHours).toBe(6);
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

  it('says the obligations stay with the service, whatever else is true', () => {
    /*
      The Ministry asked for this sentence by name on 2026-08-31, in the same reply that
      confirmed a service may keep its Chapter 6 records outside an approved SMS: vendors must
      be clear that use of their system "does not remove the service's responsibility to comply
      with Ministry funding, record-keeping, and reporting requirements", and that the service
      "remains responsible for reviewing, validating, and submitting" what it produces.

      WHAT THIS TEST IS ACTUALLY GUARDING, WHICH IS NOT THE WORDING. Every other sentence in
      `exportDisclaimer` is conditional, so the obvious way to add one more is behind a flag —
      and the obvious flag is `verified`. That wiring would remove the statement on the day the
      absence rules land and every figure is trustworthy, which is precisely the day a manager
      keys the numbers in without reading. So the assertion is made three times over: on a
      clean summary, on a broken one, and on one with every flag forced green.
    */
    const clean = summariseFunding(period, [
      childFunding({ childId: 'a', events: fullDay(3), timeZone: NZ, period, twentyHoursEce: false }),
    ]);
    const broken = summariseFunding(period, [
      childFunding({ childId: 'b', events: [ev('in', at(3, 8))], timeZone: NZ, period, twentyHoursEce: false }),
    ]);
    // Not reachable through summariseFunding while FUNDING_RULES_VERIFIED is false, which is why
    // it is built by hand: the point is the future in which it IS reachable.
    const allGreen = { ...clean, verified: true, complete: true, periodPrecedesRecord: false as const };

    for (const summary of [clean, broken, allGreen]) {
      const text = exportDisclaimer(summary);
      expect(text).toContain('does not move any of your obligations to the Ministry');
      expect(text).toContain('reviewing and validating');
      // Both directions, because the Ministry named both and this product only under-claims.
      expect(text).toContain('over- or under-claim');
    }
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
    /*
      ~~And no cap applied either — there is no entitlement to cap.~~

      The age band is still not flagged, which is what this test is for: a two-year-old with no
      attestation is not "outside the 20 Hours band", they are simply not claiming it, and flagging
      them would put a warning on every under-three in the centre.

      But the CAP does apply now, from 2026-09-04. The eight-hour day yields six, because the ECE
      Funding Subsidy caps at six a day whether or not a child is attested — §9-2. The old comment
      conflated the entitlement with the subsidy, which is unverified-claims item 54.
    */
    expect(r.fundedHours).toBe(6);
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

describe('the licensed-place cap — the cap is on a place, not a child', () => {
  /*
    Handbook Glossary: a funded child hour is "an occupied child-place that is funded for 1 hour",
    capped at "6 FCHs per child-place per day", and a child-place "may be used by more than 1 child
    during the course of a day".

    `childFunding` applies that per CHILD, which is exact whenever a day's children do not
    outnumber the licensed places and over-states when they do. `placeCapExceedances` is the
    reporting half: it names the days and the amounts and changes no figure.
  */
  const fourHours = (day: number) => [ev('in', at(day, 9)), ev('out', at(day, 13))];
  const childOn = (id: string, days: number[]) =>
    childFunding({
      childId: id,
      events: days.flatMap(fourHours),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
    });

  it('reports null when the licence is not stated, which is not the same as no exceedance', () => {
    /*
      THE ASSERTION MOST LIKELY TO BE BROKEN BY A LATER "TIDY-UP". `null` and `[]` mean different
      things: null is "nobody has told this product how many places it is licensed for", and `[]`
      is "checked, and every day is within the licence".

      `centres.licensed_places` is nullable precisely so a default cannot produce confident figures
      against a number no centre gave — 0050 — and collapsing null to `[]` here would turn "not
      asked" into "no problem found", on a funding figure.
    */
    const children = [childOn('a', [3]), childOn('b', [3])];
    expect(placeCapExceedances({ children, licensedPlaces: null })).toBeNull();
    // And with a licence, the same children yield an array — possibly empty, but never null.
    expect(placeCapExceedances({ children, licensedPlaces: 10 })).toEqual([]);
  });

  it('says nothing when the children fit inside the licence', () => {
    // Two children, four hours each on one day, two licensed places: 8 claimed against 12 allowed.
    const children = [childOn('a', [3]), childOn('b', [3])];
    expect(placeCapExceedances({ children, licensedPlaces: 2 })).toEqual([]);
  });

  it('names the day when children share places and the total exceeds the licence', () => {
    /*
      THE CASE THE WHOLE FUNCTION EXISTS FOR, and it is a sessional service: a morning child and an
      afternoon child sharing ONE licensed place.

      Two children × 4 hours = 8 hours claimed on a place that can yield 6. Per child this product
      claims 4 + 4 = 8, because neither child exceeded the 6-hour daily cap on their own. The
      over-statement is only visible with both children in view.
    */
    const children = [childOn('a', [3]), childOn('b', [3])];
    const out = placeCapExceedances({ children, licensedPlaces: 1 });
    expect(out).toEqual([{ date: '2026-08-03', claimedHours: 8, allowedHours: 6 }]);
  });

  it('checks each day separately and reports them in order', () => {
    // Three children on the 4th, two on the 3rd, one licensed place. Both days exceed, and the
    // amounts differ — a single "the licence is exceeded" flag would lose that.
    const children = [childOn('a', [3, 4]), childOn('b', [3, 4]), childOn('c', [4])];
    const out = placeCapExceedances({ children, licensedPlaces: 1 });
    expect(out).toEqual([
      { date: '2026-08-03', claimedHours: 8, allowedHours: 6 },
      { date: '2026-08-04', claimedHours: 12, allowedHours: 6 },
    ]);
  });

  it('changes no figure — the funded totals are untouched', () => {
    /*
      Deliberate, and the reason is worth pinning rather than leaving to a comment. Trimming the
      excess would need an attribution rule — WHICH child's hours go — that nothing read so far
      supplies, and RS7 needs the surviving hours split by age band and 20 Hours status, so an
      invented trim would propagate into a Crown return. The choice is the service's to make and
      defend.
    */
    const children = [childOn('a', [3]), childOn('b', [3])];
    const summary = summariseFunding(period, children);
    placeCapExceedances({ children, licensedPlaces: 1 });
    expect(summary.totalFundedHours).toBe(8);
    expect(children[0]!.fundedHours).toBe(4);
  });

  it('exposes daily-capped hours per date, and says why that is not funded-hours-per-date', () => {
    /*
      `dailyCappedByDate` is before the WEEKLY cap, and `sum` of it equals `fundedHours` only when
      no week was capped. Asserted in both directions here, because the difference is exactly the
      thing a future reader will want to "fix" by renaming it `fundedByDate`.

      Five eight-hour days: each capped to 6, so the map holds 6 five times = 30, and the weekly cap
      is also 30, so they agree. Six days would not agree, and the Handbook does not say which day
      loses the excess — which is why no such field exists.
    */
    const r = childFunding({
      childId: 'c',
      events: [3, 4, 5, 6, 7].flatMap(fullDay),
      timeZone: NZ,
      period,
      twentyHoursEce: true,
    });
    expect(Object.keys(r.dailyCappedByDate)).toHaveLength(5);
    expect(r.dailyCappedByDate['2026-08-03']).toBe(6);
    const summed = Object.values(r.dailyCappedByDate).reduce((t, h) => t + h, 0);
    expect(summed).toBe(30);
    expect(summed).toBe(r.fundedHours);
  });
});

/**
 * §9-2's TWO SOURCES — added 2026-09-04, and the reason these are here rather than in
 * `absence.test.ts` is that they are about `childFunding`'s choice of source, not about the
 * absence rules themselves.
 *
 * Every assertion above this block still passes untouched, which is the point: no caller that
 * omits an agreement sees any change, and no caller passes one yet.
 */
describe('§9-2: which source produced the funded hours', () => {
  // A Monday/Wednesday child, 9am to 3pm — six hours, exactly the daily cap.
  const monWed = [
    { weekday: 1, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    { weekday: 3, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
  ];

  /** August 2026: the 3rd is a Monday. Sessions for one week of the agreement. */
  const oneWeek = (attended: string[]) =>
    enrolledSessions({
      blocks: monWed,
      from: '2026-08-03',
      to: '2026-08-09',
      attendedDates: new Set(attended),
      closures: [],
    });

  it('reports not-stated when no enrolment type is given, which is every existing caller', () => {
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
    });
    expect(r.hoursBasis).toBe('attendance-type-not-stated');
    expect(r.absenceHours).toBe(0);
    expect(r.unclaimableAbsences).toEqual([]);
    expect(r.attendedOutsideAgreement).toEqual([]);
  });

  /*
    §9-2 step 2 and §6-4: for a casual or conditional child attendance IS the rule, so this
    basis is CORRECT rather than a fallback. The distinction matters because a readiness
    surface must not nag a service about a casual child's missing agreement.
  */
  it('uses attendance for a casual child, and calls that correct', () => {
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'casual',
    });
    expect(r.hoursBasis).toBe('attendance');
    expect(r.fundedHours).toBe(6);
  });

  it('distinguishes a permanent child with no agreement, which under-claims', () => {
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'permanent',
    });
    // Same number as the casual child above. Different basis, and only the basis says the
    // figure may be too low — which is why it is a field and not something a caller derives.
    expect(r.hoursBasis).toBe('attendance-no-agreement');
    expect(r.fundedHours).toBe(6);
  });

  it('uses the agreement for a permanent child who has one', () => {
    const r = childFunding({
      childId: 'c',
      events: [...fullDay(3), ...fullDay(5)],
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'permanent',
      agreement: { sessions: oneWeek(['2026-08-03', '2026-08-05']), closures: [] },
    });
    expect(r.hoursBasis).toBe('agreement');
    // Two six-hour sessions from the agreement, not the eight-hour days actually attended.
    expect(r.fundedHours).toBe(12);
    expect(r.absenceHours).toBe(0);
  });

  /*
    THE DIVERGENCE ITEM 55 NAMES, and the assertion that makes it concrete.

    An eight-hour day against a six-hour agreement funds SIX on the agreement basis and EIGHT
    on the attendance basis — where the daily cap happens to trim it back to six as well. So the
    test uses a five-hour agreement, where the two sources give genuinely different answers and
    neither is the cap.
  */
  it('claims the agreement rather than the attendance when a child stays longer', () => {
    const shortDay = [
      { weekday: 1, fromTime: '09:00', toTime: '14:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const sessions = enrolledSessions({
      blocks: shortDay,
      from: '2026-08-03',
      to: '2026-08-09',
      attendedDates: new Set(['2026-08-03']),
      closures: [],
    });
    const args = {
      childId: 'c',
      // 8am to 4pm: eight hours attended against a five-hour agreement.
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
    } as const;

    const fromAgreement = childFunding({
      ...args,
      enrolmentType: 'permanent',
      agreement: { sessions, closures: [] },
    });
    const fromAttendance = childFunding({ ...args, enrolmentType: 'casual' });

    expect(fromAgreement.fundedHours).toBe(5);
    // The daily cap trims eight to six, so the two sources really do disagree.
    expect(fromAttendance.fundedHours).toBe(6);
    // And `attendedHours` is a measurement either way — it never becomes a claim.
    expect(fromAgreement.attendedHours).toBe(8);
  });

  /*
    A day the child attended that the agreement does not cover: REPORTED, NEVER CLAIMED. §9-2
    step 1 asks for the hours of enrolment, so this product does not get to decide that extra
    attendance is claimable — it shows the service the dates so the agreement can be changed,
    which is what §6-7 asks for when attendance stops matching it.
  */
  it('reports attendance outside the agreement without claiming it', () => {
    const r = childFunding({
      childId: 'c',
      // Monday the 3rd is enrolled; Tuesday the 4th is not.
      events: [...fullDay(3), ...fullDay(4)],
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'permanent',
      agreement: { sessions: oneWeek(['2026-08-03', '2026-08-04']), closures: [] },
    });
    expect(r.attendedOutsideAgreement).toEqual(['2026-08-04']);
    // Monday and Wednesday from the agreement. The Tuesday is not in the figure at all, even
    // though the child was there for eight hours.
    expect(r.fundedHours).toBe(12);
  });

  it('claims an absence inside the three-week window, and says how much came from absences', () => {
    const r = childFunding({
      childId: 'c',
      // Attended Monday only; Wednesday absent and well inside the window.
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'permanent',
      agreement: { sessions: oneWeek(['2026-08-03']), closures: [] },
    });
    expect(r.fundedHours).toBe(12);
    expect(r.absenceHours).toBe(6);
    expect(r.unclaimableAbsences).toEqual([]);
  });

  it('refuses an absence past the window and names the reason', () => {
    // A Monday-only child across five weeks of August, never attending: days 0, 7, 14 are
    // claimable and days 21 and 28 are not.
    const mondayOnly = [
      { weekday: 1, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const r = childFunding({
      childId: 'c',
      events: [],
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'permanent',
      agreement: {
        sessions: enrolledSessions({
          blocks: mondayOnly,
          from: '2026-08-03',
          to: '2026-08-31',
          attendedDates: new Set<string>(),
          closures: [],
        }),
        closures: [],
      },
    });
    expect(r.fundedHours).toBe(18);
    expect(r.absenceHours).toBe(18);
    expect(r.unclaimableAbsences.map((u) => u.date)).toEqual(['2026-08-24', '2026-08-31']);
    expect(r.unclaimableAbsences[0]?.reason).toMatch(/three-week window/);
    // Nothing was attended at all, so this is a claim with no attendance behind it — which is
    // exactly what §6-4 permits for a permanently enrolled child and forbids for a casual one.
    expect(r.attendedHours).toBe(0);
  });

  /*
    §6-4's PROTECTION, and the most important assertion in this block.

    "Services must not claim for conditional or casual children who book for a session or day
    and do not attend." So an agreement passed for a casual child is IGNORED rather than
    honoured — otherwise a caller that fetched agreements for every child would silently start
    claiming absences for the children the Handbook says are attendance-only, and in an audit
    that money is recovered.
  */
  it('IGNORES an agreement for a casual child, because §6-4 forbids claiming their absences', () => {
    const r = childFunding({
      childId: 'c',
      events: [],
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'casual',
      agreement: { sessions: oneWeek([]), closures: [] },
    });
    expect(r.hoursBasis).toBe('attendance');
    expect(r.fundedHours).toBe(0);
    expect(r.absenceHours).toBe(0);
  });

  /*
    NOT STATED IS NOT PERMANENT, AND THIS IS THE COMBINATION THAT PROVES IT.

    Found by a mutation the tests could not kill. Making `permanent` true for a not-stated child
    survived every assertion, because no test passed an agreement for one — and that combination
    is reachable and is the dangerous one: a caller that fetches agreements for every child would
    start claiming absences for children nobody has classified.

    §6-4 allows absence funding only for a permanently enrolled child, and `0084` chose null over
    a default for exactly this reason. So an agreement handed in alongside a null type must be
    ignored as firmly as one handed in for a casual child.
  */
  it('IGNORES an agreement when the enrolment type is not stated', () => {
    const r = childFunding({
      childId: 'c',
      events: [],
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: null,
      agreement: { sessions: oneWeek([]), closures: [] },
    });
    expect(r.hoursBasis).toBe('attendance-type-not-stated');
    // Two enrolled sessions, both absent, and NOTHING claimed - because nobody has said this
    // child is permanent.
    expect(r.fundedHours).toBe(0);
    expect(r.absenceHours).toBe(0);
    expect(r.unclaimableAbsences).toEqual([]);
  });

  it('ignores an empty agreement rather than reporting zero enrolled hours', () => {
    // `child_booking_schedule` ships empty, so this is every existing child. An empty
    // agreement must not be read as "enrolled for nothing" — it means "not recorded".
    const r = childFunding({
      childId: 'c',
      events: fullDay(3),
      timeZone: NZ,
      period,
      twentyHoursEce: false,
      enrolmentType: 'permanent',
      agreement: { sessions: [], closures: [] },
    });
    expect(r.hoursBasis).toBe('attendance-no-agreement');
    expect(r.fundedHours).toBe(6);
  });

  it('still applies the weekly cap on the agreement basis', () => {
    // Five six-hour days a week is 30, exactly the weekly cap; six would be 36.
    const everyDay = [1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      fromTime: '09:00',
      toTime: '15:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    }));
    const r = childFunding({
      childId: 'c',
      events: [],
      timeZone: NZ,
      period: { label: 'One week', from: '2026-08-03', to: '2026-08-09' },
      twentyHoursEce: false,
      enrolmentType: 'permanent',
      agreement: {
        sessions: enrolledSessions({
          blocks: everyDay,
          from: '2026-08-03',
          to: '2026-08-09',
          attendedDates: new Set<string>(),
          closures: [],
        }),
        closures: [],
      },
    });
    // Six enrolled days at six hours is 36; the weekly cap allows 30.
    expect(r.absenceHours).toBe(36);
    expect(r.fundedHours).toBe(30);
  });
});
