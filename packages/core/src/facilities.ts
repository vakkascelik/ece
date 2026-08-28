/**
 * The Phase 9 registers: drills, hazards, safety checks, visitors, excursions and
 * immunisation.
 *
 * Grouped by phase rather than by which table each helper touches. Two of these are
 * about children rather than about the building, and splitting on that would produce
 * two files nobody can find anything in — the boundary that matters is in the
 * policies, not in the arithmetic.
 *
 * Same rule as `registers.ts`: nothing here reads a clock. `now` is a parameter,
 * because every question this module answers is time-relative.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Whole days between two instants, floored.
 *
 * Floored so the answer never overstates how recently something happened — the same
 * direction-of-error choice as `minutesBetween`. "9 days ago" for something 9.8 days
 * old is safe; rounding it to 10 against a 10-day interval would report a drill as
 * due when it is not, and a product that cries wolf gets ignored.
 */
export function daysSince(instant: string, now: string): number {
  return Math.floor((new Date(now).getTime() - new Date(instant).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Drills
// ---------------------------------------------------------------------------

export const DRILL_KINDS = ['fire', 'earthquake', 'lockdown', 'tsunami', 'other'] as const;
export type DrillKind = (typeof DRILL_KINDS)[number];

export const DRILL_KIND_LABELS: Record<DrillKind, string> = {
  fire: 'Fire',
  earthquake: 'Earthquake',
  lockdown: 'Lockdown',
  tsunami: 'Tsunami',
  other: 'Other',
};

export interface Drill {
  id: string;
  centreId: string;
  kind: DrillKind;
  heldAt: string;
  durationSeconds: number | null;
  adultsPresent: number | null;
  childrenPresent: number | null;
  notes: string | null;
  issuesFound: string | null;
  recordedBy: string | null;
}

/**
 * How long since a drill of this kind, and whether that is late.
 *
 * `overdue` is `null` when the centre has stated no interval, and callers must render
 * that differently from `false` — identical contract to `sleepStatuses`, and the same
 * reasoning: `false` says "recently enough", `null` says "nobody has said what
 * recently enough means". A green tick against an unmeasured gap is how a product
 * talks a centre into a breach.
 *
 * `null` for `lastHeldAt` means no drill of this kind has ever been recorded, which
 * is reported as its own state rather than as an infinite overdue.
 */
export interface DrillStatus {
  kind: DrillKind;
  lastHeldAt: string | null;
  daysSince: number | null;
  overdue: boolean | null;
}

export function drillStatuses(
  drills: Drill[],
  now: string,
  intervalDays: number | null,
): DrillStatus[] {
  return DRILL_KINDS.map((kind) => {
    const last = drills
      .filter((d) => d.kind === kind)
      .reduce<Drill | null>((best, d) => (!best || d.heldAt > best.heldAt ? d : best), null);

    if (!last) return { kind, lastHeldAt: null, daysSince: null, overdue: null };

    const since = daysSince(last.heldAt, now);
    return {
      kind,
      lastHeldAt: last.heldAt,
      daysSince: since,
      overdue: intervalDays === null ? null : since >= intervalDays,
    };
  });
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

export const HAZARD_RISKS = ['low', 'medium', 'high'] as const;
export type HazardRisk = (typeof HAZARD_RISKS)[number];

export interface Hazard {
  id: string;
  centreId: string;
  description: string;
  area: string | null;
  /** 0066. `area` stays for the free text that is not a room — the front path, the verge. */
  roomId: string | null;
  risk: HazardRisk;
  control: string | null;
  identifiedAt: string;
  identifiedBy: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;

  /*
   * 0069. `riskScore` is generated in Postgres and is read-only here — likelihood ×
   * consequence, 1–25, null unless both are set. Nothing converts it into `risk`:
   * see the note in `worklist.ts` explaining why there is no `riskBand()`.
   */
  likelihood: number | null;
  consequence: number | null;
  riskScore: number | null;
  reviewIntervalDays: number | null;
}

const RISK_ORDER: Record<HazardRisk, number> = { high: 0, medium: 1, low: 2 };

/**
 * Open before closed, then worst risk, then oldest.
 *
 * The third key is the one that earns its place. Sorting open hazards by risk alone
 * puts a high-risk one found this morning above a medium-risk one that has been open
 * since March — and the March one is the failure, because somebody has walked past it
 * two hundred times. Oldest-first inside a risk band surfaces exactly that.
 */
export function compareHazardUrgency(a: Hazard, b: Hazard): number {
  const open = (h: Hazard) => (h.resolvedAt === null ? 0 : 1);
  const byOpen = open(a) - open(b);
  if (byOpen !== 0) return byOpen;

  // Closed hazards read best newest-first; open ones oldest-first.
  if (a.resolvedAt !== null && b.resolvedAt !== null) {
    return b.resolvedAt.localeCompare(a.resolvedAt);
  }

  const byRisk = RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
  if (byRisk !== 0) return byRisk;
  return a.identifiedAt.localeCompare(b.identifiedAt);
}

export interface HazardSummary {
  open: number;
  openHigh: number;
  /** Open, high risk, and no control written. The row to act on today. */
  uncontrolled: number;
  clear: boolean;
}

/**
 * What is outstanding, not how many hazards have ever been found.
 *
 * `clear` ignores resolved hazards, so a centre that has found and fixed forty reads
 * the same as one that has found none — the argument `summarise().clean` makes in
 * `compliance.ts` and `summariseIncidents` makes for reports. A hazard register that
 * only ever goes up is a register nobody opens.
 *
 * `uncontrolled` is deliberately narrower than `openHigh`: a high-risk hazard with a
 * control written is a managed risk, which is a different situation from one nobody
 * has done anything about yet.
 */
export function summariseHazards(hazards: Hazard[]): HazardSummary {
  const open = hazards.filter((h) => h.resolvedAt === null);
  const openHigh = open.filter((h) => h.risk === 'high');
  const uncontrolled = openHigh.filter((h) => !h.control || h.control.trim() === '');
  return {
    open: open.length,
    openHigh: openHigh.length,
    uncontrolled: uncontrolled.length,
    clear: open.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Safety checks
// ---------------------------------------------------------------------------

export const SAFETY_AREAS = [
  'playground',
  'sandpit',
  'gates_and_fences',
  'indoor',
  'water',
  'chemicals',
  'first_aid_kit',
  'other',
] as const;
export type SafetyArea = (typeof SAFETY_AREAS)[number];

export const SAFETY_AREA_LABELS: Record<SafetyArea, string> = {
  playground: 'Playground',
  sandpit: 'Sandpit',
  gates_and_fences: 'Gates and fences',
  indoor: 'Indoor spaces',
  water: 'Water',
  chemicals: 'Chemicals and cleaning',
  first_aid_kit: 'First aid kit',
  other: 'Other',
};

export interface SafetyCheck {
  id: number;
  centreId: string;
  area: SafetyArea;
  at: string;
  passed: boolean;
  note: string | null;
  checkedBy: string | null;
}

/** The most recent check per area, so a screen can show what has not been done. */
export function latestByArea(checks: SafetyCheck[]): Map<SafetyArea, SafetyCheck> {
  const out = new Map<SafetyArea, SafetyCheck>();
  for (const c of checks) {
    const seen = out.get(c.area);
    if (!seen || c.at > seen.at) out.set(c.area, c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------

export interface Visitor {
  id: string;
  centreId: string;
  fullName: string;
  organisation: string | null;
  purpose: string | null;
  visiting: string | null;
  signedInAt: string;
  signedOutAt: string | null;
  recordedBy: string | null;
}

/**
 * Still in the building, oldest arrival first.
 *
 * Oldest first because this list is read during an evacuation, and the person who
 * arrived three hours ago is the one nobody has thought about since.
 */
export function onSite(visitors: Visitor[]): Visitor[] {
  return visitors
    .filter((v) => v.signedOutAt === null)
    .sort((a, b) => a.signedInAt.localeCompare(b.signedInAt));
}

// ---------------------------------------------------------------------------
// Excursions
// ---------------------------------------------------------------------------

export const EXCURSION_STATUSES = ['planned', 'departed', 'returned', 'cancelled'] as const;
export type ExcursionStatus = (typeof EXCURSION_STATUSES)[number];

export interface Excursion {
  id: string;
  centreId: string;
  destination: string;
  purpose: string | null;
  departsAt: string;
  returnsAt: string | null;
  transport: string | null;
  plan: string | null;
  adultsAttending: number | null;
  status: ExcursionStatus;
  departedAt: string | null;
  returnedAt: string | null;
}

export interface ExcursionConsent {
  id: number;
  excursionId: string;
  childId: string;
  granted: boolean;
  givenBy: string | null;
  recordedBy: string | null;
  note: string | null;
  at: string;
}

/**
 * The decision that currently stands for one child on one outing.
 *
 * `null` means no decision has been recorded, which is **not** the same as a refusal
 * and must not be rendered as one — a family who have not answered yet and a family
 * who said no are in different situations, and the screen has to be able to chase the
 * first without accusing the second.
 *
 * Append-only, so the latest row wins. Ties on `at` break on `id`, because two
 * decisions recorded in the same transaction are ordered by insertion and nothing
 * else.
 */
export function currentConsent(
  consents: ExcursionConsent[],
  excursionId: string,
  childId: string,
): boolean | null {
  const rows = consents
    .filter((c) => c.excursionId === excursionId && c.childId === childId)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const last = rows[rows.length - 1];
  return last ? last.granted : null;
}

/**
 * Who on this outing cannot go yet, split by why.
 *
 * The database refuses departure for both cases together, because for the purpose of
 * leaving the building they are identical. The screen must not: "three families have
 * not replied" is a phone call, "one family said no" is a child who stays behind, and
 * a single combined number tells a manager to do the wrong thing.
 */
export function consentGaps(
  childIds: string[],
  consents: ExcursionConsent[],
  excursionId: string,
): { unanswered: string[]; refused: string[] } {
  const unanswered: string[] = [];
  const refused: string[] = [];
  for (const childId of childIds) {
    const state = currentConsent(consents, excursionId, childId);
    if (state === null) unanswered.push(childId);
    else if (state === false) refused.push(childId);
  }
  return { unanswered, refused };
}

export interface Headcount {
  id: number;
  excursionId: string;
  at: string;
  counted: number;
  expected: number;
  countedBy: string | null;
  note: string | null;
}

/**
 * The last count taken, and whether it was short.
 *
 * `short` rather than "mismatch": a count higher than expected is a miscount or an
 * extra adult and is not the emergency. A count *lower* than expected is a child
 * nobody can see, and the two must not share a label.
 */
export function lastHeadcount(
  headcounts: Headcount[],
  excursionId: string,
): { count: Headcount; short: boolean } | null {
  const rows = headcounts
    .filter((h) => h.excursionId === excursionId)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const last = rows[rows.length - 1];
  if (!last) return null;
  return { count: last, short: last.counted < last.expected };
}

// ---------------------------------------------------------------------------
// Immunisation
// ---------------------------------------------------------------------------

export const IMMUNISATION_STATUSES = [
  'up_to_date',
  'not_up_to_date',
  'declined',
  'not_provided',
] as const;
export type ImmunisationStatus = (typeof IMMUNISATION_STATUSES)[number];

/**
 * Wording a family will read, and none of it is a judgement.
 *
 * "Declined" says what happened and stops. This product asserts nothing about what
 * follows from any of these — see 0036 — so the labels must not imply a problem
 * where the schema deliberately records none.
 */
export const IMMUNISATION_STATUS_LABELS: Record<ImmunisationStatus, string> = {
  up_to_date: 'Up to date',
  not_up_to_date: 'Not up to date',
  declined: 'Immunisation declined',
  not_provided: 'No record provided',
};

export interface ImmunisationRecord {
  id: string;
  childId: string;
  status: ImmunisationStatus;
  sightedBy: string | null;
  sightedAt: string | null;
  reference: string | null;
  nextDueOn: string | null;
  note: string | null;
  recordedAt: string;
  recordedBy: string | null;
  supersededAt: string | null;
}

/**
 * The record that currently stands, or `null` if the centre has never recorded one.
 *
 * Superseded rows are kept — "were they up to date at enrolment" is a different
 * question from "are they now" — so a caller wanting the current position has to say
 * so, and every caller does.
 */
export function currentImmunisation(records: ImmunisationRecord[]): ImmunisationRecord | null {
  const live = records
    .filter((r) => r.supersededAt === null)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return live[0] ?? null;
}
