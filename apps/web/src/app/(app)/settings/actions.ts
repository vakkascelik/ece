'use server';

import { revalidatePath } from 'next/cache';
import { updateCentre } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export async function saveCentre(_prev: unknown, form: FormData) {
  const ctx = await requireCapability('manageCentre');

  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'A centre needs a name.' };

  // The Ministry service number is the real-world identity of a licensed service
  // and is uniquely indexed, so a typo that collides with another centre fails at
  // the database. Digits only, and empty means "not recorded yet" rather than "".
  const raw = String(form.get('moeServiceNumber') ?? '').trim();
  if (raw && !/^\d{3,8}$/.test(raw)) {
    return { error: 'A Ministry service number is 3 to 8 digits, e.g. 46365.' };
  }

  /*
    The two practice settings 0032 and 0033 added. Both were readable by the product
    and settable by nobody until this — a column with no way to change it is a column
    that will be changed with a hand-written UPDATE against production.

    A blank interval is NULL, not zero. Null means "this centre has stated none", and
    the sleep register then shows elapsed time without judging it. Zero would make
    every child permanently overdue, which is why the CHECK in 0033 refuses it.
  */
  const witness = form.get('medicationRequiresWitness') === 'on';
  const intervalRaw = String(form.get('sleepCheckMinutes') ?? '').trim();
  let sleepCheckMinutes: number | null = null;
  if (intervalRaw) {
    const n = Number(intervalRaw);
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      return { error: 'A sleep-check interval is a whole number of minutes between 1 and 120.' };
    }
    sleepCheckMinutes = n;
  }

  // Same shape as the sleep interval: blank is NULL, not zero, and 0034's CHECK
  // refuses anything outside 1–730 anyway.
  const drillRaw = String(form.get('drillIntervalDays') ?? '').trim();
  let drillIntervalDays: number | null = null;
  if (drillRaw) {
    const n = Number(drillRaw);
    if (!Number.isInteger(n) || n < 1 || n > 730) {
      return { error: 'A drill interval is a whole number of days between 1 and 730.' };
    }
    drillIntervalDays = n;
  }

  const db = await serverDb();
  try {
    await updateCentre(db, ctx.centre.id, {
      name,
      moeServiceNumber: raw || null,
      medicationRequiresWitness: witness,
      sleepCheckMinutes,
      drillIntervalDays,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/duplicate key|unique/i.test(message)) {
      return { error: 'Another centre already has that Ministry service number.' };
    }
    return { error: message };
  }

  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: true };
}
