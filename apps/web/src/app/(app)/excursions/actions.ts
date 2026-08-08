'use server';

import { revalidatePath } from 'next/cache';
import {
  addChildToExcursion,
  createExcursion,
  listExcursionChildren,
  listExcursionConsents,
  recordExcursionConsent,
  recordHeadcount,
  removeChildFromExcursion,
  setExcursionStatus,
} from '@ece/api';
import { consentGaps } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { zonedWallClockToUtc } from '@/lib/dayWindow';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function planExcursion(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const destination = str(form, 'destination');
  const departsAtLocal = str(form, 'departsAt');
  const returnsAtLocal = str(form, 'returnsAt');

  if (destination.length < 2) return { error: 'Where is the outing to?' };
  if (!WALL_CLOCK.test(departsAtLocal)) return { error: 'When does it leave?' };

  const departsAt = zonedWallClockToUtc(departsAtLocal, ctx.centre.timezone);
  const returnsAt = WALL_CLOCK.test(returnsAtLocal)
    ? zonedWallClockToUtc(returnsAtLocal, ctx.centre.timezone)
    : null;
  if (returnsAt && returnsAt < departsAt) {
    return { error: 'It cannot return before it leaves.' };
  }

  const adultsRaw = str(form, 'adultsAttending');
  const adults = adultsRaw ? Number(adultsRaw) : null;
  if (adults !== null && (!Number.isInteger(adults) || adults < 0)) {
    return { error: 'Adults attending is a whole number.' };
  }

  try {
    await createExcursion(db, {
      centreId: ctx.centre.id,
      destination,
      departsAt,
      returnsAt,
      purpose: str(form, 'purpose') || null,
      transport: str(form, 'transport') || null,
      plan: str(form, 'plan') || null,
      adultsAttending: adults,
    });
  } catch (e) {
    return actionError(e, 'excursions.planExcursion');
  }

  revalidatePath('/excursions');
  return { ok: true };
}

export async function setChildren(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const excursionId = str(form, 'excursionId');
  const childId = str(form, 'childId');
  const op = str(form, 'op');
  if (!excursionId || !childId) return { error: 'Which child, on which outing?' };

  try {
    if (op === 'remove') await removeChildFromExcursion(db, excursionId, childId);
    else await addChildToExcursion(db, excursionId, childId);
  } catch (e) {
    return actionError(e, 'excursions.setChildren');
  }

  revalidatePath(`/excursions/${excursionId}`);
  return { ok: true };
}

/**
 * Record a consent decision for one child on this outing — staff transcribing a
 * paper form or a phone call. `givenBy` names the guardian whose decision it is,
 * which the form requires: consent attributed to nobody is not consent.
 */
export async function recordConsent(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const excursionId = str(form, 'excursionId');
  const childId = str(form, 'childId');
  const givenBy = str(form, 'givenBy');
  const decision = str(form, 'decision');

  if (!excursionId || !childId) return { error: 'Which child, on which outing?' };
  if (!givenBy) return { error: 'Whose decision is this? Consent attributed to nobody is not consent.' };
  if (decision !== 'granted' && decision !== 'refused') {
    return { error: 'Record whether they said yes or no.' };
  }

  try {
    await recordExcursionConsent(db, {
      excursionId,
      childId,
      granted: decision === 'granted',
      givenBy,
      note: str(form, 'note') || null,
    });
  } catch (e) {
    return actionError(e, 'excursions.recordConsent');
  }

  revalidatePath(`/excursions/${excursionId}`);
  return { ok: true };
}

/**
 * Depart.
 *
 * The gate is 0037's trigger and is not re-implemented here — but the *message* is.
 * The trigger reports a count because an exception string can end up anywhere; this
 * action, which knows it is talking to the screen, names the problem properly by
 * recomputing the gaps from data the caller may read anyway. If the trigger and this
 * disagree, the trigger wins and the fallback sentence still makes sense.
 */
export async function depart(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const excursionId = str(form, 'excursionId');
  if (!excursionId) return { error: 'Which outing?' };

  try {
    await setExcursionStatus(db, excursionId, 'departed', new Date().toISOString());
  } catch (e) {
    // Expected refusal: consent gaps. Recompute them for a sentence with substance.
    try {
      const [childIds, consents] = await Promise.all([
        listExcursionChildren(db, excursionId),
        listExcursionConsents(db, excursionId),
      ]);
      const gaps = consentGaps(childIds, consents, excursionId);
      if (gaps.unanswered.length > 0 || gaps.refused.length > 0) {
        const parts: string[] = [];
        if (gaps.unanswered.length > 0) {
          parts.push(
            `${gaps.unanswered.length} ${gaps.unanswered.length === 1 ? 'family has' : 'families have'} not answered — that is a phone call`,
          );
        }
        if (gaps.refused.length > 0) {
          parts.push(
            `${gaps.refused.length} said no — ${gaps.refused.length === 1 ? 'that child stays' : 'those children stay'} behind and must come off the list first`,
          );
        }
        return { error: `This outing cannot leave. ${parts.join('; ')}.` };
      }
    } catch {
      /* fall through to the generic scrubbed message */
    }
    return actionError(e, 'excursions.depart');
  }

  revalidatePath(`/excursions/${excursionId}`);
  return { ok: true };
}

export async function markReturned(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const excursionId = str(form, 'excursionId');
  if (!excursionId) return { error: 'Which outing?' };

  try {
    await setExcursionStatus(db, excursionId, 'returned', new Date().toISOString());
  } catch (e) {
    return actionError(e, 'excursions.markReturned');
  }

  revalidatePath(`/excursions/${excursionId}`);
  return { ok: true };
}

/**
 * A headcount, taken now.
 *
 * `expected` comes from the form because the person counting states what they are
 * counting against — and a short count is accepted, never refused. The record that a
 * child was briefly unaccounted for is the record that matters.
 */
export async function countHeads(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const excursionId = str(form, 'excursionId');
  const clientUuid = str(form, 'clientUuid');
  const counted = Number(str(form, 'counted'));
  const expected = Number(str(form, 'expected'));

  if (!excursionId) return { error: 'Which outing?' };
  if (!clientUuid) return { error: 'The page did not finish loading. Reload and try again.' };
  if (!Number.isInteger(counted) || counted < 0) return { error: 'How many tamariki did you count?' };
  if (!Number.isInteger(expected) || expected < 0) return { error: 'How many should there be?' };

  try {
    await recordHeadcount(db, {
      excursionId,
      at: new Date().toISOString(),
      counted,
      expected,
      clientUuid,
      note: str(form, 'note') || null,
    });
  } catch (e) {
    return actionError(e, 'excursions.countHeads');
  }

  revalidatePath(`/excursions/${excursionId}`);
  return { ok: true };
}
