/**
 * The public enrolment enquiry, validated the same way in three places.
 *
 * The database's CHECK constraints are the thing that actually holds; the function in 0054
 * restates them so a caller who is not the form gets a sentence rather than a constraint
 * violation; and this restates them once more so the form can say it next to the field.
 * Three copies is the price of a readable error — the same arrangement `applicationProblem`
 * documents for the careers form, and `0027` exists because a version of it once covered
 * three fields out of six.
 */

export const ENQUIRY_LIMITS = {
  contactName: 200,
  email: 320,
  phone: 40,
  message: 4000,
} as const;

export interface EnquiryInput {
  contactName: string;
  email: string;
  phone?: string;
  message?: string;
  wantedFrom?: string;
}

/**
 * The first problem with an enquiry, phrased for the person who typed it, or null.
 *
 * Deliberately does **not** validate a child's name or a date of birth, because the form
 * does not ask for either — see `AGE_BANDS` in `@ece/api/enquiries` and 0054. If a future
 * version of this function grows a `childName` branch, that is the signal that somebody has
 * reopened a decision the site's enrolment page and `tenant-little-pearls.md` already made.
 */
export function enquiryProblem(input: EnquiryInput): string | null {
  const name = input.contactName.trim();
  if (name.length === 0) return 'Please tell us your name.';
  if (name.length > ENQUIRY_LIMITS.contactName) return 'That name is too long for our records.';

  const email = input.email.trim();
  // `indexOf` rather than a pattern, mirroring the database's `position('@' in email) > 1`.
  // A stricter regex here than the constraint means a form that rejects addresses the table
  // would have accepted, and deliverability is not something a regex can decide.
  if (email.indexOf('@') < 1 || email.length < 3) {
    return 'Please give an email address we can reply to.';
  }
  if (email.length > ENQUIRY_LIMITS.email) return 'That email address is too long.';

  if ((input.phone ?? '').length > ENQUIRY_LIMITS.phone) return 'That phone number is too long.';
  if ((input.message ?? '').length > ENQUIRY_LIMITS.message) {
    return 'Please keep the message under 4000 characters.';
  }

  /*
    A start date in the past is almost always a typo — a year mistyped, or last year's
    calendar. Refused with a sentence rather than stored, because the office would otherwise
    read it as a family wanting a place that has already been and gone.

    Compared as strings, which works because both sides are ISO `YYYY-MM-DD` and is the only
    comparison here that cannot pick up a timezone. `new Date('2026-01-01')` is midnight UTC,
    and this repo has now fixed that class of bug three times.
  */
  const wanted = (input.wantedFrom ?? '').trim();
  if (wanted) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return 'That start date is not a date.';
  }

  return null;
}

/**
 * Whether a wanted-from date is in the past, given the centre's today.
 *
 * Separate from `enquiryProblem` because "today" is not a fact a pure validator has — the
 * caller resolves it in the centre's timezone and passes it in. Every other date decision
 * in this product is arranged the same way, for the reason `todayInZone` records.
 */
export function isPastDate(wantedFrom: string, today: string): boolean {
  return wantedFrom.length === 10 && wantedFrom < today;
}
