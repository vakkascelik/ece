/**
 * Job applications.
 *
 * Two callers with almost nothing in common. `submitApplication` is called by the public
 * website holding the **anon** key and no session; everything else is called by the app
 * holding a manager's session, where the policy in 0024 confines it to that person's centres.
 *
 * WHY THE SUBMIT PATH IS AN RPC AND NOT AN INSERT
 *
 * `anon` has no grant on `job_applications` and must not get one — `scripts/security-review.ts`
 * check 8 fails the build at HIGH on any anon table grant. `submit_job_application` is a
 * SECURITY DEFINER function granted to `anon`, which is the whole of the public write surface.
 * The reasoning, including the two designs that were rejected, is in the migration.
 */

import type { ApplicationSource, ApplicationStatus } from '@ece/core';
import type { Db } from './index';

export interface JobApplication {
  id: string;
  centreId: string;
  applicantName: string;
  email: string;
  phone: string | null;
  positionSought: string | null;
  /** The applicant's own statement. Not evidence — that lives in `staff_records`. */
  holdsPractisingCertificate: boolean | null;
  availableFrom: string | null;
  message: string | null;
  source: ApplicationSource;
  status: ApplicationStatus;
  statusNote: string | null;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}

/*
 * One string literal, not a concatenation, and this matters rather than being a style rule.
 *
 * `supabase-js` parses the select list at the *type* level to work out the row shape. Two literals
 * joined with `+` are typed as plain `string`, the parser gives up, and the call comes back as
 * `GenericStringError[]` — which shows up as a cast error on the line below and says nothing about
 * the real cause. Every other module here uses one long line for the same reason.
 */
const COLUMNS =
  'id, centre_id, applicant_name, email, phone, position_sought, holds_practising_certificate, available_from, message, source, status, status_note, status_changed_by, status_changed_at, created_at';

interface Row {
  id: string;
  centre_id: string;
  applicant_name: string;
  email: string;
  phone: string | null;
  position_sought: string | null;
  holds_practising_certificate: boolean | null;
  available_from: string | null;
  message: string | null;
  source: ApplicationSource;
  status: ApplicationStatus;
  status_note: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
  created_at: string;
}

const toApplication = (r: Row): JobApplication => ({
  id: r.id,
  centreId: r.centre_id,
  applicantName: r.applicant_name,
  email: r.email,
  phone: r.phone,
  positionSought: r.position_sought,
  holdsPractisingCertificate: r.holds_practising_certificate,
  availableFrom: r.available_from,
  message: r.message,
  source: r.source,
  status: r.status,
  statusNote: r.status_note,
  statusChangedBy: r.status_changed_by,
  statusChangedAt: r.status_changed_at,
  createdAt: r.created_at,
});

/**
 * Applications for one centre, newest first.
 *
 * Bounded rather than unbounded. A two-site childcare service will not receive 500
 * applications, but "it will be small" is an assumption about the future and an unbounded
 * select is a page that gets slower until somebody notices. The cap is visible to the caller
 * so a screen can say it is showing part of a list rather than implying it is showing all.
 */
export async function listApplications(
  db: Db,
  centreId: string,
  options: { limit?: number } = {},
): Promise<JobApplication[]> {
  const limit = options.limit ?? 200;
  const { data, error } = await db
    .from('job_applications')
    .select(COLUMNS)
    .eq('centre_id', centreId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listApplications: ${error.message}`);
  return (data as Row[]).map(toApplication);
}

/**
 * Save an application's stage and note.
 *
 * `movedBy` IS THE WHOLE INTERFACE, and null is a meaningful value rather than an absence.
 *
 * The first version of this stamped `status_changed_by` and `status_changed_at` on every call,
 * which meant editing a note re-attributed the decision: Alice declines an applicant on the 1st,
 * Bob fixes a typo in the note on the 5th, and the row now says Bob declined them on the 5th. The
 * old values are unrecoverable from the product — `audit_trigger` records the changed column
 * *names* and no payload — which is precisely the question 0024's constraint exists to keep
 * answerable.
 *
 * So the caller passes the actor only when the stage actually moved, and null when it did not; on
 * null the two columns are left out of the patch entirely rather than written as null, which would
 * erase an earlier move and violate `job_applications_status_change_complete` besides. The caller
 * decides because this layer takes a `Db` and does not own the session or the previous row.
 */
export async function setApplicationStatus(
  db: Db,
  applicationId: string,
  input: { status: ApplicationStatus; note?: string | null; movedBy: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: input.status,
    // An empty textarea means "no note", not an empty note.
    status_note: input.note?.trim() ? input.note.trim() : null,
  };

  if (input.movedBy !== null) {
    // Both together: the constraint refuses half a record of who moved something.
    patch.status_changed_by = input.movedBy;
    patch.status_changed_at = new Date().toISOString();
  }

  const { data, error } = await db.from('job_applications').update(patch).eq('id', applicationId).select('id');
  if (error) throw new Error(`setApplicationStatus: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'setApplicationStatus: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

/**
 * Destroy one application.
 *
 * Granted deliberately, and the opposite of the decision on `waitlist` — a childcare service
 * has no reason to keep the contact details and employment history of somebody it did not
 * employ. The audit trigger records that a delete happened and keeps no copy of the row (0021
 * stores changed column names on update and nothing otherwise), so this really is removal.
 */
export async function deleteApplication(db: Db, applicationId: string): Promise<void> {
  const { data, error } = await db.from('job_applications').delete().eq('id', applicationId).select('id');
  if (error) throw new Error(`deleteApplication: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'deleteApplication: nothing was deleted. Either the id is wrong or the policy refused it.',
    );
  }
}

/**
 * Log an application that did not come through the website.
 *
 * CVs still arrive at the careers mailbox because there is no attachment path yet, and an
 * application that only exists in a mailbox is the problem this table was created to solve.
 * So staff can enter one, and `source` records that they did.
 */
export async function recordApplication(
  db: Db,
  input: {
    centreId: string;
    applicantName: string;
    email: string;
    phone?: string | null;
    positionSought?: string | null;
    holdsPractisingCertificate?: boolean | null;
    availableFrom?: string | null;
    message?: string | null;
    source: Exclude<ApplicationSource, 'website'>;
  },
): Promise<void> {
  const { error } = await db.from('job_applications').insert({
    centre_id: input.centreId,
    applicant_name: input.applicantName.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() || null,
    position_sought: input.positionSought?.trim() || null,
    holds_practising_certificate: input.holdsPractisingCertificate ?? null,
    available_from: input.availableFrom || null,
    message: input.message?.trim() || null,
    source: input.source,
  });
  if (error) throw new Error(`recordApplication: ${error.message}`);
}

/**
 * The public submission path. Called with the anon key, from the website's server.
 *
 * Returns nothing, and that is the contract rather than an oversight. The function returns
 * void in Postgres so an anonymous caller cannot learn whether a row was created — a repeat
 * submission while an application is open is a quiet no-op, because an error saying "you have
 * already applied" would tell anybody who asked whether a given address had applied here.
 *
 * A thrown error is therefore a real failure (validation, unknown centre, flood guard) and
 * never "already applied".
 */
export async function submitApplication(
  db: Db,
  input: {
    centreSlug: string;
    applicantName: string;
    email: string;
    phone?: string;
    positionSought?: string;
    holdsPractisingCertificate?: boolean | null;
    availableFrom?: string;
    message?: string;
  },
): Promise<void> {
  const { error } = await db.rpc('submit_job_application', {
    p_centre_slug: input.centreSlug,
    p_applicant_name: input.applicantName,
    p_email: input.email,
    p_phone: input.phone || null,
    p_position_sought: input.positionSought || null,
    p_holds_practising_certificate: input.holdsPractisingCertificate ?? null,
    // An empty string is not a date, and Postgres says so less clearly than this does.
    p_available_from: input.availableFrom || null,
    p_message: input.message || null,
  });
  if (error) throw new Error(`submitApplication: ${error.message}`);
}
