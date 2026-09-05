'use server';

import { revalidatePath } from 'next/cache';
import {
  addOffFloorInterval,
  createShift,
  deleteOffFloorInterval,
  recordLeave,
  setLeaveStatus,
  setShiftStatus,
} from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;

/**
 * Roster somebody on.
 *
 * `manageMembers`, matching 0041's `caller_may_roster` — the roster decides the
 * forecast and the forecast is a compliance figure. The policy is the real boundary;
 * this is the courtesy that produces a sentence instead of a Postgres error.
 */
export async function addShift(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageMembers');
  const db = await serverDb();

  const staffMemberId = str(form, 'staffMemberId');
  const onDate = str(form, 'onDate');
  const fromTime = str(form, 'fromTime');
  const toTime = str(form, 'toTime');

  if (!staffMemberId) return { error: 'Who is on?' };
  if (!ISO_DATE.test(onDate)) return { error: 'Which day?' };
  if (!CLOCK.test(fromTime) || !CLOCK.test(toTime)) return { error: 'What hours?' };
  if (toTime <= fromTime) return { error: 'The shift has to end after it starts.' };

  try {
    await createShift(db, {
      staffMemberId,
      onDate,
      fromTime,
      toTime,
      roleNote: str(form, 'roleNote') || null,
    });
  } catch (e) {
    /*
      The exclusion constraint in 0041 is the one refusal worth translating. Postgres
      says `conflicting key value violates exclusion constraint "shifts_no_overlap"`,
      which is true and tells a manager nothing about what to do — and this is the
      error they will actually hit, because rostering the same person twice is an
      ordinary slip rather than an attack.
    */
    if (e instanceof Error && e.message.includes('shifts_no_overlap')) {
      return { error: 'They are already rostered over some of those hours. Cancel that shift first.' };
    }
    return actionError(e, 'roster.addShift');
  }

  revalidatePath('/roster');
  return { ok: true };
}

/** Cancel a shift. Not a delete — 0041 withholds the verb from everybody. */
export async function cancelShift(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageMembers');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which shift?' };

  try {
    await setShiftStatus(db, id, 'cancelled');
  } catch (e) {
    return actionError(e, 'roster.cancelShift');
  }

  revalidatePath('/roster');
  return { ok: true };
}

/**
 * Record leave.
 *
 * Defaults to `approved` when a manager enters it, because the person entering it is
 * the person who approves it. A request that arrives some other way is still
 * `requested` until somebody decides, and only approved leave moves the forecast.
 */
export async function addLeave(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageMembers');
  const db = await serverDb();

  const staffMemberId = str(form, 'staffMemberId');
  const fromDate = str(form, 'fromDate');
  const toDate = str(form, 'toDate');
  const kind = str(form, 'kind');

  if (!staffMemberId) return { error: 'Who is away?' };
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) return { error: 'Which days?' };
  if (toDate < fromDate) return { error: 'Leave cannot end before it starts.' };
  if (kind !== 'annual' && kind !== 'sick' && kind !== 'unpaid' && kind !== 'other') {
    return { error: 'What kind of leave?' };
  }

  try {
    await recordLeave(db, {
      staffMemberId,
      fromDate,
      toDate,
      kind,
      status: 'approved',
      note: str(form, 'note') || null,
    });
  } catch (e) {
    return actionError(e, 'roster.addLeave');
  }

  revalidatePath('/roster');
  return { ok: true };
}

/**
 * Withdraw leave by declining it.
 *
 * The same shape as cancelling a shift, and for the same reason: somebody who booked
 * a week off and then came in is a fact about the roster, and a row that vanishes
 * cannot explain why the forecast changed on Tuesday.
 */
export async function declineLeave(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageMembers');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which leave?' };

  try {
    await setLeaveStatus(db, id, 'declined');
  } catch (e) {
    return actionError(e, 'roster.declineLeave');
  }

  revalidatePath('/roster');
  return { ok: true };
}

/*
  OFF-FLOOR INTERVALS — 0094, and the third write path AST50's mapping table found missing.

  §9-4 wants staff hours "at times when they were counted towards regulated (ratio) staff". This
  records the exceptions and two things subtract them: the RS7 staff figures, and
  `adults_present_now` since 0095. Nothing could write the table until now, so nothing was ever
  subtracted and an adult at lunch went on counting towards the ratio.

  `manageMembers`, matching 0094's `caller_may_roster` — the same courtesy the shift actions above
  give, for the same reason: the policy is the real boundary and this produces a sentence instead
  of a Postgres error.
*/
export async function addOffFloor(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageMembers');
  const db = await serverDb();

  const staffMemberId = str(form, 'staffMemberId');
  const onDate = str(form, 'onDate');
  const fromTime = str(form, 'fromTime');
  const toTime = str(form, 'toTime');

  if (!staffMemberId) return { error: 'Choose who was off the floor.' };
  if (!ISO_DATE.test(onDate)) return { error: 'Give the date.' };
  if (!CLOCK.test(fromTime) || !CLOCK.test(toTime)) {
    return { error: 'Give a start and end time, as HH:MM.' };
  }
  if (toTime <= fromTime) return { error: 'The end time has to be after the start time.' };

  try {
    await addOffFloorInterval(db, {
      staffMemberId,
      onDate,
      fromTime,
      toTime,
      reason: str(form, 'reason') || null,
    });
  } catch (e) {
    // `addOffFloorInterval` already turns the overlap into a sentence about the same half hour
    // being subtracted twice, so this passes it through rather than replacing it.
    return actionError(e, 'roster.addOffFloor');
  }
  revalidatePath('/roster');
  return { ok: true };
}

export async function removeOffFloor(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageMembers');
  const db = await serverDb();

  const id = str(form, 'intervalId');
  if (!id) return { error: 'Missing interval.' };

  try {
    await deleteOffFloorInterval(db, id);
  } catch (e) {
    return actionError(e, 'roster.removeOffFloor');
  }
  revalidatePath('/roster');
  return { ok: true };
}
