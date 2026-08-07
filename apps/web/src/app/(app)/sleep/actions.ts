'use server';

import { revalidatePath } from 'next/cache';
import { recordSleepCheck } from '@ece/api';
import { SLEEP_POSITIONS, type SleepPosition } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Record one observation of one sleeping child.
 *
 * The time is taken here, not from the form. A check records the moment somebody
 * looked, and a field would invite filling the register in afterwards from memory —
 * which is the practice the register exists to replace.
 *
 * `breathingObserved` is required rather than defaulted to true. A default would mean
 * the common case is recorded by not answering, and "we observed breathing" is the
 * single most consequential claim on the screen.
 */
export async function recordCheck(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const observedPosition = oneOf<SleepPosition>(str(form, 'observedPosition'), SLEEP_POSITIONS);
  const breathing = str(form, 'breathingObserved');
  const clientUuid = str(form, 'clientUuid');

  if (!childId) return { error: 'Which child?' };
  if (!observedPosition) return { error: 'Record how you found them.' };
  if (breathing !== 'yes' && breathing !== 'no') {
    return { error: 'Record whether you observed them breathing.' };
  }
  if (!clientUuid) return { error: 'The page did not finish loading. Reload and try again.' };

  try {
    const result = await recordSleepCheck(db, {
      childId,
      at: new Date().toISOString(),
      observedPosition,
      breathingObserved: breathing === 'yes',
      clientUuid,
      note: str(form, 'note') || null,
    });
    /*
      A duplicate key means this exact check already landed. Not an error, and it must
      not be shown as one — the same reasoning as a medicine dose: somebody told the
      write failed will do it again, and here that means an entry claiming an
      observation nobody made.
    */
    if (result.outcome === 'duplicate') {
      revalidatePath('/sleep');
      return { ok: true };
    }
  } catch (e) {
    return actionError(e, 'sleep.recordCheck');
  }

  revalidatePath('/sleep');
  return { ok: true };
}
