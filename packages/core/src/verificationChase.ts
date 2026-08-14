/**
 * Who gets asked to confirm a week, this run — the scheduler's one decision, made pure.
 *
 * The rhythm §6-3 runs on: a completed week is released to its signatories, the
 * unanswered are reminded weekly, and after three asks the family is left alone — by
 * then the week reads `overdue` on the office card, whose remedy is paper, not a fourth
 * notification. The approved SMS in this market runs exactly this cadence by email.
 *
 * PURE, AND WHY THAT IS THE POINT
 *
 * The runner holds the service key and its loop is the tenant boundary, which makes it
 * precisely the code that should contain no judgement: everything it does must be
 * auditable as "fetched X, called the planner, wrote what it said". The judgement —
 * who is asked, who is left alone, and why — lives here, where it can be tested against
 * a calendar without a database, and mutation-tested without a service key.
 *
 * THE TWO RULES, AND THE ONE THAT IS DELIBERATELY MISSING
 *
 * At most three notices per (guardian, week), and at most one per calendar week. There
 * is no "skip quiet hours" rule here: notices land as in-app rows, and hold-until is the
 * delivery worker's judgement at send time (0063 records the same decision) — a planner
 * that also did delivery pacing would be two schedulers disagreeing.
 */

import { shiftLocalDate } from './children';
import type { VerificationStatus } from './attendanceVerification';

export interface ChaseCandidate {
  childId: string;
  /** The signatory this notice would go to. One candidate per signatory per week. */
  guardianId: string;
  /** The signatory's auth account — carried through untouched for the runner's insert. */
  userId: string;
  periodStart: string;
  periodEnd: string;
  /** Derived upstream by summariseVerification, against the centre's today. */
  status: VerificationStatus;
  /** Notices already sent to this guardian for this week, from verification_notices. */
  noticesSent: number;
  /** The centre-calendar day of the most recent one, or null if none. */
  lastSentOn: string | null;
}

export interface PlannedNotice {
  childId: string;
  guardianId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  /** 1 is the release; 2 and 3 are reminders. The wording differs, so the runner needs it. */
  noticeNumber: 1 | 2 | 3;
}

export const MAX_NOTICES_PER_PERIOD = 3;

/** The Monday of the week containing `date` — the calendar bucket the one-per-week rule uses. */
function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay();
  // getUTCDay: Sunday 0. Distance back to Monday: Sunday is 6 days past its week's Monday.
  return shiftLocalDate(date, -(dow === 0 ? 6 : dow - 1));
}

/**
 * Decide this run's notices. `today` is the centre's day, resolved by the caller.
 *
 * Only `awaiting` is chased. The other states all mean somebody answered or the office
 * already owns it: `approved` needs nothing, `in-review` and `superseded` are the
 * centre's move (needsAttention lists them), and `overdue` means three weeks passed —
 * the remedy is the paper form on the office card, and a fourth notification to a family
 * that ignored three is how every notification from the centre starts being ignored.
 */
export function planVerificationChase(
  candidates: ChaseCandidate[],
  today: string,
): PlannedNotice[] {
  const thisWeek = mondayOf(today);

  return candidates
    .filter((c) => {
      if (c.status !== 'awaiting') return false;
      if (c.noticesSent >= MAX_NOTICES_PER_PERIOD) return false;
      // One ask per calendar week. Same-week comparison rather than "seven days since",
      // because the job runs daily and a Tuesday catch-up run after a skipped Monday
      // should not shift every subsequent notice to Tuesdays forever.
      if (c.lastSentOn !== null && mondayOf(c.lastSentOn) === thisWeek) return false;
      return true;
    })
    .map((c) => ({
      childId: c.childId,
      guardianId: c.guardianId,
      userId: c.userId,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      noticeNumber: (c.noticesSent + 1) as 1 | 2 | 3,
    }));
}
