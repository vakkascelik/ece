/**
 * Reconstructing the ratio at any past moment.
 *
 * This is what makes Phase 2's attendance into Phase 3's evidence, and the reason the
 * adult count is an append-only event rather than a number in a browser (see 0010). A
 * ratio you cannot reproduce for 10:40 last Tuesday is not evidence of anything.
 *
 * WHY IT IS A REPLAY AND NOT A SAMPLE
 *
 * The obvious approach is to check the ratio every fifteen minutes and store the
 * result. That is wrong twice: it stores derived data that can drift from the events,
 * and it misses breaches shorter than the sampling interval — which are exactly the
 * ones that happen, because somebody notices and fixes it.
 *
 * The ratio is a step function. It changes only when an event occurs, so replaying the
 * day's events in order produces every distinct state with no sampling and no gaps.
 * Sixty events give sixty snapshots and the truth in between them is constant.
 *
 * Pure, and tested. It runs on the same `assessRatio` the live screens use, so the
 * historical figure and the figure an educator saw at the time are the same
 * calculation rather than two implementations that agree until they do not.
 */

import { isUnderTwo } from './children';
import { assessRatio, type RatioAssessment, type RatioTable } from './ratios';

export interface ReplayAttendanceEvent {
  childId: string;
  kind: 'in' | 'out';
  at: string;
}

export interface ReplayAdultEvent {
  adults: number;
  at: string;
}

export interface RatioSnapshot {
  /** When this state began. */
  at: string;
  /** What changed to produce it. */
  cause: 'sign-in' | 'sign-out' | 'adult-count';
  assessment: RatioAssessment;
  /** Children present at this moment, for the binder to name them if needed. */
  presentChildIds: string[];
}

export interface BreachPeriod {
  from: string;
  /** Null when the day's events end while still in breach. */
  to: string | null;
  minutes: number | null;
  worstShortfall: number;
  childrenPresent: number;
  adultsPresent: number;
}

export interface DayReplay {
  date: string;
  snapshots: RatioSnapshot[];
  breaches: BreachPeriod[];
  /** Minutes spent over ratio. Null if the day ended in breach and cannot be closed. */
  minutesInBreach: number | null;
  /** The worst state reached, for a one-line summary. */
  worst: RatioAssessment | null;
}

/**
 * Replay one day.
 *
 * `children` needs a date of birth per child so the age band is computed as it was on
 * that date — a child who turned two in March was in the under-2 band in February, and
 * a report that uses today's ages would rewrite history in the centre's favour.
 */
export function replayDay(input: {
  date: string;
  attendance: ReplayAttendanceEvent[];
  adultCounts: ReplayAdultEvent[];
  children: { id: string; dateOfBirth: string }[];
  /** Adults already present when the day's first event occurred. Usually 0. */
  openingAdults?: number;
  underTwoTable?: RatioTable;
  twoAndOverTable?: RatioTable;
}): DayReplay {
  const dobById = new Map(input.children.map((c) => [c.id, c.dateOfBirth]));

  type Step =
    | { at: string; cause: 'sign-in' | 'sign-out'; childId: string; kind: 'in' | 'out' }
    | { at: string; cause: 'adult-count'; adults: number };

  const steps: Step[] = [
    ...input.attendance.map(
      (e): Step => ({
        at: e.at,
        cause: e.kind === 'in' ? 'sign-in' : 'sign-out',
        childId: e.childId,
        kind: e.kind,
      }),
    ),
    ...input.adultCounts.map((e): Step => ({ at: e.at, cause: 'adult-count', adults: e.adults })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const present = new Set<string>();
  let adults = input.openingAdults ?? 0;
  const snapshots: RatioSnapshot[] = [];

  for (const step of steps) {
    if (step.cause === 'adult-count') {
      adults = step.adults;
    } else if (step.kind === 'in') {
      present.add(step.childId);
    } else {
      present.delete(step.childId);
    }

    // Ages as at the date being replayed, not today.
    let underTwo = 0;
    let twoAndOver = 0;
    for (const childId of present) {
      const dob = dobById.get(childId);
      // A child present in the events but absent from `children` — purged since, or
      // simply not passed in. Counted, because leaving them out would understate the
      // roll and flatter the ratio. Banded as over 2, which is the weaker assumption.
      if (dob && isUnderTwo(dob, input.date)) underTwo += 1;
      else twoAndOver += 1;
    }

    snapshots.push({
      at: step.at,
      cause: step.cause,
      assessment: assessRatio({
        underTwo,
        twoAndOver,
        adultsPresent: adults,
        underTwoTable: input.underTwoTable,
        twoAndOverTable: input.twoAndOverTable,
      }),
      presentChildIds: [...present],
    });
  }

  return {
    date: input.date,
    snapshots,
    ...collectBreaches(snapshots),
  };
}

function collectBreaches(snapshots: RatioSnapshot[]): {
  breaches: BreachPeriod[];
  minutesInBreach: number | null;
  worst: RatioAssessment | null;
} {
  const breaches: BreachPeriod[] = [];
  let open: BreachPeriod | null = null;
  let worst: RatioAssessment | null = null;

  for (const snapshot of snapshots) {
    const a = snapshot.assessment;
    if (!worst || a.shortfall > worst.shortfall) worst = a;

    if (a.status === 'breach') {
      if (!open) {
        open = {
          from: snapshot.at,
          to: null,
          minutes: null,
          worstShortfall: a.shortfall,
          childrenPresent: a.present,
          adultsPresent: a.adultsPresent,
        };
      } else {
        // A breach that deepens is the same breach, and the number that matters is how
        // bad it got.
        open.worstShortfall = Math.max(open.worstShortfall, a.shortfall);
        open.childrenPresent = Math.max(open.childrenPresent, a.present);
      }
    } else if (open) {
      open.to = snapshot.at;
      open.minutes = minutesBetween(open.from, snapshot.at);
      breaches.push(open);
      open = null;
    }
  }

  // Still in breach when the events ran out. Left open rather than closed at the last
  // event: the day is not over, and inventing an end time would understate it.
  if (open) breaches.push(open);

  const closed = breaches.filter((b) => b.minutes !== null);
  const minutesInBreach =
    breaches.length > 0 && closed.length < breaches.length
      ? null
      : closed.reduce((total, b) => total + (b.minutes ?? 0), 0);

  return { breaches, minutesInBreach, worst };
}

function minutesBetween(fromISO: string, toISO: string): number {
  return Math.round((new Date(toISO).getTime() - new Date(fromISO).getTime()) / 60_000);
}

/**
 * One line for the binder.
 *
 * Says "no breaches recorded" rather than "compliant", because the events only record
 * what was signed in. A child who was present and never signed in is invisible here,
 * and claiming compliance on the strength of that would be the report asserting more
 * than the data supports.
 */
export function summariseDay(day: DayReplay): string {
  if (day.snapshots.length === 0) return `${day.date}: no attendance recorded.`;
  if (day.breaches.length === 0) {
    return `${day.date}: no ratio breaches recorded across ${day.snapshots.length} events.`;
  }
  const total =
    day.minutesInBreach === null ? 'still open at the last event' : `${day.minutesInBreach} minutes`;
  return `${day.date}: ${day.breaches.length} breach${day.breaches.length === 1 ? '' : 'es'}, ${total} over ratio.`;
}
