import { describe, expect, it } from 'vitest';
import {
  assessFrequentAbsence,
  claimableAbsentMinutes,
  classifyAbsences,
  EXEMPT_WINDOW_DAYS,
  enrolledSessions,
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

describe('enrolledSessions — the bridge from the agreement', () => {
  // A Tuesday/Thursday child, 9:00 to 15:00, in force from the start of 2026.
  const tueThu = [
    { weekday: 2, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    { weekday: 4, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
  ];

  it('produces one session per enrolled weekday in the range, with the agreement minutes', () => {
    // 2026-03-02 is a Monday, so the week yields Tuesday the 3rd and Thursday the 5th.
    const rows = enrolledSessions({
      blocks: tueThu,
      from: '2026-03-02',
      to: '2026-03-08',
      attendedDates: new Set<string>(),
      closures: [],
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-03-03', '2026-03-05']);
    expect(rows.every((r) => r.minutes === 360)).toBe(true);
    expect(rows.every((r) => r.attended === false)).toBe(true);
  });

  it('marks a session attended when the child was there', () => {
    const rows = enrolledSessions({
      blocks: tueThu,
      from: '2026-03-02',
      to: '2026-03-08',
      attendedDates: new Set(['2026-03-03']),
      closures: [],
    });
    expect(rows.map((r) => r.attended)).toEqual([true, false]);
  });

  /*
    A CLOSED DAY IS NOT A SESSION. §6-5 claims sessions a child was "enrolled to attend, but was
    absent from", and on a day the service did not operate there was nothing to be absent from.

    This is also the assertion that stops a closure spending a three-week window on days nobody
    could have attended — the exact thing §6-6 exists to prevent, arrived at from the other end.
  */
  it('produces no session on a day the service was closed', () => {
    const rows = enrolledSessions({
      blocks: tueThu,
      from: '2026-03-02',
      to: '2026-03-08',
      attendedDates: new Set<string>(),
      closures: [closure({ startsOn: '2026-03-03', endsOn: '2026-03-03', reasonNote: 'Snow' })],
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-03-05']);
  });

  it('sums a morning and an afternoon block into one session, because §9-2 asks per day', () => {
    const split = [
      { weekday: 2, fromTime: '08:00', toTime: '11:00', effectiveFrom: '2026-01-01', effectiveTo: null },
      { weekday: 2, fromTime: '13:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const rows = enrolledSessions({
      blocks: split,
      from: '2026-03-02',
      to: '2026-03-08',
      attendedDates: new Set<string>(),
      closures: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.minutes).toBe(300);
  });

  /*
    Superseded blocks are filtered by `blocksOn`, which is the one written-down copy of the
    effective-window rule. Asserted here because the alternative — filtering in this function —
    would be a second copy that disagrees with the first the moment either changes.
  */
  it('uses only the block in force on each date', () => {
    const changed = [
      { weekday: 2, fromTime: '09:00', toTime: '15:00', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-03' },
      { weekday: 2, fromTime: '09:00', toTime: '12:00', effectiveFrom: '2026-03-04', effectiveTo: null },
    ];
    const rows = enrolledSessions({
      blocks: changed,
      from: '2026-03-03',
      to: '2026-03-10',
      attendedDates: new Set<string>(),
      closures: [],
    });
    expect(rows.map((r) => [r.date, r.minutes])).toEqual([
      ['2026-03-03', 360],
      ['2026-03-10', 180],
    ]);
  });

  it('produces nothing at all when the child has no agreement, which is the state today', () => {
    // `child_booking_schedule` ships empty, so this is every existing child. The caller must
    // treat "no sessions" as "the agreement is unknown" rather than as "no enrolled hours".
    expect(
      enrolledSessions({
        blocks: [],
        from: '2026-03-02',
        to: '2026-03-31',
        attendedDates: new Set(['2026-03-03']),
        closures: [],
      }),
    ).toEqual([]);
  });

  /*
    SUNDAY IS WEEKDAY 7, NOT 0, and this is the only test that can catch the conversion.

    `child_booking_schedule.weekday` is an ISO weekday where Monday is 1 and Sunday is 7;
    `Date.getUTCDay()` returns 0 for Sunday. Every other assertion in this file uses Tuesday or
    Thursday, where the raw value and the ISO value happen to agree — so without a Sunday case a
    missing conversion would go unnoticed until a service open at the weekend used it.

    Found by asking what a mutation of that line would break, and discovering the answer was
    nothing.
  */
  it('matches a Sunday block, where getUTCDay and the ISO weekday disagree', () => {
    const sunday = [
      { weekday: 7, fromTime: '09:00', toTime: '12:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    // 2026-03-08 is a Sunday.
    const rows = enrolledSessions({
      blocks: sunday,
      from: '2026-03-02',
      to: '2026-03-08',
      attendedDates: new Set<string>(),
      closures: [],
    });
    expect(rows.map((r) => r.date)).toEqual(['2026-03-08']);
    expect(rows[0]?.minutes).toBe(180);
  });

  it('skips a block whose times will not parse, rather than calling it a zero-hour session', () => {
    // An inverted block: `blockMinutes` returns null, and a session of no hours would be an
    // absence a service could be told about for a day the agreement never described.
    const broken = [
      { weekday: 2, fromTime: '15:00', toTime: '09:00', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    expect(
      enrolledSessions({
        blocks: broken,
        from: '2026-03-02',
        to: '2026-03-08',
        attendedDates: new Set<string>(),
        closures: [],
      }),
    ).toEqual([]);
  });

  it('drives the classifier end to end from an agreement', () => {
    // Four Tuesdays absent: days 0, 7, 14 and 21 of one spell, so the fourth is refused.
    const sessions = enrolledSessions({
      blocks: [tueThu[0]!],
      from: '2026-03-03',
      to: '2026-03-24',
      attendedDates: new Set<string>(),
      closures: [],
    });
    expect(sessions).toHaveLength(4);
    const rows = classifyAbsences({ sessions, closures: [] });
    expect(rows.map((r) => r.claimable)).toEqual([true, true, true, false]);
    expect(claimableAbsentMinutes(rows)).toBe(3 * 360);
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

/*
  §6-7, THE FREQUENT ABSENCE RULE.

  The fixtures are built from the Handbook where the Handbook is specific and constructed where
  it is not, and the difference is marked on each one. §6-8's worked examples are quoted for
  their *structure* — which trigger, which months claimable — because the register (item 61)
  records their conclusions verbatim; the day-by-day attendance underneath them is mine, and a
  test that pretended otherwise would be asserting the Handbook says something it may not.
*/

/** Every occurrence of one ISO weekday in a month. `attendedOn` lists the ones attended. */
function weekdayIn(
  month: string,
  isoWeekday: number,
  attendedOn: readonly string[] = [],
  minutes = 360,
): EnrolledSession[] {
  const out: EnrolledSession[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const t = new Date(`${date}T00:00:00Z`);
    // Rolls over into the next month for a short one, which is how the loop ends.
    if (t.getUTCMonth() + 1 !== Number(month.slice(5, 7))) break;
    const dow = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
    if (dow !== isoWeekday) continue;
    out.push({ date, minutes, attended: attendedOn.includes(date) });
  }
  return out;
}

describe('assessFrequentAbsence — §6-7, trigger 1: the same enrolled day', () => {
  it('triggers on more than half the Fridays of a month, and not on exactly half', () => {
    // August 2026 has four Fridays: 7, 14, 21, 28.
    const fridays = weekdayIn('2026-08', 5);
    expect(fridays).toHaveLength(4);

    const half = assessFrequentAbsence({
      sessions: weekdayIn('2026-08', 5, ['2026-08-07', '2026-08-14']),
      closures: [],
      isSessionalService: false,
    });
    // Two of four missed is exactly half, and §6-7 requires attendance to match for "50 per
    // cent or more" — so half is a match, not a trigger. The off-by-one that would break this
    // is `>=` in place of `>`, and nothing else in the suite would notice.
    expect(half[0]?.triggers.filter((t) => t.kind === 'same-enrolled-day')).toEqual([]);

    const short = assessFrequentAbsence({
      sessions: weekdayIn('2026-08', 5, ['2026-08-07']),
      closures: [],
      isSessionalService: false,
    });
    expect(short[0]?.triggers).toContainEqual({
      kind: 'same-enrolled-day',
      isoWeekday: 5,
      enrolled: 4,
      absent: 3,
    });
  });

  it('counts each enrolled weekday separately, so a bad Friday is not diluted by good Mondays', () => {
    /*
      The reason trigger 1 exists at all, and the reason it cannot be replaced by a monthly
      total: this child attends 8 of 12 sessions — comfortably over half — while missing three
      of four Fridays. A month-level percentage would call that a match.
    */
    const sessions = [
      ...weekdayIn('2026-08', 1, ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']),
      ...weekdayIn('2026-08', 5, ['2026-08-07']),
    ];
    const [august] = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    expect(august?.attendedDays).toBe(6);
    expect(august?.enrolledDays).toBe(9);
    expect(august?.triggers).toContainEqual({
      kind: 'same-enrolled-day',
      isoWeekday: 5,
      enrolled: 4,
      absent: 3,
    });
  });
});

describe('assessFrequentAbsence — §6-7, trigger 3: fewer hours than enrolled', () => {
  const shortDays = (month: string) =>
    weekdayIn(month, 1).map((session) => ({
      ...session,
      attended: true,
      attendedMinutes: 180, // enrolled for 360
    }));

  it('triggers when a child attends but for half the enrolled hours', () => {
    const [row] = assessFrequentAbsence({
      sessions: shortDays('2026-08'),
      closures: [],
      isSessionalService: false,
    });
    expect(row?.triggers).toContainEqual({
      kind: 'fewer-hours-per-day',
      enrolledDays: 5,
      daysShort: 5,
    });
    // Full attendance on every enrolled day, so neither of the other two triggers fires. This is
    // the case that only trigger 3 can see.
    expect(row?.triggers).toHaveLength(1);
  });

  it('does not run at all for a sessional service, because the Handbook excludes it', () => {
    const [row] = assessFrequentAbsence({
      sessions: shortDays('2026-08'),
      closures: [],
      isSessionalService: true,
    });
    expect(row?.triggers).toEqual([]);
    expect(row?.triggered).toBe(false);
    // Excluded, not unassessable: no gap either, because the Handbook answered this one.
    expect(row?.gaps).toEqual([]);
  });

  it('reports a gap rather than a verdict when the service model is unknown', () => {
    const [row] = assessFrequentAbsence({
      sessions: shortDays('2026-08'),
      closures: [],
      isSessionalService: null,
    });
    expect(row?.triggers).toEqual([]);
    expect(row?.gaps.join(' ')).toContain('service model is not recorded');
  });

  it('reports a gap rather than a shortfall for a day whose attendance record is broken', () => {
    // `null` attendedMinutes is a missing sign-out. Counting it as zero would invent a shortfall
    // out of a paperwork failure and make a month unclaimable on the strength of it.
    const sessions = weekdayIn('2026-08', 1).map((session) => ({
      ...session,
      attended: true,
      attendedMinutes: null,
    }));
    const [row] = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    expect(row?.triggers).toEqual([]);
    expect(row?.gaps.join(' ')).toContain('attended hours were not supplied');
  });

  it('counts an absent day as zero hours, so the triggers overlap on purpose', () => {
    const sessions = weekdayIn('2026-08', 1, ['2026-08-03']).map((session) => ({
      ...session,
      attendedMinutes: session.attended ? 360 : null,
    }));
    const [row] = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    // Four of five absent: trigger 1 and trigger 3 both fire, and the `null` on an absent day is
    // ignored because the day needs no attendance record to be known as zero.
    expect(row?.triggers.map((t) => t.kind).sort()).toEqual([
      'fewer-days-per-week',
      'fewer-hours-per-day',
      'same-enrolled-day',
    ]);
    expect(row?.gaps).toEqual([]);
  });
});

describe('assessFrequentAbsence — §6-7, the "more than half" boundary', () => {
  /*
    THE MUTATION DRILL FOUND BOTH OF THESE MISSING. Trigger 1's boundary was asserted and the
    other two were not, so `>` could become `>=` in either of them and the whole suite stayed
    green. §6-7 requires attendance to match for *"at least half (i.e. 50 per cent or more)"*,
    which makes exactly half a MATCH — the inclusive version would trigger on a month the
    Handbook accepts, and by month four refuse hours the service is entitled to claim.
  */

  it('does not trigger on exactly half the weeks being short — trigger 2', () => {
    // Four ISO weeks, Monday and Friday enrolled in each. Two weeks lose one day; two are full.
    const sessions: EnrolledSession[] = [
      { date: '2026-08-03', minutes: 360, attended: false }, // week 1, short
      { date: '2026-08-07', minutes: 360, attended: true },
      { date: '2026-08-10', minutes: 360, attended: true }, // week 2, short
      { date: '2026-08-14', minutes: 360, attended: false },
      { date: '2026-08-17', minutes: 360, attended: true }, // week 3, full
      { date: '2026-08-21', minutes: 360, attended: true },
      { date: '2026-08-24', minutes: 360, attended: true }, // week 4, full
      { date: '2026-08-28', minutes: 360, attended: true },
    ];
    const [row] = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    // One absence on each of two weekdays out of four occurrences, so trigger 1 stays quiet too.
    expect(row?.triggered).toBe(false);
    expect(row?.enrolledDays).toBe(8);
    expect(row?.attendedDays).toBe(6);
  });

  it('does not trigger on exactly half the days being short of hours — trigger 3', () => {
    // Four Mondays in September 2026, all attended, two of them for half the enrolled hours.
    const sessions: EnrolledSession[] = [
      { date: '2026-09-07', minutes: 360, attended: true, attendedMinutes: 180 },
      { date: '2026-09-14', minutes: 360, attended: true, attendedMinutes: 180 },
      { date: '2026-09-21', minutes: 360, attended: true, attendedMinutes: 360 },
      { date: '2026-09-28', minutes: 360, attended: true, attendedMinutes: 360 },
    ];
    const [row] = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    expect(row?.triggered).toBe(false);
    // And one more short day tips it, which is what makes the assertion above a boundary rather
    // than a coincidence.
    const tipped = assessFrequentAbsence({
      sessions: [...sessions.slice(0, 3), { ...sessions[3] as EnrolledSession, attendedMinutes: 180 }],
      closures: [],
      isSessionalService: false,
    });
    expect(tipped[0]?.triggers).toContainEqual({
      kind: 'fewer-hours-per-day',
      enrolledDays: 4,
      daysShort: 3,
    });
  });
});

describe('assessFrequentAbsence — §6-7, the four-month timeline', () => {
  /** A month where three of four Fridays are missed — §6-8 example 1's trigger. */
  const badFridays = (month: string, attendedOn: readonly string[]) =>
    weekdayIn(month, 5, attendedOn);

  const run = () => [
    ...badFridays('2026-08', ['2026-08-07']),
    ...badFridays('2026-09', ['2026-09-04']),
    ...badFridays('2026-10', ['2026-10-02']),
    ...badFridays('2026-11', ['2026-11-06']),
  ];

  it('claims months one and two, and refuses month three without a reconfirmation', () => {
    const months = assessFrequentAbsence({
      sessions: run(),
      closures: [],
      isSessionalService: false,
    });
    expect(months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(months.map((m) => m.monthOfRun)).toEqual([1, 2, 3, 4]);
    expect(months.map((m) => m.claimable)).toEqual([true, true, false, false]);
    expect(months[2]?.reason).toContain('third month');
    expect(months[3]?.reason).toContain('must be changed');
  });

  it('claims month three when the agreement was reconfirmed during the run', () => {
    const months = assessFrequentAbsence({
      sessions: run(),
      closures: [],
      isSessionalService: false,
      reconfirmedOn: ['2026-09-15'],
    });
    expect(months[2]?.claimable).toBe(true);
    expect(months[2]?.reason).toBeNull();
    // Month four is not rescued by it. §6-7 says the agreement must CHANGE, and a reconfirmation
    // that affirms the existing agreement is the opposite of that.
    expect(months[3]?.claimable).toBe(false);
  });

  it('ignores a reconfirmation that predates the pattern', () => {
    // Reconfirming in July an agreement nobody had questioned yet cannot unlock October.
    const months = assessFrequentAbsence({
      sessions: run(),
      closures: [],
      isSessionalService: false,
      reconfirmedOn: ['2026-07-20'],
    });
    expect(months[2]?.claimable).toBe(false);
  });

  it('ignores a reconfirmation dated after the month it would unlock', () => {
    const months = assessFrequentAbsence({
      sessions: run(),
      closures: [],
      isSessionalService: false,
      reconfirmedOn: ['2026-11-02'],
    });
    expect(months[2]?.claimable).toBe(false);
  });

  it('resets the run when attendance returns to normal, which is §6-8s other route', () => {
    /*
      Item 61: §6-7's prose allows month 3 only on a reconfirmation, while §6-8's examples add
      "OR attendance returns to normal". This asserts the convergence the implementation notes
      claim — a normal month does not trigger, so it ENDS the run, and the month after it starts
      at 1 rather than needing a signature.
    */
    const sessions = [
      ...badFridays('2026-08', ['2026-08-07']),
      ...badFridays('2026-09', ['2026-09-04']),
      ...weekdayIn('2026-10', 5, ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']),
      ...badFridays('2026-11', ['2026-11-06']),
    ];
    const months = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    expect(months.map((m) => m.monthOfRun)).toEqual([1, 2, 0, 1]);
    expect(months.every((m) => m.claimable)).toBe(true);
  });

  it('carries the run across a month with no enrolled sessions without advancing it', () => {
    const sessions = [
      ...badFridays('2026-08', ['2026-08-07']),
      ...badFridays('2026-10', ['2026-10-02']),
    ];
    const months = assessFrequentAbsence({ sessions, closures: [], isSessionalService: false });
    expect(months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(months.map((m) => m.monthOfRun)).toEqual([1, 0, 2]);
    expect(months[1]?.gaps.join(' ')).toContain('no enrolled sessions');
  });

  it('reports a long closure without applying the extension §6-7 permits', () => {
    const months = assessFrequentAbsence({
      sessions: run(),
      closures: [closure({ startsOn: '2026-09-14', endsOn: '2026-09-30', reasonNote: 'Renovations' })],
      isSessionalService: false,
    });
    // Still month 2 of the run, and October is still month 3. The gap is where the extension is
    // disclosed — the alternative would make more months claimable on an inference.
    expect(months[1]?.monthOfRun).toBe(2);
    expect(months[1]?.gaps.join(' ')).toContain('does not apply that extension');
    expect(months[2]?.claimable).toBe(false);
  });

  it('returns nothing for an enrolment with no sessions at all', () => {
    expect(assessFrequentAbsence({ sessions: [], closures: [], isSessionalService: false })).toEqual(
      [],
    );
  });
});
