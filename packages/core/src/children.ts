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

/**
 * Whether an enrolment is permanent, casual or conditional — and the whole of absence
 * funding turns on it.
 *
 * Source: ECE Funding Handbook §6-4, read from the Ministry's page on 2026-09-03. Its own
 * words are *"permanently enrolled child"*, *"casual"* and *"conditional"*, with
 * *"conditional or casual child"* as the combined term. The rule that makes this column
 * necessary: *"Funding for conditional or casual children is based on attendance only.
 * Services must not claim for conditional or casual children who book for a session or day
 * and do not attend."*
 *
 * **AND THE GLOSSARY DEFINITIONS, READ 2026-09-04, ARE MUCH MORE SPECIFIC THAN THE WORDS
 * SUGGEST.** Worth having here, because two of the three turn on *licensed capacity* rather
 * than on how regularly a child attends, which is not what "casual" and "conditional" imply
 * in ordinary use:
 *
 *   - **Enrolment record** — *"The formal written agreement between a parent or guardian and a
 *     service that a specific child will attend that service **at specified times**."* Those
 *     specified times are `child_booking_schedule` (0085); the definition is the clearest
 *     corroboration that the agreement needed to be a pattern with times.
 *   - **Permanent** — *"Enrolments that are **within the service's licensed maximum number of
 *     child places** and where the child is **entitled to attend for the enrolled hours** on a
 *     regular, ongoing basis."*
 *   - **Casual** — *"Enrolments for children who will not be attending a service on a regular,
 *     ongoing basis."*
 *   - **Conditional** — *"Enrolments of children who are on a **waiting list** and that are
 *     **above** the service's licensed maximum number of child-places."*
 *
 * So "conditional" does not mean *provisional*: it means **over capacity**. That is why §6-4
 * funds those children on attendance only — the service is not licensed for the place they
 * would otherwise occupy. And "permanent" carries a capacity condition too, so a service
 * cannot have more permanent enrolments than licensed places.
 *
 * **Nothing in this product enforces either capacity condition**, and it now holds the
 * denominator to check them (`centres.licensed_places`, 0050). Recorded as a gap rather than
 * built, because refusing an enrolment on a figure the centre may not have stated would be the
 * occupancy report's problem all over again. unverified-claims item 57.
 *
 * **Back to §6-4's consequence for this product**, which the block above interrupts rather than
 * replaces. Funded hours from attendance events alone are **exactly right** for a casual or
 * conditional child and **under-claim** for a permanent one, who may be claimed for absences
 * under §6-5, §6-6 and §6-7.
 *
 * **That is now a statement about attendance-only arithmetic, not about what this product does —
 * clarified 2026-09-05.** Since 2026-09-04 a permanently enrolled child with a recorded
 * `child_booking_schedule` is funded from the **agreement** with the absence rules applied, and
 * `hoursBasis` in `./funding` names which of four sources produced each figure. The sentence above
 * describes the fallback that applies when no schedule is recorded, which is where the under-claim
 * still lives.
 *
 * NOT AN ELI FIELD. Worth saying because it is the natural place to look and it is not
 * there: `ChildEnrolment` in the schema carries the two entity ids, a primary and optional
 * secondary residential address, and the start and end dates — and **no enrolment type
 * element at all** (checked against the XSD, 2026-09-03). This is a funding concept used to
 * compute the counts correctly; it is never serialised.
 */
export const ENROLMENT_TYPES = ['permanent', 'casual', 'conditional'] as const;
export type EnrolmentType = (typeof ENROLMENT_TYPES)[number];

/** What a person sees. */
export const ENROLMENT_TYPE_LABELS: Record<EnrolmentType, string> = {
  permanent: 'Permanent',
  casual: 'Casual',
  conditional: 'Conditional',
};

/**
 * Where a child lives — the two addresses the ELI schema allows.
 *
 * Structured rather than free text, and the reason is the schema rather than tidiness:
 * `ChildEnrolmentAddress` requires `Address1Line` and `AddressCity` as **separate** elements, so a
 * single free-text field could not be serialised without splitting a New Zealand address by
 * guesswork. See `0086`, and note `guardians.address` stays free text because it never goes on the
 * wire.
 *
 * The three optional fields are `string | null` rather than `string | undefined` because the columns
 * are nullable and a read site should have to acknowledge "not recorded" rather than find the key
 * missing. What the *wire* does with a missing value is a boundary decision and not this type's
 * business: those elements are `nillable`, so a serialiser may either omit them or send `xsi:nil`.
 *
 * `saveChildAddress` stores null for an optional field left blank, so an empty box and an untouched
 * one are the same fact. That is a decision rather than an accident — storing `''` would put a
 * present-but-empty element on a Crown return, which is the same class of defect as the blank
 * required field the database refuses outright.
 */
export const ADDRESS_KINDS = ['primary', 'secondary'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

/** What a person sees. `primary` is the one `ChildEnrolment` requires. */
export const ADDRESS_KIND_LABELS: Record<AddressKind, string> = {
  primary: 'Home address',
  secondary: 'Second household',
};

export interface ChildAddress {
  id: string;
  childId: string;
  kind: AddressKind;
  /** `Address1Line`. Required by the schema, and a blank one is refused by the database. */
  address1Line: string;
  address2Line: string | null;
  /** `AddressCity`. Required, same as line 1. */
  addressCity: string;
  addressCountry: string | null;
  addressPostCode: string | null;
}

/** The schema's `String100` bound, enforced in the database and re-checked on the form. */
export const ADDRESS_FIELD_MAX = 100;

/**
 * That somebody looked at a document proving who a child is — `child_identity_documents` (0097).
 *
 * **A LIST, NOT A SLOT**, which is the one structural difference from `ChildAddress` above. An
 * address has two named kinds and `(child_id, kind)` is its identity; a sighting is an *act*, and
 * re-sighting a document next year is a second act by a second person rather than a correction of
 * the first. So `id` is the identity here, many rows per child are normal, and the history is the
 * point — `AST28` asks whether an identification document is present, and an answer that overwrote
 * last year's check could not say who verified it or when.
 *
 * **THE DOCUMENT NUMBER IS DELIBERATELY ABSENT**, and 0097 argues it at length: a practising
 * certificate number is a professional registration, a child's passport number is not, and whether
 * the NSI interface transmits one is in a specification nobody here holds. Recording that a
 * passport was sighted is the evidence; recording the passport number is a decision that needs a
 * source.
 *
 * `sightedBy` and `sightedAt` are a pair or neither — 0011's rule in 0011's words, *"a timestamp
 * with nobody attached is not evidence"*, enforced by a CHECK rather than by convention.
 */
export interface ChildIdentityDocument {
  id: string;
  childId: string;
  /**
   * The document type. **A `LookupCode` from the NSI specification, which nobody here has read**,
   * so it is free text bounded at ten characters with no enumeration and no foreign key —
   * `code_sets` reserves the domain and ships it empty. Null means the kind was not stated, which
   * is different from a blank string and is why the column is nullable rather than defaulted.
   */
  kind: string | null;
  /** Who looked at it. Null only when nothing has been sighted — see the pairing rule above. */
  sightedBy: string | null;
  sightedAt: string | null;
  note: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

/** `kind` is a `LookupCode`: 1–10 characters. The database bounds it; the form says so first. */
export const IDENTITY_DOCUMENT_KIND_MAX = 10;

export interface Enrolment {
  id: string;
  childId: string;
  centreId: string;
  startDate: string;
  /** Null means open-ended, which is the normal state of an enrolled child. */
  endDate: string | null;
  fundedHoursPerWeek: number;
  twentyHoursEce: boolean;
  /**
   * permanent, casual or conditional. **Null means not stated, and it is not
   * `permanent`** - absence funding may only be claimed for a permanently enrolled
   * child (Handbook 6-4), so defaulting an unknown to permanent would over-claim.
   * See 0084.
   */
  enrolmentType: EnrolmentType | null;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  notes: string | null;

  /*
    THE REST OF WHAT FUNDING HANDBOOK §6-1 REQUIRES AN ENROLMENT RECORD TO CONTAIN.

    All five arrived as columns before they arrived here: `0084` added the 20 Hours attestation
    pair, `0087` the other-service hours and the record signature, and neither commit had a
    reader. That is why every one of them is `| null` rather than optional — "not recorded" is a
    state a screen has to render and a readiness check has to count, and an absent key cannot
    be counted.
  */

  /**
   * The date the 20 Hours ECE attestation was made, and which guardian made it (`0084`,
   * reference corrected by `0087`). Paired by a CHECK: a date with nobody against it is
   * refused, because in an audit it reads as though somebody attested and the name was lost.
   *
   * `twentyHoursAttestedBy` is a `guardians.id`, **not** a user id. The attestation is signed
   * by a parent, who may have no account at all.
   */
  twentyHoursAttestedOn: string | null;
  twentyHoursAttestedBy: string | null;

  /**
   * Hours per week the child is enrolled at ANOTHER service, attested by a parent (`0087`).
   *
   * **Null is not zero.** §6-1 wants the figure *"including none if appropriate"*, so
   * "attested as none" and "nobody has asked" are different answers and only one of them is a
   * complete record.
   *
   * It matters beyond the paperwork: the 6-hour daily and 30-hour weekly caps follow the
   * CHILD, so a child at two services can exceed them between the two, and this product
   * applies both caps as though each service were the only one. It is also unenforceable from
   * here — an enrolment at another provider is invisible to this database — which is why the
   * Handbook asks the parent rather than the service.
   */
  hoursAtOtherServicePerWeek: number | null;

  /**
   * The dated signature §6-1 item 5 asks for: *"a dated signature of at least one
   * parent/guardian to attest to the accuracy of the enrolment record"*. The record as a
   * whole, which is why the other-service hours above have no signature of their own.
   *
   * `signedBy` is a `guardians.id`, and a trigger requires it to be a current guardian of that
   * child — a foreign key alone would accept another centre's parent.
   */
  signedOn: string | null;
  signedBy: string | null;

  /**
   * The date a family gave notice that the child will not be returning, and which guardian gave
   * it (`0093`).
   *
   * §6-5 stops absence funding from this date — *"even if the three week period has not
   * ended"* — and the Ministry recovers anything claimed after it. `classifyAbsences` takes it
   * and refuses every session from that date on.
   *
   * **NOT `endDate`.** Notice comes first: a family says in March that the child is leaving at
   * Easter, so the notice date is in March and the end date is in April, and between them the
   * enrolment is still current while no absence may be claimed. The end date may also be absent
   * entirely while notice has been given, which is the ordinary case and precisely the one §6-5
   * is written for.
   *
   * This is the only field in this product whose absence made a funding figure too **high**.
   */
  noticeGivenOn: string | null;
  noticeGivenBy: string | null;
}

/**
 * Which of §6-1's required contents this enrolment record is still missing.
 *
 * Returns labels rather than booleans because the only useful thing to do with the answer is
 * show it to somebody: an enrolment that cannot be completed is not a complete enrolment, and
 * "incomplete" without saying which part is not actionable.
 *
 * DELIBERATELY NOT A PERCENTAGE OR A SCORE. Every item here is required, so four missing
 * fields is not "80% complete" — it is a record that does not meet §6-1. An empty array is the
 * only passing state.
 *
 * THE ADDRESS IS NOT CHECKED HERE even though §6-1 requires it, and that is not an oversight:
 * it lives on `child_addresses` keyed to the child rather than to the enrolment, so a caller
 * holding only an enrolment row cannot answer for it. `AddressPanel` reports it where it lives.
 */
export function enrolmentRecordGaps(e: Enrolment): string[] {
  const gaps: string[] = [];
  if (e.enrolmentType === null) gaps.push('the enrolment type');
  if (e.days.length === 0) gaps.push('the days attending');
  if (e.hoursAtOtherServicePerWeek === null) gaps.push('the hours at another service');
  if (e.signedOn === null) gaps.push('a dated parent signature');
  /*
    NOTICE IS DELIBERATELY NOT A GAP. Most children have not been given notice, and listing it
    as missing would report a gap on every complete record — the fastest way to teach somebody
    that this list is noise. §6-1 does not ask for it either; it is a §6-5 event, not a record
    field, and it belongs on this row only because that is where the enrolment lives.
  */
  /*
    Only when the service is actually claiming it. A centre not claiming 20 Hours has nothing
    to attest, and reporting a missing attestation there would be a gap the service cannot
    close — which is exactly what teaches people to ignore a readiness list.
  */
  if (e.twentyHoursEce && e.twentyHoursAttestedOn === null) {
    gaps.push('the 20 Hours attestation');
  }
  return gaps;
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

/** One record that the centre asked a named guardian for a named decision. See 0073. */
export interface ConsentRequest {
  kind: ConsentKind;
  guardianId: string;
  requestedAt: string;
  note: string | null;
}

/**
 * Where one consent decision has got to.
 *
 * `consentFor` distinguishes "answered" from "never asked", and its comment is emphatic
 * about why. This is that distinction carried one level further: **"never asked" and
 * "asked, and they have not answered" are also completely different facts**, and until
 * 0073 nothing here could tell them apart. A reviewer asking "have you sought photo
 * consent" got identical silence from a centre that had asked three times and one that had
 * never opened the page.
 *
 * `awaiting` is not a worse `unasked`. It is the centre having done its part.
 */
export type ConsentProgress =
  | { kind: ConsentKind; state: 'answered'; granted: boolean; at: string }
  | { kind: ConsentKind; state: 'awaiting'; requestedAt: string }
  | { kind: ConsentKind; state: 'unasked' };

/**
 * Progress per kind, newest ask winning when a family has been chased more than once.
 *
 * Answered beats asked in every case, including the order they arrived in: a decision
 * recorded before the most recent request still answers it. The alternative — treating a
 * later ask as reopening a settled question — would show a family as owing an answer they
 * have already given, which is how a product nags somebody into ignoring it.
 */
export function consentProgress(
  consents: ConsentState[],
  requests: ConsentRequest[],
  kinds: readonly ConsentKind[] = REQUIRED_CONSENTS,
): ConsentProgress[] {
  return kinds.map((kind) => {
    const answer = consentFor(consents, kind);
    if (answer) return { kind, state: 'answered', granted: answer.granted, at: answer.at };

    const asks = requests.filter((r) => r.kind === kind);
    if (asks.length === 0) return { kind, state: 'unasked' };

    const latest = asks.reduce((a, b) => (a.requestedAt >= b.requestedAt ? a : b));
    return { kind, state: 'awaiting', requestedAt: latest.requestedAt };
  });
}

/*
  There is deliberately no `awaitingAnswer(consents, requests)` here.

  It was written and removed: filtering `consentProgress` to everything not answered returns
  exactly `missingConsents(consents)`, because a kind is unanswered whether or not anybody was
  asked. A second name for the same list is how two screens end up disagreeing about one
  number after somebody edits one of them.

  Worth recording *why* the parent's own list is "unanswered by anybody" rather than
  "unanswered by this guardian": `current_consents` is `distinct on (child_id, kind) order by
  at desc`, so the latest event wins regardless of which guardian recorded it. A decision one
  parent has made counts as made. Asking per guardian would ask both parents for everything
  twice and would contradict what the centre's own screens report.
*/

/**
 * Required kinds nobody has answered *and* nobody has been asked for.
 *
 * The office's list, and narrower than `missingConsents` on purpose — that one counts
 * everything unanswered, which is the right number for "is this enrolment finished". This
 * one is "what have we not even done our part on", which is the only list a centre can act
 * on without waiting for somebody else.
 */
export function unaskedConsents(
  consents: ConsentState[],
  requests: ConsentRequest[],
): ConsentKind[] {
  return consentProgress(consents, requests)
    .filter((p) => p.state === 'unasked')
    .map((p) => p.kind);
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
