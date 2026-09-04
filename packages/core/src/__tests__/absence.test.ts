import { describe, expect, it } from 'vitest';
import {
  claimableAbsentMinutes,
  classifyAbsences,
  EXEMPT_WINDOW_DAYS,
  suspendsTheWindow,
  THREE_WEEK_RULE_DAYS,
  type EnrolledSession,
} from '../absence';
import type { ServiceClosure } from '../closures';

/**
 * §6-5, §6-6 and §7-7 — the absence-rule classifier.
 *
 * These assertions are the reason the classifier shipped before the arithmetic that consumes
 * it. Every one of them is a case where being wrong looks plausible: a window that expires a
 * day early, a spell that does not reset, a closure that spends an entitlement instead of
 * suspending it. None of those would fail a typecheck and none would look wrong on a screen.
 */

/** Weekly Mondays from a start date, absent unless the date is in `attended`. */
function mondays(from: string, count: number, attended: string[] = []): EnrolledSession[] {
  const out: EnrolledSession[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    const date = d.toISOString().slice(0, 10);
    out.push({ date, minutes: 360, attended: attended.includes(date) });
    d = new Date(d.getTime() + 7 * 86_400_000);
  }
  return out;
}

const closure = (over: Partial<ServiceClosure>): ServiceClosure => ({
  id: 'c',
  centreId: 'centre',
  startsOn: '2026-07-06',
  endsOn: '2026-07-17',
  reasonCode: null,
  reasonNote: 'Term break',
  ...over,
});

describe('suspendsTheWindow', () => {
  /*
    §6-6 wants "a continuous period of 2 weeks or more". Fourteen days INCLUSIVE, matching the
    `[]` range bound 0088's exclusion constraint uses — so the boundary case is a closure of
    exactly fourteen days, which is the one an off-by-one gets wrong in the direction that
    silently spends a service's entitlement.
  */
  it('qualifies at exactly fourteen days, inclusive', () => {
    expect(suspendsTheWindow(closure({ startsOn: '2026-07-01', endsOn: '2026-07-14' }))).toBe(true);
    expect(suspendsTheWindow(closure({ startsOn: '2026-07-01', endsOn: '2026-07-13' }))).toBe(false);
  });

  it('does not qualify for a one or two day emergency closure', () => {
    expect(suspendsTheWindow(closure({ startsOn: '2026-07-01', endsOn: '2026-07-01' }))).toBe(false);
    expect(suspendsTheWindow(closure({ startsOn: '2026-07-01', endsOn: '2026-07-02' }))).toBe(false);
  });

  it('qualifies for a closure with no stated end, which is at least two weeks by construction', () => {
    expect(suspendsTheWindow(closure({ startsOn: '2026-07-01', endsOn: null }))).toBe(true);
  });
});

describe('classifyAbsences — §6-5, the Three Week Rule', () => {
  it('claims a session on the first day of absence, which is day zero of the window', () => {
    const [first] = classifyAbsences({ sessions: mondays('2026-03-02', 1), closures: [] });
    expect(first?.absent).toBe(true);
    expect(first?.claimable).toBe(true);
    expect(first?.windowDaysUsed).toBe(0);
    expect(first?.spellStartedOn).toBe('2026-03-02');
  });

  /*
    THE BOUNDARY. "Within three weeks of the first day of absence" with "nothing from the
    fourth week onward". Day 0 is the first absent day, so days 0 to 20 are inside and day 21
    begins week four. Three consecutive Mondays are days 0, 7 and 14 — all in. The fourth is
    day 21 and is not.

    Asserted on the exact day rather than on a count of claimable rows, because a classifier
    that admitted twenty-two days would still pass "three of four are claimable".
  */
  it('claims the first three weekly sessions and refuses the fourth', () => {
    const rows = classifyAbsences({ sessions: mondays('2026-03-02', 4), closures: [] });
    expect(rows.map((r) => r.windowDaysUsed)).toEqual([0, 7, 14, 21]);
    expect(rows.map((r) => r.claimable)).toEqual([true, true, true, false]);
    expect(rows[3]?.reason).toMatch(/three-week window/);
  });

  it('says every absence belongs to one spell, however sparse the enrolled days', () => {
    // A Monday-only child missing four Mondays is in ONE spell, not four: the intervening
    // days are not enrolled and say nothing about whether the child returned.
    const rows = classifyAbsences({ sessions: mondays('2026-03-02', 4), closures: [] });
    expect(new Set(rows.map((r) => r.spellStartedOn))).toEqual(new Set(['2026-03-02']));
  });

  /*
    "Funding resumes when the child returns." The reset is what makes the window a per-spell
    rule rather than a per-enrolment budget — without it a child who is away three weeks in
    March can never be claimed for again.
  */
  it('resets the window when the child attends, so a later absence is claimable again', () => {
    const rows = classifyAbsences({
      // Days 0, 7, 14, 21, 28 — with attendance on day 21.
      sessions: mondays('2026-03-02', 5, ['2026-03-23']),
      closures: [],
    });
    expect(rows.map((r) => r.claimable)).toEqual([true, true, true, false, true]);
    // The attended day is not an absence at all, and the spell after it starts fresh.
    expect(rows[3]?.absent).toBe(false);
    expect(rows[4]?.spellStartedOn).toBe('2026-03-30');
    expect(rows[4]?.windowDaysUsed).toBe(0);
  });

  it('does not count an attended session as a claimable absence', () => {
    const rows = classifyAbsences({
      sessions: mondays('2026-03-02', 2, ['2026-03-02']),
      closures: [],
    });
    expect(rows[0]?.absent).toBe(false);
    expect(rows[0]?.claimable).toBe(false);
    expect(claimableAbsentMinutes(rows)).toBe(360);
  });
});

describe('classifyAbsences — §6-5, notice that the child will not return', () => {
  /*
    §6-5 is explicit that notice beats the window — it stops the claim "even if the three week
    period has not ended", and the Ministry recovers anything claimed after that point. So this
    is the one test where a session INSIDE the window is not claimable.
  */
  it('stops claiming from the date notice was given, even mid-window', () => {
    const rows = classifyAbsences({
      sessions: mondays('2026-03-02', 3),
      closures: [],
      noticeGivenOn: '2026-03-09',
    });
    expect(rows.map((r) => r.claimable)).toEqual([true, false, false]);
    // Inside the window, and refused anyway — which is the point.
    expect(rows[1]?.windowDaysUsed).toBe(7);
    expect(rows[1]?.reason).toMatch(/gave notice/);
  });

  it('claims normally when no notice was given', () => {
    const rows = classifyAbsences({
      sessions: mondays('2026-03-02', 3),
      closures: [],
      noticeGivenOn: null,
    });
    expect(rows.every((r) => r.claimable)).toBe(true);
  });
});

describe('classifyAbsences — §6-6, suspension across a closure', () => {
  /*
    THE ASSERTION THIS MODULE MOST NEEDS, and the one the wiki predicted before the code
    existed: "a naive three-week window over calendar dates would expire during the Christmas
    break and stop funding a child whose entitlement is suspended, not spent."

    A child absent from 29 June, with the service closed 6 to 19 July (fourteen days). Without
    the suspension the 20 July session is day 21 and refused. With it, fourteen closed days do
    not count, so it is day 7 and claimable.
  */
  it('does not spend the window while the service is closed for two weeks or more', () => {
    const sessions: EnrolledSession[] = [
      { date: '2026-06-29', minutes: 360, attended: false },
      { date: '2026-07-20', minutes: 360, attended: false },
    ];
    const closures = [closure({ startsOn: '2026-07-06', endsOn: '2026-07-19' })];

    const suspended = classifyAbsences({ sessions, closures });
    expect(suspended[1]?.windowDaysUsed).toBe(7);
    expect(suspended[1]?.claimable).toBe(true);

    // The same dates with no closure recorded: twenty-one days, refused. This is the half that
    // proves the assertion above is about the closure and not about the arithmetic.
    const notSuspended = classifyAbsences({ sessions, closures: [] });
    expect(notSuspended[1]?.windowDaysUsed).toBe(21);
    expect(notSuspended[1]?.claimable).toBe(false);
  });

  it('ignores a short closure, because §6-6 requires two continuous weeks', () => {
    const sessions: EnrolledSession[] = [
      { date: '2026-06-29', minutes: 360, attended: false },
      { date: '2026-07-20', minutes: 360, attended: false },
    ];
    // A two-day emergency closure inside the spell does not suspend anything.
    const rows = classifyAbsences({
      sessions,
      closures: [closure({ startsOn: '2026-07-06', endsOn: '2026-07-07' })],
    });
    expect(rows[1]?.windowDaysUsed).toBe(21);
    expect(rows[1]?.claimable).toBe(false);
  });

  /*
    A closure that STARTS BEFORE the spell. The obvious implementation —
    `daysBetween(start, date) - closedDays` — gets this wrong, because it subtracts closed days
    that were never inside the window. Counting forward and skipping suspended days cannot.
  */
  it('only discounts closed days that fall inside the spell', () => {
    const sessions: EnrolledSession[] = [
      { date: '2026-07-20', minutes: 360, attended: false },
      { date: '2026-08-10', minutes: 360, attended: false },
    ];
    // Closed 6-19 July: entirely BEFORE the spell starts on 20 July.
    const rows = classifyAbsences({
      sessions,
      closures: [closure({ startsOn: '2026-07-06', endsOn: '2026-07-19' })],
    });
    expect(rows[1]?.windowDaysUsed).toBe(21);
    expect(rows[1]?.claimable).toBe(false);
  });
});

describe('classifyAbsences — §7-7, the twelve-week window', () => {
  it('allows twelve weeks where an exemption covers the first day of absence', () => {
    const sessions = mondays('2026-03-02', 13);
    const rows = classifyAbsences({
      sessions,
      closures: [],
      isExemptOn: (date) => date === '2026-03-02',
    });
    // Days 0 through 77 are inside; the thirteenth Monday is day 84 and is not.
    expect(rows[11]?.windowDaysUsed).toBe(77);
    expect(rows[11]?.claimable).toBe(true);
    expect(rows[12]?.windowDaysUsed).toBe(84);
    expect(rows[12]?.claimable).toBe(false);
    expect(rows[12]?.reason).toMatch(/twelve-week window/);
  });

  /*
    §7-7: "The 12-week period begins on the first day of absence." So the exemption is tested
    against the SPELL'S FIRST DAY, not against each session — otherwise an exemption that
    started mid-spell would retroactively extend a window that had already expired.
  */
  it('tests the exemption against the spell start, not against each session', () => {
    const rows = classifyAbsences({
      sessions: mondays('2026-03-02', 4),
      closures: [],
      // Exempt from the fourth Monday onward — after the spell began.
      isExemptOn: (date) => date >= '2026-03-23',
    });
    expect(rows[3]?.claimable).toBe(false);
    expect(rows[3]?.reason).toMatch(/three-week window/);
  });

  it('exposes both windows as constants, so a caller cannot invent its own', () => {
    expect(THREE_WEEK_RULE_DAYS).toBe(21);
    expect(EXEMPT_WINDOW_DAYS).toBe(84);
  });
});

describe('claimableAbsentMinutes', () => {
  it('totals only the absent and claimable sessions', () => {
    const rows = classifyAbsences({ sessions: mondays('2026-03-02', 4), closures: [] });
    // Three claimable at six hours each; the fourth is past the window.
    expect(claimableAbsentMinutes(rows)).toBe(3 * 360);
  });

  it('is zero when nothing is claimable', () => {
    const rows = classifyAbsences({
      sessions: mondays('2026-03-02', 2),
      closures: [],
      noticeGivenOn: '2026-03-01',
    });
    expect(claimableAbsentMinutes(rows)).toBe(0);
  });
});
