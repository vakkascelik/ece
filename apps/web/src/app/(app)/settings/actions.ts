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

  const db = await serverDb();
  try {
    await updateCentre(db, ctx.centre.id, { name, moeServiceNumber: raw || null });
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
