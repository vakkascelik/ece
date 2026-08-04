/**
 * @ece/core — types and rules shared by the web app and the mobile app.
 *
 * Nothing in here may import from `next`, `react-native`, or any Node built-in.
 * Both apps depend on it, and the mobile bundle cannot resolve Node modules.
 * If something needs the filesystem or a server, it belongs in the web app.
 */

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

/** A licensed early learning service. The tenant. */
export interface Centre {
  id: string;
  name: string;
  /** Ministry of Education service number, e.g. "46365". */
  moeServiceNumber: string | null;
  slug: string;
  timezone: string;
  archivedAt: string | null;
}

export const MEMBER_ROLES = ['owner', 'manager', 'educator', 'parent'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Membership {
  id: string;
  centreId: string;
  userId: string;
  role: MemberRole;
  revokedAt: string | null;
}

/**
 * Role capabilities, in one place.
 *
 * Deliberately not the security boundary — that is Row Level Security in
 * Postgres. This exists so the UI can hide what a user cannot do, which is a
 * usability concern. Anything enforced only here is not enforced: the mobile
 * app is a client and a client can be modified.
 */
export const CAPABILITIES = {
  /** Add, remove or change who has access to a centre. */
  manageMembers: ['owner', 'manager'],
  /** Change the centre's own record. */
  manageCentre: ['owner', 'manager'],
  /** Record attendance, observations, daily notes. */
  recordDailyPractice: ['owner', 'manager', 'educator'],
  /** See a child's full record including health notes. */
  viewChildRecord: ['owner', 'manager', 'educator'],
  /** See only their own children. */
  viewOwnChildren: ['owner', 'manager', 'educator', 'parent'],
  /** Enrol a child, edit their record, edit whānau details. Office work. */
  manageChildren: ['owner', 'manager'],
  /** File and amend enrolments — funded hours, days, start and end dates. */
  manageEnrolment: ['owner', 'manager'],
  /**
   * Record an allergy or condition. Educators included on purpose: something
   * disclosed at the door at 8am has to be writable by the person who was told.
   */
  recordHealth: ['owner', 'manager', 'educator'],
  /**
   * Read custody arrangements and court orders.
   *
   * Owner and manager only, and never a parent — a custody arrangement is a record
   * ABOUT the guardians, so it must not be readable BY them. An educator needs to
   * know a child must not leave with a named adult, which is the collection list,
   * not the terms of a parenting order.
   */
  viewCustody: ['owner', 'manager'],
  /** Record a consent decision. A parent may record their own; staff transcribe forms. */
  recordConsent: ['owner', 'manager', 'educator', 'parent'],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: MemberRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[capability] as readonly MemberRole[]).includes(role);
}

/**
 * The caller's active tenant.
 *
 * A person can belong to several centres — a manager of a two-site operator, or
 * a parent with children at two services — so "which centre am I looking at"
 * is explicit state, never inferred. Inferring it is how somebody posts a
 * notice to the wrong centre.
 */
export interface Session {
  userId: string;
  memberships: Membership[];
  activeCentreId: string | null;
}

export function activeRole(session: Session): MemberRole | null {
  if (!session.activeCentreId) return null;
  return (
    session.memberships.find(
      (m) => m.centreId === session.activeCentreId && !m.revokedAt,
    )?.role ?? null
  );
}

export function activeMemberships(session: Session): Membership[] {
  return session.memberships.filter((m) => !m.revokedAt);
}

// ---------------------------------------------------------------------------
// Domain vocabulary
// ---------------------------------------------------------------------------

/**
 * New Zealand English throughout, and Ministry terminology where it exists.
 *
 * "Enrolment", not "enrollment". "Whānau", not "family", in anything a parent
 * reads. Ministry documents say "service", not "centre", when they mean the
 * licensed entity — but staff say "centre", so the UI says centre and the data
 * model records the service number.
 */
export const TERMS = {
  enrolment: 'enrolment',
  whanau: 'whānau',
  educator: 'educator',
} as const;

// ---------------------------------------------------------------------------
// Children, whānau, enrolment, health and consent
// ---------------------------------------------------------------------------

export * from './children';

// Regulated ratios. The bands are unverified data with citations — see the file.
export * from './ratios';

// Merging server state with an offline queue. Pure, and tested.
export * from './roll';

// Compliance record-keeping and ratio history. No regulation text — see the files.
export * from './compliance';
export * from './ratioHistory';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
//
// Exported from the package root so the mobile theme can read them. The web app
// still restates them in `globals.css`, which is a duplication with a deadline on
// it — Phase 0's remaining task is to generate the Tailwind config from here so
// there is one source for both.

export * from './tokens';
export * from './contrast';
