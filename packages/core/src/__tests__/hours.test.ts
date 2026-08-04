import { describe, expect, it } from 'vitest';
import {
  attendedHours,
  formatMinutes,
  resolveCorrections,
  toHours,
  type HoursEvent,
} from '../hours';

const NZ = 'Pacific/Auckland';

/** NZST (+12) in August: 08:00 local is 20:00 UTC the previous day. */
const at = (day: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 7, day, hh - 12, mm)).toISOString();

let seq = 0;
const ev = (kind: 'in' | 'out', when: string, corrects: number | null = null): HoursEvent => ({
  id: ++seq,
  kind,
  at: when,
  corrects,
});

/**
 * Hours become funded hours, and funded hours become a claim on the Crown. So the cases below are
 * mostly about what happens when the record is *wrong* — because that is where a calculation either
 * refuses to guess or quietly invents a claim.
 */

describe('a straightforward day', () => {
  it('computes one session', () => {
    const r = attendedHours({ events: [ev('in', at(4, 8)), ev('out', at(4, 15, 30))], timeZone: NZ });
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.minutes).toBe(450);
    expect(r.days[0]!.complete).toBe(true);
    expect(r.claimableMinutes).toBe(450);
  });

  it('handles leaving and coming back', () => {
    // An appointment mid-morning. A day is a list of sessions, not one interval.
    const r = attendedHours({
      events: [
        ev('in', at(4, 8)),
        ev('out', at(4, 10)),
        ev('in', at(4, 11)),
        ev('out', at(4, 15)),
      ],
      timeZone: NZ,
    });
    expect(r.days[0]!.sessions).toHaveLength(2);
    expect(r.days[0]!.minutes).toBe(120 + 240);
    expect(r.claimableMinutes).toBe(360);
  });

  it('groups by the centre local date, not UTC', () => {
    // 08:00 and 15:00 on the 4th NZ time are both on the 3rd in UTC. Grouping by UTC would split a
    // New Zealand morning off from its own afternoon.
    const r = attendedHours({ events: [ev('in', at(4, 8)), ev('out', at(4, 15))], timeZone: NZ });
    expect(r.days[0]!.date).toBe('2026-08-04');
  });

  it('separates two days', () => {
    const r = attendedHours({
      events: [ev('in', at(4, 8)), ev('out', at(4, 15)), ev('in', at(5, 9)), ev('out', at(5, 14))],
      timeZone: NZ,
    });
    expect(r.days.map((d) => d.date)).toEqual(['2026-08-04', '2026-08-05']);
    expect(r.claimableMinutes).toBe(420 + 300);
  });
});

describe('a broken record is never estimated', () => {
  it('reports a missing sign-out and excludes the day from the claim', () => {
    // The child attended *something* and an unknown amount of it. Estimating up over-claims;
    // silently zeroing hides the error and loses the centre funding it is owed.
    const r = attendedHours({ events: [ev('in', at(4, 8))], timeZone: NZ });
    expect(r.days[0]!.complete).toBe(false);
    expect(r.days[0]!.issues).toEqual([{ kind: 'missing-sign-out', since: at(4, 8) }]);
    expect(r.claimableMinutes).toBe(0);
    expect(r.unresolvedDays).toHaveLength(1);
  });

  it('names the day and the time so somebody can fix it', () => {
    const r = attendedHours({ events: [ev('in', at(4, 7, 45))], timeZone: NZ });
    const issue = r.unresolvedDays[0]!.issues[0]!;
    expect(issue.kind).toBe('missing-sign-out');
    expect(issue.kind === 'missing-sign-out' && issue.since).toBe(at(4, 7, 45));
    expect(r.unresolvedDays[0]!.date).toBe('2026-08-04');
  });

  it('does not let one broken day cost a good one', () => {
    const r = attendedHours({
      events: [
        ev('in', at(4, 8)),
        ev('out', at(4, 15)), // fine
        ev('in', at(5, 8)), // never signed out
      ],
      timeZone: NZ,
    });
    expect(r.claimableMinutes).toBe(420);
    expect(r.unresolvedDays.map((d) => d.date)).toEqual(['2026-08-05']);
  });

  it('reports a sign-out with no sign-in and excludes that day too', () => {
    // Somebody was present for a period nobody recorded, so the day's total is not the truth.
    const r = attendedHours({ events: [ev('out', at(4, 15))], timeZone: NZ });
    expect(r.days[0]!.issues[0]!.kind).toBe('sign-out-without-sign-in');
    expect(r.days[0]!.complete).toBe(false);
    expect(r.claimableMinutes).toBe(0);
  });

  it('shows what resolving a day would be worth without claiming it', () => {
    const r = attendedHours({
      events: [ev('in', at(4, 8)), ev('out', at(4, 12)), ev('in', at(4, 13))],
      timeZone: NZ,
    });
    // Four hours of it is known; the afternoon is not. Reported, not claimed.
    expect(r.claimableMinutes).toBe(0);
    expect(r.unresolvedMinutes).toBe(240);
  });

  it('treats a duplicate sign-in as harmless and keeps the day claimable', () => {
    // A double-tap changes nothing about the total, and withholding a day's funding over one would
    // be punishing a centre for a UI slip.
    const r = attendedHours({
      events: [ev('in', at(4, 8)), ev('in', at(4, 8, 1)), ev('out', at(4, 15))],
      timeZone: NZ,
    });
    expect(r.days[0]!.complete).toBe(true);
    expect(r.days[0]!.issues.map((i) => i.kind)).toEqual(['duplicate-sign-in']);
    // The FIRST sign-in is when the child arrived.
    expect(r.days[0]!.minutes).toBe(420);
    expect(r.claimableMinutes).toBe(420);
  });

  it('never produces negative minutes from out-of-order timestamps', () => {
    const r = attendedHours({ events: [ev('in', at(4, 15)), ev('out', at(4, 8))], timeZone: NZ });
    // Sorted by time, so the 'out' comes first and is orphaned; the 'in' is then unclosed.
    expect(r.days[0]!.minutes).toBeGreaterThanOrEqual(0);
    expect(r.days[0]!.complete).toBe(false);
  });
});

describe('corrections supersede what they correct', () => {
  it('drops the corrected event', () => {
    const wrong = ev('in', at(4, 9));
    const right = ev('in', at(4, 8), wrong.id);
    const out = ev('out', at(4, 15));
    const live = resolveCorrections([wrong, right, out]);
    expect(live.map((e) => e.id)).toEqual([right.id, out.id]);
  });

  it('so the day is counted once, at the corrected time', () => {
    // Without this the wrong sign-in and the right one both survive, and the day is claimed twice.
    const wrong = ev('in', at(4, 9));
    const right = ev('in', at(4, 8), wrong.id);
    const r = attendedHours({ events: [wrong, right, ev('out', at(4, 15))], timeZone: NZ });
    expect(r.days[0]!.sessions).toHaveLength(1);
    expect(r.days[0]!.minutes).toBe(420);
  });

  it('follows a chain of corrections', () => {
    const first = ev('in', at(4, 10));
    const second = ev('in', at(4, 9), first.id);
    const third = ev('in', at(4, 8), second.id);
    const live = resolveCorrections([first, second, third]);
    expect(live.map((e) => e.id)).toEqual([third.id]);
  });
});

describe('rounding never favours the centre', () => {
  it('rounds hours DOWN', () => {
    // 7h 29m 60s-worth of minutes. A hundredth of an hour per child per day is still over-claiming.
    expect(toHours(449)).toBe(7.48);
    expect(toHours(450)).toBe(7.5);
    expect(toHours(451)).toBe(7.51);
    // 59 minutes is 0.98 hours, not 1.
    expect(toHours(59)).toBe(0.98);
  });

  it('handles zero and negative input', () => {
    expect(toHours(0)).toBe(0);
    expect(toHours(-10)).toBeLessThanOrEqual(0);
  });
});

describe('formatMinutes', () => {
  it('reads the way staff say it', () => {
    expect(formatMinutes(450)).toBe('7h 30m');
    expect(formatMinutes(420)).toBe('7h');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(0)).toBe('0h');
  });
});
