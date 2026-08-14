/**
 * Children, whānau, enrolment, health and consent — the shared vocabulary.
 *
 * As with everything in `@ece/core`, none of this is a security boundary. The
 * boundary is the policies in `0004_children.sql`, which key on guardianship
 * rather than on centre membership. What is here is the part both apps must agree
 * on: what a consent kind means, when a child counts as under two, and which
 * order to show an allergy list in.
 */

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Child {
  id: string;
  centreId: string;
  firstName: string;
  lastName: string;
  /** What the child is actually called. Often not a shortening of the legal name. */
  preferredName: string | null;
  /** ISO date, `YYYY-MM-DD`. */
  dateOfBirth: string;
  moeNsn: string | null;
  ethnicities: string[];
  iwi: string | null;
  firstLanguage: string | null;
  gender: Gender | null;
  archivedAt: string | null;
}

export const GENDERS = ['female', 'male', 'another', 'unspecified'] as const;
export type Gender = (typeof GENDERS)[number];

export interface Guardian {
  id: string;
  centreId: string;
  /** Null for a guardian with no app account — a grandparent on the collection list. */
  userId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  archivedAt: string | null;
}

export interface ChildGuardian {
  id: string;
  childId: string;
  guardianId: string;
  /** Free text, not an enum. See the note in the migration. */
  relationship: string;
  isPrimary: boolean;
  /**
   * Distinct from `isPrimary`. The person the centre rings first and the people
   * allowed to take a child home are different lists.
   */
  canCollect: boolean;
  isEmergencyContact: boolean;
  /**
   * May this guardian verify the child's attendance record — ECE Funding Handbook 6-3
   * criterion 4 (0061). Named by the centre, never inferred: collecting a child and
   * signing off the funded hours are different authorities, which is why this is not
   * `canCollect` under another name.
   */
  isAuthorisedSignatory: boolean;
  contactPriority: number;
  revokedAt: string | null;
}

export interface Enrolment {
  id: string;
  childId: string;
  centreId: string;
  startDate: string;
  /** Null means open-ended, which is the normal state of an enrolled child. */
  endDate: string | null;
  fundedHoursPerWeek: number;
  twentyHoursEce: boolean;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HEALTH_KINDS = ['allergy', 'medical_condition', 'dietary_requirement'] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

export const HEALTH_KIND_LABELS: Record<HealthKind, string> = {
  allergy: 'Allergy',
  medical_condition: 'Medical condition',
  dietary_requirement: 'Dietary requirement',
};

/**
 * `anaphylaxis` is not a stronger word for `severe`. It means adrenaline, and it
 * means the response plan is not optional reading — so it sorts first and is
 * styled as a breach rather than a warning.
 */
export const HEALTH_SEVERITIES = ['mild', 'moderate', 'severe', 'anaphylaxis'] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

export interface HealthCondition {
  id: string;
  childId: string;
  kind: HealthKind;
  name: string;
  severity: HealthSeverity | null;
  responsePlan: string | null;
  resolvedAt: string | null;
}

export interface MedicationAuthority {
  id: string;
  childId: string;
  medicine: string;
  dose: string;
  route: string | null;
  instructions: string | null;
  authorisedBy: string | null;
  authorisedAt: string;
  startsOn: string;
  /** Null is an open-ended authority, which is not one anybody would defend. */
  expiresOn: string | null;
}

/** Most urgent first, so the list an educator scans starts with what could kill. */
const SEVERITY_ORDER: Record<HealthSeverity, number> = {
  anaphylaxis: 0,
  severe: 1,
  moderate: 2,
  mild: 3,
};

export function compareBySeverity(a: HealthCondition, b: HealthCondition): number {
  const rank = (c: HealthCondition) => (c.severity ? SEVERITY_ORDER[c.severity] : 4);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

/** Does this child have anything that could become an emergency today? */
export function hasCriticalCondition(conditions: HealthCondition[]): boolean {
  return conditions.some(
    (c) => !c.resolvedAt && (c.severity === 'anaphylaxis' || c.severity === 'severe'),
  );
}

/**
 * Is this medication authority currently in force?
 *
 * Expiry matters because an educator looking at a list of authorities needs to
 * know which ones they may still act on, and a lapsed authority displayed the same
 * way as a live one is how medicine gets given without one.
 */
export function isMedicationCurrent(m: MedicationAuthority, on: string = todayInZone()): boolean {
  if (m.startsOn > on) return false;
  return m.expiresOn === null || m.expiresOn >= on;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export const CONSENT_KINDS = [
  'photo_internal',
  'photo_public',
  'excursion',
  'sunscreen',
  'nappy_cream',
  'medical_emergency',
  'transport',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/**
 * Wording matters here more than anywhere else in the product.
 *
 * A consent form is the one screen where a vague label produces a legally
 * worthless answer. "Photos" is vague; "in the private journal your whānau reads"
 * and "on our public Facebook page" are two different questions, and families who
 * agree to the first routinely refuse the second.
 */
export const CONSENT_DETAIL: Record<ConsentKind, { label: string; detail: string }> = {
  photo_internal: {
    label: 'Photos in the learning journal',
    detail: "Photos of your child in their own private journal, visible only to your whānau and their kaiako.",
  },
  photo_public: {
    label: 'Photos shared publicly',
    detail: 'Photos of your child on our website, social media, or printed material.',
  },
  excursion: {
    label: 'Excursions',
    detail: 'Leaving the centre on outings in the local area, with the usual supervision ratios.',
  },
  sunscreen: {
    label: 'Sunscreen',
    detail: 'Kaiako applying the centre-supplied sunscreen before outdoor play.',
  },
  nappy_cream: {
    label: 'Nappy cream',
    detail: 'Kaiako applying barrier cream at nappy changes.',
  },
  medical_emergency: {
    label: 'Emergency medical treatment',
    detail:
      'Seeking urgent medical treatment, including an ambulance, if we cannot reach you and a child needs it.',
  },
  transport: {
    label: 'Transport',
    detail: 'Travelling in a centre or staff vehicle, in an appropriate restraint.',
  },
};

/**
 * The consents that must be answered before a child's first day.
 *
 * Not every kind: `photo_public`, `nappy_cream` and `transport` depend on what the
 * centre actually does, and demanding an answer to an irrelevant question trains
 * people to tick everything. These four apply to every service.
 */
export const REQUIRED_CONSENTS: readonly ConsentKind[] = [
  'medical_emergency',
  'sunscreen',
  'excursion',
  'photo_internal',
];

export interface ConsentState {
  kind: ConsentKind;
  granted: boolean;
  givenBy: string | null;
  at: string;
}

/**
 * Current answer for one kind, or `undefined` if never asked.
 *
 * The three-state distinction is the point: "refused" and "never asked" look the
 * same to a boolean and are completely different facts. One is a decision to
 * respect, the other is an enrolment that is not finished.
 */
export function consentFor(states: ConsentState[], kind: ConsentKind): ConsentState | undefined {
  return states.find((s) => s.kind === kind);
}

export function isGranted(states: ConsentState[], kind: ConsentKind): boolean {
  return consentFor(states, kind)?.granted === true;
}

/** Required consents with no answer at all. Drives the "enrolment incomplete" flag. */
export function missingConsents(states: ConsentState[]): ConsentKind[] {
  return REQUIRED_CONSENTS.filter((k) => consentFor(states, k) === undefined);
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

export const NZ_TIMEZONE = 'Pacific/Auckland';

/**
 * Move an already-resolved local date by a number of days.
 *
 * The input is a calendar date somebody else resolved with `todayInZone`, and the
 * output is another calendar date. `Date.UTC` at both ends means the offset cancels
 * and no zone is consulted — this never asks what day it is, which is what keeps it
 * out of the trap `localDates.test.ts` guards.
 *
 * It lives here rather than in the web app because it now has callers in two
 * packages. It began as an inline copy in `/incidents`, moved to
 * `apps/web/src/lib/dayWindow.ts` when the guard caught that duplication, and moved
 * again when `staff.ts` needed it and core cannot import from an app. Both moves
 * were the guard refusing a second allowlist entry, which is the guard working.
 */
export function shiftLocalDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${date}`);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

/**
 * Today as `YYYY-MM-DD` in a named timezone.
 *
 * Neither UTC nor "local" is correct here, and both were wrong in the first cut of
 * this file.
 *
 * New Zealand is 12 or 13 hours ahead of UTC, so `toISOString().slice(0, 10)` is
 * *yesterday* for the whole New Zealand morning — which put a child in the wrong
 * ratio band on their birthday, mis-dated a medication authority, and made the
 * enrolment form reject a baby born that morning as "in the future".
 *
 * And the device's own date is right on a tablet standing in the centre but wrong
 * in a Next server component, because the server runs in UTC. So the zone is a
 * parameter, and the caller passes the centre's own `timezone` where it has it.
 */
export function todayInZone(timeZone: string = NZ_TIMEZONE, now: Date = new Date()): string {
  try {
    // formatToParts rather than a locale that happens to format ISO-ish, so the
    // result does not depend on locale data quirks.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const [y, m, d] = [get('year'), get('month'), get('day')];
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* falls through */
  }
  // Last resort, not a default: a JS runtime without full ICU, or a zone name it
  // does not know. The device's own date is correct on a tablet in the centre and
  // a day out on a UTC server, which is still better than throwing while somebody
  // signs a child in.
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${iso}`);
  return { y, m, d };
}

/**
 * Whole months between two dates.
 *
 * Calendar arithmetic on the components rather than millisecond subtraction:
 * dividing by 30.44 days gets "23 months" for a child who turned two yesterday,
 * and that answer moves them into the wrong ratio band.
 */
export function ageInMonths(dateOfBirth: string, on: string = todayInZone()): number {
  const a = parts(dateOfBirth);
  const b = parts(on);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return months;
}

/**
 * The regulated divide. Under two is stricter on ratios and on space, and it
 * changes on the child's second birthday, not at the start of that term.
 *
 * The bands themselves belong to Phase 2; this is the one boundary the child
 * record needs in order to display correctly.
 */
export function isUnderTwo(dateOfBirth: string, on: string = todayInZone()): boolean {
  return ageInMonths(dateOfBirth, on) < 24;
}

/**
 * Age as staff say it out loud: months until two, then years and months.
 *
 * Nobody in an early learning centre describes an eighteen-month-old as "1y 6m".
 */
export function formatAge(dateOfBirth: string, on: string = todayInZone()): string {
  const months = ageInMonths(dateOfBirth, on);
  if (months < 0) return 'not yet born';
  if (months < 24) return months === 1 ? '1 month' : `${months} months`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m === 0 ? `${y} years` : `${y}y ${m}m`;
}

/** "Ana Test", or "Ana (Anahera) Test" when the preferred name is not the legal one. */
export function displayName(child: Pick<Child, 'firstName' | 'lastName' | 'preferredName'>): string {
  const preferred = child.preferredName?.trim();
  if (!preferred || preferred.toLowerCase() === child.firstName.toLowerCase()) {
    return `${child.firstName} ${child.lastName}`.trim();
  }
  return `${preferred} (${child.firstName}) ${child.lastName}`.trim();
}

/**
 * Two letters for the avatar circle on the roll and the child record.
 *
 * Built from the name parts, not from `displayName()` — that returns
 * "Ana (Anahera) Test", whose first two initials are "A" and "(", which is how a
 * roll ends up with a bracket in a circle.
 *
 * The preferred name wins, because the circle sits beside the name the child is
 * actually called. Falls back to one letter rather than padding with a placeholder:
 * a mononym is a real thing and "T?" is worse than "T".
 */
export function initials(child: Pick<Child, 'firstName' | 'lastName' | 'preferredName'>): string {
  const first = (child.preferredName?.trim() || child.firstName).trim();
  // `[...str]` not `charAt` — a name beginning with an astral character (an emoji is
  // unlikely, but a rare CJK extension glyph is not) would otherwise be cut in half
  // into an unpaired surrogate.
  const a = [...first][0] ?? '';
  const b = [...child.lastName.trim()][0] ?? '';
  return `${a}${b}`.toUpperCase();
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** `[1,2,3]` → "Mon, Tue, Wed". */
export function formatDays(days: number[]): string {
  if (days.length === 0) return 'No days set';
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d - 1] ?? '?')
    .join(', ');
}

/** Is this enrolment in force on the given date? */
export function isEnrolmentCurrent(e: Enrolment, on: string = todayInZone()): boolean {
  if (e.startDate > on) return false;
  return e.endDate === null || e.endDate >= on;
}
