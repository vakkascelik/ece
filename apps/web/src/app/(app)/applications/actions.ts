'use server';

import { revalidatePath } from 'next/cache';
import { deleteApplication, listApplications, setApplicationStatus } from '@ece/api';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type ActionResult = { error: string } | { ok: true } | null;

/**
 * Acting on an application.
 *
 * Both actions re-derive the caller's context and then confirm the id belongs to the caller's own
 * centre before touching it. RLS enforces that too — `job_applications_all` carries both USING and
 * WITH CHECK, and the RLS suite asserts that another centre's owner cannot decline this centre's
 * applicant — but a server action that acts on an unverified id is a habit that outlives whichever
 * table still has good policies. Same reasoning as `members/actions.ts`.
 */
async function ownApplication(centreId: string, applicationId: string) {
  const db = await serverDb();
  const applications = await listApplications(db, centreId);
  return applications.find((a) => a.id === applicationId) ?? null;
}

export async function changeStatus(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await requireCapability('manageRecruitment');
  const applicationId = String(form.get('applicationId') ?? '');
  const status = String(form.get('status') ?? '') as ApplicationStatus;
  const note = String(form.get('note') ?? '');

  if (!APPLICATION_STATUSES.includes(status)) return { error: 'Unknown status.' };

  const target = await ownApplication(ctx.centre.id, applicationId);
  if (!target) return { error: 'That application is not at this centre.' };

  const db = await serverDb();
  /*
   * The stage and the note share one Save button, so most saves change only the note — and the
   * select posts its unchanged `defaultValue` alongside it. Stamping the actor unconditionally
   * therefore re-attributed the decision to whoever last fixed a typo.
   *
   * `target.status` is the stored value, already fetched by the ownership check above. Passing
   * null leaves `status_changed_by`/`_at` untouched. Same shape as `members/actions.ts`, which
   * branches on `target.role` for the same reason.
   */
  await setApplicationStatus(db, applicationId, {
    status,
    note,
    movedBy: status === target.status ? null : ctx.userId,
  });
  revalidatePath('/applications');
  return { ok: true };
}

/**
 * Destroy an application.
 *
 * The only screen in this product with a real delete, and it is deliberate: a service has no
 * reason to hold the contact details and employment history of somebody it did not employ, and
 * that person may reasonably ask for them to be gone. The audit log records that a deletion
 * happened and keeps no copy of the row, which is asserted in `rls_isolation.sql` — so "we removed
 * your application" is a true sentence rather than a comforting one.
 *
 * THE CONFIRMATION IS ENFORCED HERE, not only in the button.
 *
 * `ApplicationRow` makes Delete a two-press control, and the first version did that entirely in a
 * React `onSubmit` — so the guard did not exist until the page had hydrated. With JavaScript off, or
 * in the window before the bundle runs, the first press deleted somebody's application outright. A
 * progressively-enhanced form is exactly the case this app is built for: the roll works without JS
 * on purpose.
 *
 * So the armed state is a form field, and this action refuses unless it is set. The client still
 * flips it without a round trip when hydrated; without JS the first press posts `armed=""`, gets
 * refused, and the server re-renders the armed button. Same two presses either way.
 *
 * A `window.confirm` was never an option — it cannot guard a server action at all.
 */
export async function remove(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await requireCapability('manageRecruitment');
  const applicationId = String(form.get('applicationId') ?? '');

  const target = await ownApplication(ctx.centre.id, applicationId);
  if (!target) return { error: 'That application is not at this centre.' };

  if (String(form.get('armed') ?? '') !== 'yes') {
    // Not an error the person did anything wrong — the message is what the button will say next.
    return { error: `Press delete again to remove ${target.applicantName} permanently.` };
  }

  const db = await serverDb();
  await deleteApplication(db, applicationId);
  revalidatePath('/applications');
  return { ok: true };
}
