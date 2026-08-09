'use server';

import { revalidatePath } from 'next/cache';
import { deleteEnquiry, setEnquiryStatus, ENQUIRY_STATUSES, type EnquiryStatus } from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

/**
 * Move an enquiry along.
 *
 * The status is validated against the vocabulary rather than trusted, for the reason the
 * ratio-source setting records: a value outside the enum silently coerced is a quiet way
 * of recording something nobody chose.
 *
 * `enrolled` is just a status here. **Promoting an enquiry to a real child record is not
 * done by this screen and there is no function that does it** — 0052 refuses to automate
 * the moment a stranger's claim becomes the centre's record about a child.
 */
export async function moveEnquiry(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const id = String(form.get('id') ?? '').trim();
  const statusRaw = String(form.get('status') ?? '').trim();
  if (!id) return { error: 'Which enquiry?' };

  const status = (ENQUIRY_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as EnquiryStatus)
    : null;
  if (!status) return { error: 'That is not a status we track.' };

  try {
    await setEnquiryStatus(db, { id, status, movedBy: ctx.userId });
  } catch (e) {
    return actionError(e, 'enquiries.move');
  }

  revalidatePath('/enquiries');
  return { ok: true };
}

/**
 * Remove an enquiry outright.
 *
 * Granted where `waitlist` refuses it. This table is written by unauthenticated strangers,
 * so it accumulates spam and mistakes about named families, and a centre that cannot delete
 * one is stuck holding personal information it never asked for — IPP 9 says do not keep
 * what is not needed. The delete is audited, and afterwards that audit row is the only
 * evidence the enquiry existed.
 */
export async function removeEnquiry(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = String(form.get('id') ?? '').trim();
  if (!id) return { error: 'Which enquiry?' };

  try {
    await deleteEnquiry(db, id);
  } catch (e) {
    return actionError(e, 'enquiries.remove');
  }

  revalidatePath('/enquiries');
  return { ok: true };
}
