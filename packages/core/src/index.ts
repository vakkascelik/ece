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
   * Children this service is licensed for, as stated by the centre. Null means not
   * stated, with the same contract as the two above — the occupancy report then shows
   * the attendance counts, which are real, and declines to compute a percentage of a
   * denominator nobody gave. See 0050.
   */
  licensedPlaces: number | null;
  /**
   * Where the adult half of the ratio comes from. Defaults to `declared` so no
   * existing centre's history changes meaning on deploy, and never blends with the
   * other source — see 0040.
   */
  ratioSource: RatioSource;
  /**
   * Whether this centre permits data being sent to an external model provider.
   *
   * Defaults to false and stays there until somebody at the centre turns it on — the
   * same contract as `ratioSource`, for a sharper reason: a feature that enables itself
   * for a childcare centre is one that gets discovered by a parent.
   *
   * Necessary for every model-backed feature and sufficient for none that send text a
   * person typed — those need a recorded consent as well. See `docs/claude-api-plan.md`.
   */
  aiFeatures: boolean;
  /**
   * The licence this service holds. Null means not stated, and nothing guesses — see 0083.
   *
   * A guess here would select a ratio schedule, and being wrong about that is being wrong
   * about how many adults a room needs.
   */
  licenceType: LicenceType | null;
  /**
   * How this service operates. Null means not stated, same contract. See 0083.
   *
   * Separate from `licenceType` because they are different facts: a kindergarten and a
   * full-day education-and-care centre hold the same licence and run differently. This is
   * the axis the RS7 advance-month counts ask about and the axis Schedule 2 distinguishes.
   */
  serviceModel: ServiceModel | null;
  archivedAt: string | null;
}

export const RATIO_SOURCES = ['declared', 'derived'] as const;
export type RatioSource = (typeof RATIO_SOURCES)[number];

/**
 * The three licensed early childhood service types.
 *
 * Source: Ministry of Education, *"Licences to operate in early childhood education and
 * care"*, read 2026-09-03. It names exactly these three and says playgroups "are not
 * licensed, but they can choose to be certified".
 *
 * **AND THE MINISTRY CONTRADICTS ITSELF, WHICH IS WHY THIS COMMENT IS LONG.** Its
 * regulatory-framework page, read the same day, names *four* licensed types — centre-based
 * (folding in kindergartens, playcentres, education and care, puna reo, reo rua),
 * home-based, hospital-based, and **Te Kōhanga Reo as its own**. The two pages disagree on
 * granularity and on whether kōhanga reo is a separate licence.
 *
 * The licensing page wins here because it is the page about licences. That is a judgement,
 * not a verification, and [[unverified-claims]] item 51 stays OPEN for it: a column
 * existing does not make a classification checked. If a service says it holds a kōhanga reo
 * licence, extend this list in a migration citing what they said — do **not** file them
 * under education and care because the CHECK refused them.
 *
 * These are values in a CHECK constraint rather than a `code_sets` domain because they are
 * not an unenumerated Ministry `LookupCode`. Same standing as `RATIO_SOURCES`.
 */
export const LICENCE_TYPES = ['education_and_care', 'home_based', 'hospital_based'] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

/** What a person sees. The stored values are snake_case; these are not. */
export const LICENCE_TYPE_LABELS: Record<LicenceType, string> = {
  education_and_care: 'Education and care service',
  home_based: 'Home-based service',
  hospital_based: 'Hospital-based service',
};

/**
 * How a service operates, and this one has a better source than the licence types do.
 *
 * These three come from the ELI schema itself: `RS7AdvanceMonthCounts` enumerates
 * `AllDayDaysCount`, `SessionalDaysCount` and `ParentLedDaysCount`. Retrieved from
 * `https://eli.minedu.govt.nz/eli.xsd` on 2026-09-03.
 *
 * Worth stating why that is stronger than a web page: the element names **are** the
 * classification the Ministry's own machine-readable contract uses, not somebody's
 * description of one. It is also the axis Schedule 2 turns on — the all-day and sessional
 * tables differ for the 2-and-over band — so one column serves the return and the ratio
 * schedule both.
 *
 * What it does not settle is which model a licence implies. That is a fact about the
 * service, so the service states it.
 */
export const SERVICE_MODELS = ['all_day', 'sessional', 'parent_led'] as const;
export type ServiceModel = (typeof SERVICE_MODELS)[number];

/** What a person sees. */
export const SERVICE_MODEL_LABELS: Record<ServiceModel, string> = {
  all_day: 'All-day',
  sessional: 'Sessional',
  parent_led: 'Parent-led',
};

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
  /**
   * Send an emergency broadcast. The same two roles `broadcast_emergency` (0057) checks in
   * Postgres — listed here only so the send form is never drawn for a role the database
   * would refuse, never as the thing that actually stops them.
   */
  broadcastEmergency: ['owner', 'manager'],
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

/* The product's own name and mark, so the website, the rail and the favicon cannot
   draw three slightly different logos. See brand.ts. */
export * from './brand';

export * from './children';

// Days the service did not operate (0088). Its own module because it is about to have
// three consumers - the absence rules, RS7's operating-day counts, and the occupancy
// average - and none of them owns it.
export * from './closures';

// Which enrolled-but-absent sessions may be claimed (6-4, 6-5, 6-6, 7-7). Deliberately not
// wired into `childFunding` yet - it classifies, nothing consumes it, and no published figure
// moves. See the module header.
export * from './absence';

// Regulated ratios. The bands are unverified data with citations — see the file.
export * from './ratios';

// Merging server state with an offline queue. Pure, and tested.
export * from './roll';

// Compliance record-keeping and ratio history. No regulation text — see the files.
export * from './compliance';
export * from './ratioHistory';

// The same arithmetic run forwards, over bookings and shifts instead of events. It
// inherits RATIO_TABLES_VERIFIED from `ratios` and says so — verified since 2026-08-18,
// which changes the value and not the wiring.
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

// The boundary between this product and an external model provider. An allowlist, not
// a scrubber — see the file, and privacy-statement.md for the rule it implements.
export * from './redaction';

// What a model call costs and when to stop making them. Pure, so the cap is testable
// without a key — see the note on the price list being unverified.
export * from './modelSpend';

// Invoices in the shape Xero imports. Pure, so the column set is testable without
// an accounting system — which is the only way it can be tested at all.
export * from './xero';

// How full the centre has been, and the branch for when it cannot say — the licence
// is null until somebody types it in, and null is a result rather than a zero.
export * from './occupancy';

// The same attendance, bucketed into weeks and weekdays instead of days — a trend
// rather than a log. No new query; arithmetic on what occupancy.ts already reads.
export * from './attendanceTrend';

// Whether a family has signed off that attendance, per ECE Funding Handbook 6-3. Derived
// from append-only signatures rather than stored on the week — which is what lets it say
// an approval has gone stale, a state a status column cannot express.
export * from './attendanceVerification';

// The scheduler's one decision, made pure: who is asked to confirm a week this run,
// under the three-per-period and one-per-calendar-week rules. The runner holding the
// service key executes this plan and judges nothing itself.
export * from './verificationChase';

// The public enrolment enquiry. Validated here, in the SQL function, and by the table —
// three copies, which is the price of an error a person can read.
export * from './enquiry';

// How enquiries become enrolments, and the one question the schema cannot answer —
// see the file for why this is not a strict "waitlist conversion rate".
export * from './enquiryFunnel';
export * from './funding';

/**
 * The RS7 return's daily counts. Kept separate from `./funding` because it must NOT reuse
 * `toHours` — that floors, and §9-2 rounds to nearest. See the file header and item 52.
 */
/*
  The two month helpers, named explicitly rather than `export * from './weekdayBlock'`.

  That module's other exports already reach the package through `census.ts`, which re-exports the
  four it needs, and a blanket star here would collide with them. Two names is the smaller thing
  than rearranging a working re-export to suit a third consumer.
*/
export { lastDayOf, nextMonth } from './weekdayBlock';

export * from './rs7';
export * from './staffHours';

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

// Rooms, tasks and checklists — the 1Place replacement. Grouped by phase, the same
// choice facilities.ts makes. Note what is NOT exported: no riskBand(), because no
// banding of a likelihood x consequence score is sourced anywhere in this repo.
export * from './worklist';

// Staff as people: the roster, who is signed in, and the certificate count that
// states a fact and never a funding consequence.
export * from './staff';

// The annual ECE Return's staffing section, and what is missing from it. Note what
// this exports and what it does not: the value domains the ELI schema actually
// enumerates — role kinds, age bands, weekday codes, leaving destinations — and no
// ethnicity, iwi, language, staff role or qualification code at all, because the
// schema types those as an unenumerated LookupCode and they belong in `code_sets`,
// imported from a published list with its source recorded. AGENTS.md §7.
export * from './census';

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
