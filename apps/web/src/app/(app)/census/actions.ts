'use server';

import { revalidatePath } from 'next/cache';
import {
  addContactHours,
  deleteContactHours,
  endContactHours,
  saveCensusDetails,
  type CensusDetailsPatch,
} from '@ece/api';
import {
  AGE_TAUGHT_MAX_MONTHS,
  LEAVING_DESTINATION_CODES,
  STAFF_AGE_BANDS,
  STAFF_ROLE_KINDS,
} from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * A form field that has three states, not two.
 *
 * `''` means "not recorded" and must become `null`, because a checkbox cannot express
 * the difference between "unpaid" and "nobody has said". `0081` makes every one of
 * these columns nullable for exactly this reason, and defaulting a blank to `false`
 * here would put a wrong figure in a Crown return while the screen reported the person
 * complete.
 */
function triState(f: FormData, k: string): boolean | null {
  const v = str(f, k);
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

/** A number field, where blank is null and a non-number is a refusal rather than a zero. */
function months(f: FormData, k: string): { value: number | null } | { error: string } {
  const v = str(f, k);
  if (v === '') return { value: null };
  if (!/^\d{1,2}$/.test(v)) return { error: 'The ages taught are a whole number of months.' };
  const n = Number(v);
  if (n < 0 || n > AGE_TAUGHT_MAX_MONTHS) {
    return { error: `The ages taught run from 0 to ${AGE_TAUGHT_MAX_MONTHS} months.` };
  }
  return { value: n };
}

/**
 * Record or amend one person's census details.
 *
 * `manageCentre` rather than a new capability of its own. The role set would be
 * identical — owner and manager, matching `caller_may_roster` in `0081` — and a
 * capability only decides whether a link is drawn; Postgres is what refuses. Adding one
 * would be configurability nobody asked for. The reason `manageRecruitment` *is*
 * separate is that its exclusion of educators rests on different reasoning, and this
 * does not.
 *
 * **The code fields are deliberately absent from this action**, not merely disabled in
 * the form. Gender, staff role, qualification, playcentre qualification, ethnicity and
 * iwi are all unenumerated `LookupCode` values whose published lists this repo has not
 * obtained, so `0080` ships empty. A text input for them would let somebody type an
 * invented code into a return, and a server action that accepted one would make the
 * disabled input the only thing stopping them — which is the shape of every
 * client-side-only guard this repo refuses.
 */
export async function saveCensusRow(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const staffMemberId = str(form, 'staffMemberId');
  if (!staffMemberId) return { error: 'Which person?' };

  const roleKind = str(form, 'roleKind');
  if (roleKind && !(STAFF_ROLE_KINDS as readonly string[]).includes(roleKind)) {
    return { error: 'That is not one of the role kinds the Ministry defines.' };
  }

  const ageBand = str(form, 'ageBand');
  if (ageBand && !(STAFF_AGE_BANDS as readonly string[]).includes(ageBand)) {
    return { error: 'That is not one of the age bands the Ministry defines.' };
  }

  const leaving = str(form, 'leavingDestinationCode');
  if (leaving && !(LEAVING_DESTINATION_CODES as readonly string[]).includes(leaving)) {
    return { error: 'That is not one of the leaving destinations the Ministry defines.' };
  }

  const min = months(form, 'minAgeTaughtMonths');
  if ('error' in min) return { error: min.error };
  const max = months(form, 'maxAgeTaughtMonths');
  if ('error' in max) return { error: max.error };
  if (min.value !== null && max.value !== null && max.value < min.value) {
    return { error: 'The oldest age taught cannot be younger than the youngest.' };
  }

  const patch: CensusDetailsPatch = {
    roleKind: roleKind || null,
    ageBand: ageBand || null,
    leavingDestinationCode: leaving || null,
    isPaid: triState(form, 'isPaid'),
    isPermanent: triState(form, 'isPermanent'),
    isFullTime: triState(form, 'isFullTime'),
    previouslyWorkedAsTeacher: triState(form, 'previouslyWorkedAsTeacher'),
    arrivedFromAnotherService: triState(form, 'arrivedFromAnotherService'),
    minAgeTaughtMonths: min.value,
    maxAgeTaughtMonths: max.value,
  };

  try {
    await saveCensusDetails(db, staffMemberId, patch, ctx.userId);
  } catch (e) {
    return actionError(e, 'census.saveCensusRow');
  }

  revalidatePath('/census');
  return { ok: true };
}

/** Add a contracted block of contact hours. */
export async function addHoursBlock(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const staffMemberId = str(form, 'staffMemberId');
  const weekday = Number(str(form, 'weekday'));
  const fromTime = str(form, 'fromTime');
  const toTime = str(form, 'toTime');
  const effectiveFrom = str(form, 'effectiveFrom');

  if (!staffMemberId) return { error: 'Which person?' };
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: 'Which day?' };
  if (!TIME.test(fromTime) || !TIME.test(toTime)) return { error: 'Those are not times.' };
  if (toTime <= fromTime) return { error: 'The end has to be after the start.' };
  if (!ISO_DATE.test(effectiveFrom)) return { error: 'When do these hours start applying?' };

  try {
    await addContactHours(db, { staffMemberId, weekday, fromTime, toTime, effectiveFrom }, ctx.userId);
  } catch (e) {
    // `addContactHours` turns the exclusion violation into a sentence that says to end
    // the existing block first, because `23P01` on its own reads as a duplicate.
    return actionError(e, 'census.addHoursBlock');
  }

  revalidatePath('/census');
  return { ok: true };
}

/** Close an open-ended block. The first half of superseding contracted hours. */
export async function endHoursBlock(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = str(form, 'id');
  const effectiveTo = str(form, 'effectiveTo');
  if (!id) return { error: 'Which block?' };
  if (!ISO_DATE.test(effectiveTo)) return { error: 'What was the last day these hours applied?' };

  try {
    await endContactHours(db, id, effectiveTo);
  } catch (e) {
    return actionError(e, 'census.endHoursBlock');
  }

  revalidatePath('/census');
  return { ok: true };
}

/** Remove a block entered in error. */
export async function removeHoursBlock(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which block?' };

  try {
    await deleteContactHours(db, id);
  } catch (e) {
    return actionError(e, 'census.removeHoursBlock');
  }

  revalidatePath('/census');
  return { ok: true };
}
