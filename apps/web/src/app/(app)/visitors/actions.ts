'use server';

import { revalidatePath } from 'next/cache';
import { signInVisitor, signOutVisitor } from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

/**
 * Sign a visitor in.
 *
 * The time is taken here rather than from a field, and that is the whole point of
 * having this on a screen at the door: the record is when somebody arrived, not when
 * a manager got round to writing the book up. A time input would invite the second.
 */
export async function signIn(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const fullName = str(form, 'fullName');
  if (fullName.length < 2) return { error: 'Who is visiting?' };

  try {
    await signInVisitor(db, {
      centreId: ctx.centre.id,
      fullName,
      signedInAt: new Date().toISOString(),
      organisation: str(form, 'organisation') || null,
      purpose: str(form, 'purpose') || null,
      visiting: str(form, 'visiting') || null,
    });
  } catch (e) {
    return actionError(e, 'visitors.signIn');
  }

  revalidatePath('/visitors');
  return { ok: true };
}

export async function signOut(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which visitor?' };

  try {
    await signOutVisitor(db, id, new Date().toISOString());
  } catch (e) {
    return actionError(e, 'visitors.signOut');
  }

  revalidatePath('/visitors');
  return { ok: true };
}
