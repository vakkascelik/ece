/**
 * Attendance events → hours attended.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE IS ORGANISED AROUND
 *
 * Hours attended become funded hours, and funded hours become a claim on the Crown. A claim
 * built on a guess is a false claim, so **nothing here estimates**.
 *
 * When a day cannot be computed — a child signed in and never signed out — it is reported as
 * unresolved and **excluded from the claimable total**. Not estimated up (which over-claims), and
 * not silently zeroed (which loses a centre funding it is entitled to and hides the record error).
 * The day is named, with the time it started, so somebody can correct the record and re-run.
 *
 * Every rounding decision below goes against the centre for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { todayInZone } from './children';

export interface HoursEvent {
  id: number;
  kind: 'in' | 'out';
  at: string;
  /** The id of an event this one supersedes. */
  corrects: number | null;
}

export interface Session {
  in: string;
  out: string;
  minutes: number;
}

export type DayIssue =
  /** Signed in, never signed out. The day cannot be computed. */
  | { kind: 'missing-sign-out'; since: string }
  /** A sign-out with no matching sign-in. Usually a missed sign-in the morning before. */
  | { kind: 'sign-out-without-sign-in'; at: string }
  /** Signed in twice without signing out. Harmless, and worth surfacing as a habit. */
  | { kind: 'duplicate-sign-in'; at: string };

export interface DayHours {
  date: string;
  sessions: Session[];
  minutes: number;
  issues: DayIssue[];
  /** False when an issue makes the day's total unreliable. Only complete days are claimable. */
  complete: boolean;
}

export interface AttendedHours {
  days: DayHours[];
  /** Minutes across complete days only. This is the figure a claim may rest on. */
  claimableMinutes: number;
  /**
   * Minutes on days with issues, computed anyway.
   *
   * Shown so a centre can see what resolving the record is worth — not added to the claim. A day
   * with a missing sign-out has *some* attendance and an unknown amount of it.
   */
  unresolvedMinutes: number;
  unresolvedDays: DayHours[];
}

/**
 * Remove events that have been superseded by a correction.
 *
 * A correction points at the event it replaces, and a correction can itself be corrected — so this
 * walks the chain rather than doing one pass. Without it, correcting a mistyped sign-in would leave
 * both the wrong time and the right one in the calculation, and the day would be claimed twice.
 */
export function resolveCorrections(events: HoursEvent[]): HoursEvent[] {
  const superseded = new Set<number>();
  for (const e of events) {
    if (e.corrects !== null) superseded.add(e.corrects);
  }
  // A superseded event's own correction target is also gone, transitively — handled naturally,
  // because the chain is expressed by every link pointing at its predecessor.
  return events.filter((e) => !superseded.has(e.id));
}

/** Local date for an instant, in a timezone. `YYYY-MM-DD`. */
function localDate(at: string, timeZone: string): string {
  return todayInZone(timeZone, new Date(at));
}

/**
 * Pair sign-ins with sign-outs for one day.
 *
 * A child may leave and come back — an appointment, a sibling's assembly — so a day is a list of
 * sessions, not one interval. Sorted by time, then walked.
 */
function pairDay(date: string, events: HoursEvent[]): DayHours {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));

  const sessions: Session[] = [];
  const issues: DayIssue[] = [];
  let openAt: string | null = null;

  for (const e of sorted) {
    if (e.kind === 'in') {
      if (openAt !== null) {
        // Already in. The derived roll treats a repeat sign-in as idempotent, so this does too —
        // taking the *first* one, because that is when the child actually arrived.
        issues.push({ kind: 'duplicate-sign-in', at: e.at });
        continue;
      }
      openAt = e.at;
      continue;
    }

    if (openAt === null) {
      issues.push({ kind: 'sign-out-without-sign-in', at: e.at });
      continue;
    }

    const minutes = Math.max(0, Math.round((Date.parse(e.at) - Date.parse(openAt)) / 60_000));
    sessions.push({ in: openAt, out: e.at, minutes });
    openAt = null;
  }

  if (openAt !== null) {
    issues.push({ kind: 'missing-sign-out', since: openAt });
  }

  const minutes = sessions.reduce((total, s) => total + s.minutes, 0);

  /**
   * What makes a day incomplete.
   *
   * A missing sign-out means the total is unknown. A sign-out with no sign-in means somebody was
   * present for a period nobody recorded. A duplicate sign-in changes nothing about the total, so
   * it is reported and does **not** make the day unclaimable — treating it as a gap would withhold
   * funding over a harmless double-tap.
   */
  const complete = !issues.some(
    (i) => i.kind === 'missing-sign-out' || i.kind === 'sign-out-without-sign-in',
  );

  return { date, sessions, minutes, issues, complete };
}

/**
 * Hours attended over a period.
 *
 * Days are local to the centre, because attendance is claimed by the day and a UTC boundary would
 * split a New Zealand morning off from its own afternoon — the same reason everything else in this
 * codebase takes a timezone.
 */
export function attendedHours(input: {
  events: HoursEvent[];
  timeZone: string;
}): AttendedHours {
  const live = resolveCorrections(input.events);

  const byDate = new Map<string, HoursEvent[]>();
  for (const e of live) {
    const date = localDate(e.at, input.timeZone);
    const list = byDate.get(date);
    if (list) list.push(e);
    else byDate.set(date, [e]);
  }

  const days = [...byDate.entries()]
    .map(([date, events]) => pairDay(date, events))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const complete = days.filter((d) => d.complete);
  const unresolved = days.filter((d) => !d.complete);

  return {
    days,
    claimableMinutes: complete.reduce((t, d) => t + d.minutes, 0),
    unresolvedMinutes: unresolved.reduce((t, d) => t + d.minutes, 0),
    unresolvedDays: unresolved,
  };
}

/**
 * Minutes → hours, rounded **down** to two decimals.
 *
 * Down, deliberately. Rounding a funding claim up by a hundredth of an hour per child per day is
 * still over-claiming, and the direction of a rounding error in a Crown claim should never favour
 * the claimant.
 */
export function toHours(minutes: number): number {
  return Math.floor((minutes / 60) * 100) / 100;
}

/** `7h 30m`, for a screen. Never used in a claim figure. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
