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
  /**
   * Centre policy, not a regulation. `true` makes the trigger in 0032 refuse a dose
   * with no witness. Defaults to false, because whether a second signature is
   * required has not been read out of the licensing criteria — unverified-claims 22.
   */
  medicationRequiresWitness: boolean;
  /**
   * Minutes between sleep checks, as stated by the centre. **`null` means the centre
   * has not stated one**, and that is not the same as zero or as a default: the
   * product then shows elapsed time and declines to call anything overdue. See
   * `sleep-checks.md` and unverified-claims 23.
   */
  sleepCheckMinutes: number | null;
  /**
   * Days between emergency drills, as stated by the centre. Null means none stated,
   * with the same contract as `sleepCheckMinutes` — the screen shows elapsed time and
   * declines to call anything late. unverified-claims 24.
   */
  drillIntervalDays: number | null;
  /**
   * Where the adult half of the ratio comes from. Defaults to `declared` so no
   * existing centre's history changes meaning on deploy, and never blends with the
   * other source — see 0040.
   */
  ratioSource: RatioSource;
  archivedAt: string | null;
}

export const RATIO_SOURCES = ['declared', 'derived'] as const;
export type RatioSource = (typeof RATIO_SOURCES)[number];

/**
 * `kiosk` is a device, not a person, and it is last on purpose.
 *
 * `CAPABILITIES` below lists roles per capability rather than capabilities per role,
 * so a role added here arrives holding **none** of them and `can()` answers false to
 * every question. That is the right default and it is structural rather than
 * remembered — the compiler would not have complained either way.
 *
 * The database says the same thing twice: `caller_person_centre_ids()` (0043) names
 * the four human roles as an allowlist, so a kiosk membership is worth nothing beyond
 * the centre's own name. Adding a role to this array without adding it there grants
 * nothing, which is the direction an omission should fail in.
 */
export const MEMBER_ROLES = ['owner', 'manager', 'educator', 'parent', 'kiosk'] as const;
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
  /**
   * Read and act on applications for employment.
   *
   * The same two roles as `manageMembers`, and a separate capability rather than a reuse of it,
   * because they are not the same question — one is "who has access to this centre", the other is
   * "who applied for a job here". An educator is excluded deliberately: an application holds a
   * stranger's personal details *and* the hiring process, and in a team of fifteen some of the
   * applicants are people the team knows. Enforced in Postgres by `job_applications_all`; this
   * only decides whether the nav link is drawn.
   */
  manageRecruitment: ['owner', 'manager'],
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
  /**
   * The centre this session is a door tablet for, or null for every person.
   *
   * Separate from `memberships` and not derivable from it, because 0043 narrowed
   * `memberships_select` to the four human roles — so a kiosk reads **zero**
   * membership rows and cannot be recognised by looking at that list. It is resolved
   * from `caller_kiosk_centre_id()` instead.
   *
   * That narrowing was right and its consequence was missed: without this field the
   * app saw an account with a session, one readable centre and no role, which
   * `requireCtx` answered by redirecting to `/select-centre` — a page that then
   * rendered "You have access to more than one" above a list of one, and bounced
   * back on every choice. See `kiosk-and-pins.md`.
   */
  kioskCentreId: string | null;
}

/** A device, not a person. Holds no capability and belongs on no `(app)` page. */
export function isKiosk(session: Session): boolean {
  return session.kioskCentreId !== null;
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

// The same arithmetic run forwards, over bookings and shifts instead of events. It
// inherits RATIO_TABLES_VERIFIED from `ratios` and says so.
export * from './ratioForecast';

// Quiet hours and the te reo vocabulary whanau read.
export * from './notifications';

// Attendance to hours to funded hours. Nothing here estimates — see the files.
export * from './hours';

// Ageing what is owed. The money is a view; the calendar arithmetic is here, where it
// can be tested — the same split `ratios.ts` makes.
export * from './arrears';

// CSV for people who will open it in Excel: a BOM so macrons survive, and a guard
// against a cell that begins with '='.
export * from './csv';
export * from './funding';

// Applications for employment. The one vocabulary shared with the public website, which
// depends on this package and on nothing else in the monorepo.
export * from './recruitment';

// The daily registers — incidents, medicine given, sleep checks. Nothing in here reads
// a clock: `now` is a parameter, because both things it decides are time-relative.
export * from './registers';

// The Phase 9 registers — drills, hazards, safety checks, visitors, excursions and
// immunisation. Grouped by phase rather than by table: the boundary that matters is
// in the policies, not in the arithmetic.
export * from './facilities';

// Staff as people: the roster, who is signed in, and the certificate count that
// states a fact and never a funding consequence.
export * from './staff';

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
export { classifyWriteFailure, type WriteFailure } from './writeFailure';
export { describeSignOut, type QueueSnapshot, type SignOutVerdict } from './signOut';
