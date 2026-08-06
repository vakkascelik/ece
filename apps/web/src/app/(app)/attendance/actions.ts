'use server';

/**
 * Attendance corrections and the adult count, from the web.
 *
 * CORRECTION, 2026-08-06. This file used to hold the sign-in and sign-out actions, and this
 * comment used to explain that the browser "is not queuing it through an outbox" and had "no
 * offline gap to preserve, unlike on a tablet". Both halves were wrong about the product: the
 * web app is what runs on the tablet bolted to the wall by the door, and it lost every sign-in
 * made while the wifi was down.
 *
 * Sign-in and sign-out now go through `lib/outbox.ts`, which owns the `clientUuid` for the same
 * reason the mobile outbox does — it is generated once at enqueue and reused across retries,
 * which is what makes a retry a no-op instead of a second sign-in.
 *
 * What stays here is what is genuinely a desk action. A **correction** is made by somebody who
 * has noticed a mistake and must give a reason; queueing it would buy nothing and cost a class
 * of "which correction won" questions. The **adult count** is one number for the whole centre
 * rather than a per-child event, so a stale queued copy would fight the server's rather than
 * merge with it. Both are online-only on purpose.
 */

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { correctAttendance, listAttendanceForChild, recordAdultsPresent } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { actionError } from '@/lib/actionError';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

/**
 * Fix a time that was recorded wrongly.
 *
 * Appends a correcting event rather than editing. The original stays, because after
 * an incident the question is what was recorded at the time — and because the
 * database has no UPDATE path for this table anyway.
 */
export async function correct(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const eventId = Number(str(form, 'eventId'));
  const kind = str(form, 'kind') === 'out' ? 'out' : 'in';
  const time = str(form, 'at');
  const note = str(form, 'note');

  if (!childId || !Number.isFinite(eventId)) return { error: 'Missing event.' };
  if (!time) return { error: 'What time should it have been?' };
  if (note.length < 3) return { error: 'Say why it is being corrected.' };

  // A time input gives HH:MM with no date, so it is anchored to today in the
  // browser's clock. Read back as a local Date and sent as an instant.
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return { error: 'That is not a time.' };

  try {
    await correctAttendance(db, {
      childId,
      kind,
      at: at.toISOString(),
      clientUuid: randomUUID(),
      corrects: eventId,
      note,
    });
  } catch (e) {
    return actionError(e, 'attendance.correct');
  }

  revalidatePath('/attendance');
  return { ok: true };
}

/**
 * Record how many adults are present.
 *
 * Not a preference and not a display setting — it is half of the ratio, so it is
 * recorded as an event with a time and an author. See 0010 for why it is not a cookie.
 */
export async function setAdults(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const adults = Number(str(form, 'adults'));
  if (!Number.isFinite(adults) || adults < 0 || adults > 200) {
    return { error: 'That is not a plausible number of adults.' };
  }

  try {
    await recordAdultsPresent(db, {
      centreId: ctx.centre.id,
      adults,
      clientUuid: randomUUID(),
      note: str(form, 'note') || null,
    });
  } catch (e) {
    return actionError(e, 'attendance.setAdults');
  }

  revalidatePath('/attendance');
  return { ok: true };
}

/** Today's events for one child, for the correction UI. */
export async function historyFor(childId: string) {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return listAttendanceForChild(db, childId, { since, limit: 50 });
}
