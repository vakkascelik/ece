/**
 * Enrolment enquiries: the public write, and the office's queue.
 *
 * Its own module rather than a section of `billing.ts` or `children.ts`, because
 * `apps/site` maps a **narrow import path** to it — the same arrangement
 * `@ece/api/recruitment` has. The marketing site deliberately cannot reach the whole API
 * surface, and a public form importing the module that also holds invoicing would quietly
 * undo that.
 *
 * No tenant filtering, as everywhere here. `enrolment_applications_select` restricts reads
 * to owners and managers of the centre.
 */

import { fetchAll } from './paging';
import type { Db } from './index';

/**
 * How old the child is, coarsely.
 *
 * **Not a date of birth, and this is the whole design.** `apps/site`'s enrolment page has
 * held the decision since the site was built — a public enquiry collects the guardian's
 * details and a coarse band, never a child's name or date of birth — and
 * `docs/tenant-little-pearls.md` holds this deployment to zero personal information until
 * indemnity insurance is in place. 0052 shipped a required child name against that; 0054
 * corrected it.
 *
 * `expecting` is a real case rather than a courtesy: families join waitlists before the
 * child is born.
 */
export const AGE_BANDS = ['expecting', 'under-2', '2-and-over'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  expecting: 'Not born yet',
  'under-2': 'Under 2',
  '2-and-over': '2 or over',
};

export const ENQUIRY_STATUSES = [
  'new',
  'contacted',
  'waitlisted',
  'enrolled',
  'declined',
  'withdrawn',
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface Enquiry {
  id: string;
  centreId: string;
  contactName: string;
  email: string;
  phone: string | null;
  /** Optional and the public form never sends one — see `AGE_BANDS`. */
  childName: string | null;
  childAgeBand: AgeBand | null;
  wantedFrom: string | null;
  wantedDays: number[] | null;
  message: string | null;
  status: EnquiryStatus;
  movedBy: string | null;
  movedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  centre_id: string;
  contact_name: string;
  email: string;
  phone: string | null;
  child_name: string | null;
  child_age_band: AgeBand | null;
  wanted_from: string | null;
  wanted_days: number[] | null;
  message: string | null;
  status: EnquiryStatus;
  moved_by: string | null;
  moved_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, centre_id, contact_name, email, phone, child_name, child_age_band, wanted_from, wanted_days, message, status, moved_by, moved_at, created_at';

const toEnquiry = (r: Row): Enquiry => ({
  id: r.id,
  centreId: r.centre_id,
  contactName: r.contact_name,
  email: r.email,
  phone: r.phone,
  childName: r.child_name,
  childAgeBand: r.child_age_band,
  wantedFrom: r.wanted_from,
  wantedDays: r.wanted_days,
  message: r.message,
  status: r.status,
  movedBy: r.moved_by,
  movedAt: r.moved_at,
  createdAt: r.created_at,
});

/**
 * File an enquiry from the public form.
 *
 * Called with the **anon** client, without a session. Everything that makes that safe is
 * in `submit_enrolment_application` (0052/0054) rather than here: it resolves the centre
 * from a slug so a forged call cannot choose a tenant, returns void so it discloses
 * nothing, is rate-limited per centre, and is idempotent per (email, band) while an
 * enquiry is open.
 *
 * There is deliberately no `listEnquiries` counterpart reachable from the site. The anon
 * key has no grant on the table at all.
 */
export async function submitEnquiry(
  db: Db,
  input: {
    centreSlug: string;
    contactName: string;
    email: string;
    childAgeBand?: AgeBand | null;
    phone?: string;
    wantedFrom?: string;
    wantedDays?: number[] | null;
    message?: string;
  },
): Promise<void> {
  const { error } = await db.rpc('submit_enrolment_application', {
    p_centre_slug: input.centreSlug,
    p_contact_name: input.contactName,
    p_email: input.email,
    p_child_age_band: input.childAgeBand ?? null,
    p_phone: input.phone || null,
    // An empty string is not a date, and Postgres says so less clearly than this does.
    p_wanted_from: input.wantedFrom || null,
    p_wanted_days: input.wantedDays && input.wantedDays.length > 0 ? input.wantedDays : null,
    p_message: input.message || null,
  });
  if (error) throw new Error(`submitEnquiry: ${error.message}`);
}

/**
 * The office's queue, newest first.
 *
 * Paged. The bound is not structural: this table is written by unauthenticated strangers,
 * so its row count is a function of how much spam arrives rather than of how many families
 * there are. The rate limit caps the rate, not the total.
 */
export async function listEnquiries(db: Db, centreId: string): Promise<Enquiry[]> {
  const rows = await fetchAll<Row>('listEnquiries', (a, b) =>
    db
      .from('enrolment_applications')
      .select(COLUMNS)
      .eq('centre_id', centreId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(a, b),
  );
  return rows.map(toEnquiry);
}

/**
 * Move an enquiry along.
 *
 * `movedBy`/`movedAt` are set together — the CHECK in 0052 refuses one without the other,
 * so a row cannot claim somebody acted without saying when.
 */
export async function setEnquiryStatus(
  db: Db,
  input: { id: string; status: EnquiryStatus; movedBy: string },
): Promise<void> {
  const { error } = await db
    .from('enrolment_applications')
    .update({
      status: input.status,
      moved_by: input.movedBy,
      moved_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .select('id');
  if (error) throw new Error(`setEnquiryStatus: ${error.message}`);
}

/**
 * Remove an enquiry outright.
 *
 * Granted here where `waitlist` refuses it, because this table is written by strangers and
 * accumulates spam about named families. IPP 9: do not keep what is not needed, and
 * "needed" for a duplicate is zero. The delete is audited, and afterwards that audit row is
 * the only evidence the enquiry existed.
 */
export async function deleteEnquiry(db: Db, id: string): Promise<void> {
  const { error } = await db.from('enrolment_applications').delete().eq('id', id);
  if (error) throw new Error(`deleteEnquiry: ${error.message}`);
}
