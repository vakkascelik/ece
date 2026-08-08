'use server';

import { revalidatePath } from 'next/cache';
import { createStaffMember, recordStaffAttendance, updateStaffMember } from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Add somebody to the roster.
 *
 * `manageMembers` rather than `recordDailyPractice`, matching the policy in 0038:
 * adding a person changes the denominator of the ratio, which is an administrative
 * act. Signing them in is not, and is open to any staff member below.
 */
export async function addStaffMember(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageMembers');
  const db = await serverDb();

  const fullName = str(form, 'fullName');
  const startedOn = str(form, 'startedOn');
  if (fullName.length < 2) return { error: 'What is their name?' };
  if (startedOn && !ISO_DATE.test(startedOn)) return { error: 'That start date is not a date.' };

  try {
    await createStaffMember(db, {
      centreId: ctx.centre.id,
      fullName,
      roleNote: str(form, 'roleNote') || null,
      startedOn: startedOn || null,
      // Deliberately not offered on this form. Linking a person to a login is its own
      // act with its own consequence — `unique (centre_id, user_id)` means getting it
      // wrong makes "who is signed in" ambiguous — so it belongs beside the member
      // list, not buried in an add form somebody fills in at speed.
      userId: null,
    });
  } catch (e) {
    return actionError(e, 'staff.addStaffMember');
  }

  revalidatePath('/staff');
  return { ok: true };
}

/** Record that somebody has left. Not a delete: 0038 withholds the verb from everybody. */
export async function endEmployment(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageMembers');
  const db = await serverDb();

  const id = str(form, 'id');
  const finishedOn = str(form, 'finishedOn');
  if (!id) return { error: 'Which person?' };
  if (!ISO_DATE.test(finishedOn)) return { error: 'What was their last day?' };

  try {
    await updateStaffMember(db, id, { finishedOn });
  } catch (e) {
    return actionError(e, 'staff.endEmployment');
  }

  revalidatePath('/staff');
  // The ratio denominator changes, and the roll reads it.
  revalidatePath('/attendance');
  void ctx;
  return { ok: true };
}

/**
 * Sign somebody in or out.
 *
 * Any staff member, for any colleague — the policy in 0039 allows it and the reason
 * is the reliever: a manager signs in the person who has no account, and a door
 * tablet signs in the team arriving together. `recorded_by` still pins the event to
 * whoever tapped.
 *
 * The time comes from here rather than from a field, as with every other register:
 * the record is when somebody arrived.
 */
export async function signStaff(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const staffMemberId = str(form, 'staffMemberId');
  const kind = str(form, 'kind');
  const clientUuid = str(form, 'clientUuid');

  if (!staffMemberId) return { error: 'Which person?' };
  if (kind !== 'in' && kind !== 'out') return { error: 'In or out?' };
  if (!clientUuid) return { error: 'The page did not finish loading. Reload and try again.' };

  try {
    const result = await recordStaffAttendance(db, {
      staffMemberId,
      kind,
      at: new Date().toISOString(),
      clientUuid,
    });
    /*
      A duplicate means this exact event already landed. Not an error, and never shown
      as one — the same reasoning as a medicine dose: somebody told the write failed
      taps again, and here that would produce a second event nobody made.
    */
    if (result.outcome === 'duplicate') {
      revalidatePath('/staff');
      return { ok: true };
    }
  } catch (e) {
    return actionError(e, 'staff.signStaff');
  }

  revalidatePath('/staff');
  // A derived centre computes the ratio from these events, so the roll is now stale.
  revalidatePath('/attendance');
  return { ok: true };
}
