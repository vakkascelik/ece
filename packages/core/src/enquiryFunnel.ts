/**
 * How enquiries become enrolments — and the one thing this schema cannot tell it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A "WAITLIST CONVERSION RATE"
 *
 * `enrolment_applications.status` (0052/0054) is a **current** state, not a history:
 * `new → contacted → waitlisted → enrolled`, and once a row reaches `enrolled` it no
 * longer says `waitlisted` — the fact that it passed through that stage is gone. So a
 * strict "of everyone who was waitlisted, how many enrolled" cannot be answered from this
 * table, only "of everyone who enquired, how many enrolled" — which is what this
 * summarises. The office screen at `/enquiries` shows the current status of a live row;
 * this shows the funnel across all of them, and says which of the two questions it is
 * answering rather than letting the name imply the wrong one.
 *
 * The office's own `waitlist` table (0018) is a separate, older path for enquiries taken
 * by phone rather than the public form. It has no UI and nothing in this product writes
 * to it today, so it is not counted here — a report folding in a table nobody can see or
 * populate would be asserting a queue that structurally cannot exist yet.
 */

export const ENQUIRY_STATUSES = [
  'new',
  'contacted',
  'waitlisted',
  'enrolled',
  'declined',
  'withdrawn',
] as const;
/**
 * Restated rather than imported: `@ece/core` has no dependency on `@ece/api`, by design —
 * see the header of `index.ts`. `@ece/api/enquiries` exports the same six values as
 * `ENQUIRY_STATUSES`; an `Enquiry` from there structurally satisfies `{ status: EnquiryStatus }`
 * below without either package depending on the other.
 */
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface EnquiryFunnel {
  total: number;
  /** Still in progress — no outcome yet, so excluded from the conversion rate below. */
  open: { new: number; contacted: number; waitlisted: number };
  /** Reached an outcome. */
  resolved: { enrolled: number; declined: number; withdrawn: number };
  resolvedTotal: number;
  /**
   * `enrolled / resolvedTotal`, as a percentage to one decimal, or **null** when nothing
   * has been resolved yet — the same shape `averageChildren` uses in `occupancy.ts` and
   * for the same reason: `0` reads as "every enquiry is failing" when the true state is
   * "nobody has been contacted back yet", and a manager would act on the wrong one.
   */
  conversionRate: number | null;
}

export function summariseEnquiryFunnel(
  enquiries: readonly { status: EnquiryStatus }[],
): EnquiryFunnel {
  const count = (status: EnquiryStatus) => enquiries.filter((e) => e.status === status).length;

  const open = {
    new: count('new'),
    contacted: count('contacted'),
    waitlisted: count('waitlisted'),
  };
  const resolved = {
    enrolled: count('enrolled'),
    declined: count('declined'),
    withdrawn: count('withdrawn'),
  };
  const resolvedTotal = resolved.enrolled + resolved.declined + resolved.withdrawn;

  return {
    total: enquiries.length,
    open,
    resolved,
    resolvedTotal,
    conversionRate:
      resolvedTotal === 0 ? null : Math.round((resolved.enrolled / resolvedTotal) * 1000) / 10,
  };
}
