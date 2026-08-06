/**
 * Job applications — the vocabulary, and the validation the public form and the database
 * both apply.
 *
 * Platform-free on purpose, like everything in this package: the careers form on the public
 * website and the staff screen in the app are different apps with different dependencies,
 * and this is the only thing they share.
 */

export const APPLICATION_STATUSES = [
  'new',
  'reviewing',
  'interview',
  'offered',
  'hired',
  'declined',
  'withdrawn',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  interview: 'At interview',
  offered: 'Offered',
  hired: 'Hired',
  // "Declined" is the centre's decision and "Withdrawn" is the applicant's. Separate words
  // because a list that renders both as "Closed" loses the only part anybody later asks about.
  declined: 'Declined',
  withdrawn: 'Withdrawn by applicant',
};

/**
 * The statuses that count as still open.
 *
 * **This list is duplicated in `supabase/migrations/0024_recruitment.sql`**, inside
 * `submit_job_application`, where it decides whether a repeat submission is a duplicate of a
 * live application or a fresh application from somebody previously declined. It cannot be
 * shared — one is SQL running before there is a session, the other is TypeScript. So it is
 * named here, named there, and pinned by a test, which is the most that can be done about it.
 */
export const OPEN_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'new',
  'reviewing',
  'interview',
  'offered',
];

export function isOpenApplication(status: ApplicationStatus): boolean {
  return OPEN_APPLICATION_STATUSES.includes(status);
}

export const APPLICATION_SOURCES = ['website', 'email', 'walk_in', 'referral', 'other'] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const APPLICATION_SOURCE_LABELS: Record<ApplicationSource, string> = {
  website: 'Website',
  email: 'Email',
  walk_in: 'In person',
  referral: 'Referral',
  other: 'Other',
};

/*
 * There is deliberately no colour or tone mapping for a status.
 *
 * The state chips in this product mean one thing — how far a compliance figure is from being
 * a problem — and `color.warn` is the amber a centre learns to read as "a certificate is about
 * to expire". A hiring stage is not that. Rendering "Declined" in warning amber would say the
 * centre is at risk because it did not hire somebody, and rendering "New" in green would say
 * an unopened application is fine. Both are meanings this product would be inventing.
 */

/**
 * The field limits. The same numbers appear as check constraints on `job_applications`, and
 * the table is the one that actually holds — this exists so a person gets a sentence instead
 * of a constraint violation.
 */
export const APPLICATION_LIMITS = {
  name: 200,
  email: 320,
  phone: 40,
  position: 120,
  message: 4000,
} as const;

export interface ApplicationInput {
  applicantName: string;
  email: string;
  phone?: string;
  positionSought?: string;
  availableFrom?: string;
  message?: string;
}

/** `YYYY-MM-DD`, and a date that exists. `2026-02-31` parses as a number triple and is not a day. */
function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  // Read by index rather than destructured: `noUncheckedIndexedAccess` types the elements of a
  // destructured array as possibly undefined, and `Number()` narrows to a number here because the
  // anchored pattern above has already guaranteed three groups of digits.
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);

  if (m < 1 || m > 12 || d < 1) return false;
  // Day 0 of the next month is the last day of this one, which is how February gets 29 in a leap
  // year without this function knowing what a leap year is.
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * One problem at a time, as a sentence, or null when the input is fine.
 *
 * Returns the first problem rather than a list, matching `passwordProblem` in the web app —
 * a form that reports six failures at once is a form nobody reads. The order is the order the
 * fields appear.
 */
export function applicationProblem(input: ApplicationInput): string | null {
  const name = input.applicantName.trim();
  if (name.length === 0) return 'Please tell us your name.';
  if (name.length > APPLICATION_LIMITS.name) return 'That name is too long for our records.';

  const email = input.email.trim();
  // `indexOf` rather than a pattern: this mirrors the database's `position('@' in email) > 1`,
  // and a stricter regex here than the constraint means a form that rejects addresses the
  // table would have accepted. Deliverability is not something a regex can decide.
  if (email.indexOf('@') < 1 || email.length < 3) return 'Please give an email address we can reply to.';
  if (email.length > APPLICATION_LIMITS.email) return 'That email address is too long.';

  if ((input.phone ?? '').length > APPLICATION_LIMITS.phone) return 'That phone number is too long.';
  if ((input.positionSought ?? '').length > APPLICATION_LIMITS.position) {
    return 'Please keep the role to a few words.';
  }

  const from = (input.availableFrom ?? '').trim();
  if (from.length > 0 && !isIsoDate(from)) return 'Please give your earliest start date as a real date.';

  if ((input.message ?? '').length > APPLICATION_LIMITS.message) {
    return `Please keep your message under ${APPLICATION_LIMITS.message} characters.`;
  }

  return null;
}
