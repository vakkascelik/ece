/**
 * The daily registers: incidents, medication given, sleep checks.
 *
 * Pure arithmetic over rows the API layer has already fetched. Nothing here reads a
 * clock — `now` is always a parameter — because the two things this module decides
 * are both time-relative, and a function that asks the system what time it is cannot
 * be tested at the boundary where it matters.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Any opinion about how often a sleeping child must be checked. `sleepStatuses`
 * refuses to answer unless the centre has stated an interval — `overdue` comes back
 * `null`, not `false`, and the two must render differently. See `sleep-checks.md` and
 * unverified-claims item 23: a default of ten minutes would read to a centre as the
 * rule, and if the rule is five the product has talked them into a breach behind a
 * green screen.
 */

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENT_KINDS = ['injury', 'illness', 'behaviour', 'near_miss', 'other'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export type IncidentStatus = 'draft' | 'final';

export interface Incident {
  id: string;
  centreId: string;
  childId: string;
  kind: IncidentKind;
  occurredAt: string;
  location: string | null;
  description: string;
  firstAidGiven: string | null;
  treatedBy: string | null;
  witnessName: string | null;
  reportedBy: string | null;
  status: IncidentStatus;
  parentNotifiedAt: string | null;
  notifiedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  supersedes: string | null;
}

/**
 * Wording that has to survive being read by a parent.
 *
 * `near_miss` is the one worth having: a gate found open with nobody hurt is the
 * record that prevents the next one, and a register holding only injuries never
 * captures it. Labelled "near miss" rather than "no harm" because the second reads
 * as a judgement that nothing mattered.
 */
export const INCIDENT_KIND_LABELS: Record<IncidentKind, string> = {
  injury: 'Injury',
  illness: 'Illness',
  behaviour: 'Behaviour',
  near_miss: 'Near miss',
  other: 'Other',
};

export interface IncidentSummary {
  /** Still being written. Never visible to a family — the policy enforces that. */
  drafts: number;
  /** Final, and the family has not been told. The queue that matters at pickup. */
  awaitingNotification: number;
  /** Told, but no acknowledgement recorded back. */
  awaitingAcknowledgement: number;
  /** Nothing outstanding. Not "no incidents" — see the note below. */
  clear: boolean;
}

/**
 * The incidents that some later incident replaces.
 *
 * A finalised report freezes, so a correction is a new row carrying `supersedes`.
 * Both rows stay: the register is a history, and deleting the version a family was
 * shown would defeat the point of having frozen it.
 */
export function supersededIds(incidents: Incident[]): Set<string> {
  const out = new Set<string>();
  for (const i of incidents) if (i.supersedes !== null) out.add(i.supersedes);
  return out;
}

/**
 * What still needs doing, which is not the same as how many incidents there were.
 *
 * `clear` ignores incidents that are finalised, notified and acknowledged, because
 * those are finished work. A dashboard that counts every incident ever is a
 * dashboard that is never green, and a dashboard that is never green is one nobody
 * reads — the same argument `summarise().clean` makes in `compliance.ts` about
 * "due soon".
 *
 * A **superseded** incident is not counted at all, whatever state it is in. Amending
 * a final report that had not yet been sent leaves the original sitting in
 * "whānau not told" forever, and chasing it would be chasing the wrong document —
 * the amendment is the one to send. The amendment itself is counted normally, so an
 * amendment nobody finalised still shows up, which is the case worth catching.
 *
 * Superseded rows are not *hidden* anywhere — the register shows them, marked. This
 * is only about what is outstanding.
 */
export function summariseIncidents(incidents: Incident[]): IncidentSummary {
  let drafts = 0;
  let awaitingNotification = 0;
  let awaitingAcknowledgement = 0;

  const replaced = supersededIds(incidents);

  for (const i of incidents) {
    if (replaced.has(i.id)) continue;
    if (i.status === 'draft') drafts += 1;
    else if (i.parentNotifiedAt === null) awaitingNotification += 1;
    else if (i.acknowledgedAt === null) awaitingAcknowledgement += 1;
  }

  return {
    drafts,
    awaitingNotification,
    awaitingAcknowledgement,
    clear: drafts === 0 && awaitingNotification === 0 && awaitingAcknowledgement === 0,
  };
}

/**
 * Most urgent first: unfinished before finished, and older before newer *within* a
 * band.
 *
 * The second half is the part that is easy to get backwards. Sorting the whole list
 * newest-first puts a draft opened four hours ago below an incident finalised and
 * acknowledged a minute ago, which buries the only row needing action. Within the
 * unfinished band, oldest first — a report nobody has sent for three hours outranks
 * one opened just now.
 */
export function compareIncidentUrgency(a: Incident, b: Incident): number {
  const band = (i: Incident) => {
    if (i.status === 'draft') return 0;
    if (i.parentNotifiedAt === null) return 1;
    if (i.acknowledgedAt === null) return 2;
    return 3;
  };
  const ba = band(a);
  const bb = band(b);
  if (ba !== bb) return ba - bb;
  // Finished work reads best newest-first; outstanding work oldest-first.
  return ba === 3 ? b.occurredAt.localeCompare(a.occurredAt) : a.occurredAt.localeCompare(b.occurredAt);
}

// ---------------------------------------------------------------------------
// Medication given
// ---------------------------------------------------------------------------

export interface MedicationAdministration {
  id: number;
  authorityId: string;
  childId: string;
  givenAt: string;
  doseGiven: string;
  givenBy: string | null;
  witnessedBy: string | null;
  corrects: number | null;
  note: string | null;
}

/**
 * Corrections supersede what they correct, transitively.
 *
 * Lifted from the funding code's treatment of attendance corrections rather than
 * reinvented, and for the same reason: a corrected row left in the list is a second
 * dose that never happened. Transitive because a correction can itself be corrected,
 * and stopping at one hop counts the middle version.
 */
export function liveAdministrations(rows: MedicationAdministration[]): MedicationAdministration[] {
  const corrected = new Set<number>();
  for (const r of rows) if (r.corrects !== null) corrected.add(r.corrects);
  return rows.filter((r) => !corrected.has(r.id));
}

/**
 * Doses recorded against one authority on one local date.
 *
 * `localDate` is passed in, already resolved in the centre's zone by the caller —
 * this module does not know what day it is, on purpose. `givenAt` is an instant, so
 * the comparison needs the zone too; the caller supplies a formatter rather than
 * this file reaching for `Intl` and quietly using the server's zone.
 */
export function dosesOnDate(
  rows: MedicationAdministration[],
  authorityId: string,
  localDate: string,
  toLocalDate: (instant: string) => string,
): MedicationAdministration[] {
  return liveAdministrations(rows).filter(
    (r) => r.authorityId === authorityId && toLocalDate(r.givenAt) === localDate,
  );
}

// ---------------------------------------------------------------------------
// Sleep checks
// ---------------------------------------------------------------------------

export const SLEEP_POSITIONS = ['back', 'side', 'front', 'awake', 'not_observed'] as const;
export type SleepPosition = (typeof SLEEP_POSITIONS)[number];

export const SLEEP_POSITION_LABELS: Record<SleepPosition, string> = {
  back: 'On their back',
  side: 'On their side',
  front: 'On their front',
  awake: 'Awake',
  not_observed: 'Position not seen',
};

export interface SleepCheck {
  id: number;
  childId: string;
  at: string;
  observedPosition: SleepPosition;
  breathingObserved: boolean;
  checkedBy: string | null;
  corrects: number | null;
  note: string | null;
}

/**
 * The state of one sleeping child's checks.
 *
 * `overdue` is `null` rather than `false` when the centre has not stated an
 * interval, and callers must render the difference. `false` says "checked recently
 * enough"; `null` says "nobody has said what recently enough means". Collapsing them
 * turns an unanswered question into a reassurance, which is the entire failure mode
 * this feature is built to avoid.
 */
export interface SleepStatus {
  childId: string;
  lastCheckedAt: string | null;
  minutesSince: number | null;
  overdue: boolean | null;
}

/**
 * Minutes between two instants, floored.
 *
 * Floored so the number never overstates how recently a child was seen. Rounding
 * 9.6 minutes to 10 would be harmless; rounding 10.4 down to 10 against a 10-minute
 * interval would hide a check that is already late, so the error is pushed the other
 * way — the same direction-of-error reasoning as `toHours` in the funding code,
 * applied to the opposite sign.
 */
export function minutesBetween(earlier: string, later: string): number {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.floor(ms / 60_000);
}

/**
 * Per child: when they were last checked, and whether that is late.
 *
 * `intervalMinutes` of `null` — a centre that has not configured one — produces
 * `overdue: null` for everybody. It does not produce `false`.
 */
export function sleepStatuses(
  childIds: string[],
  checks: SleepCheck[],
  now: string,
  intervalMinutes: number | null,
): SleepStatus[] {
  const corrected = new Set<number>();
  for (const c of checks) if (c.corrects !== null) corrected.add(c.corrects);

  const latest = new Map<string, SleepCheck>();
  for (const c of checks) {
    if (corrected.has(c.id)) continue;
    const current = latest.get(c.childId);
    if (!current || c.at > current.at) latest.set(c.childId, c);
  }

  return childIds.map((childId) => {
    const last = latest.get(childId);
    if (!last) {
      // Never checked. Not overdue against an interval that has not started
      // running — the caller renders this as "no check recorded", which is a
      // different sentence from "late".
      return { childId, lastCheckedAt: null, minutesSince: null, overdue: null };
    }
    const minutesSince = minutesBetween(last.at, now);
    return {
      childId,
      lastCheckedAt: last.at,
      minutesSince,
      overdue: intervalMinutes === null ? null : minutesSince >= intervalMinutes,
    };
  });
}
