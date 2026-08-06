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
  // `actorId` rather than letting the query layer read a session it does not own — @ece/api takes
  // a `Db` and nothing else, which is what lets the same functions serve a script.
  await setApplicationStatus(db, applicationId, { status, note, actorId: ctx.userId });
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
 * The confirmation is in the button, not here: `ApplicationRow` makes Delete a two-press control
 * rather than opening a dialogue. A `window.confirm` cannot guard a server action at all, and this
 * app has no modal component — a second press is honest about being a real deletion without
 * inventing one.
 */
export async function remove(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await requireCapability('manageRecruitment');
  const applicationId = String(form.get('applicationId') ?? '');

  const target = await ownApplication(ctx.centre.id, applicationId);
  if (!target) return { error: 'That application is not at this centre.' };

  const db = await serverDb();
  await deleteApplication(db, applicationId);
  revalidatePath('/applications');
  return { ok: true };
}
