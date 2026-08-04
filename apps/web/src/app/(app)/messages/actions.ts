'use server';

import { revalidatePath } from 'next/cache';
import { closeThread, markThreadRead, sendMessage, startThread } from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

/**
 * Either side may start a thread — that is the point of the feature. A centre that can message
 * families and cannot be messaged back has built a broadcast channel, not a conversation.
 *
 * So this is gated on `requireCtx` rather than a staff capability. The policy in 0016 confines a
 * parent to their own child, or to a thread about no child at all.
 */
export async function start(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCtx();
  const db = await serverDb();

  const subject = str(form, 'subject');
  const body = str(form, 'body');
  const childId = str(form, 'childId');

  if (!subject) return { error: 'What is it about?' };
  if (!body) return { error: 'There is no message yet.' };

  try {
    await startThread(db, {
      centreId: ctx.centre.id,
      childId: childId || null,
      subject,
      body,
    });
  } catch (e) {
    return actionError(e, 'messages.start');
  }

  revalidatePath('/messages');
  return { ok: true };
}

export async function reply(_prev: unknown, form: FormData): Promise<Result> {
  await requireCtx();
  const db = await serverDb();
  const threadId = str(form, 'threadId');
  const body = str(form, 'body');
  if (!threadId) return { error: 'Missing thread.' };
  if (!body) return { error: 'There is no message yet.' };

  try {
    await sendMessage(db, threadId, body);
  } catch (e) {
    return actionError(e, 'messages.reply');
  }
  revalidatePath('/messages');
  return { ok: true };
}

/** Marks the other side's messages read. The policy refuses your own. */
export async function markRead(_prev: unknown, form: FormData): Promise<Result> {
  await requireCtx();
  const db = await serverDb();
  const threadId = str(form, 'threadId');
  if (!threadId) return { error: 'Missing thread.' };
  try {
    await markThreadRead(db, threadId);
  } catch (e) {
    return actionError(e, 'messages.markRead');
  }
  revalidatePath('/messages');
  return { ok: true };
}

/** Staff-side housekeeping. Reopening is a new thread, so this is not undo. */
export async function close(_prev: unknown, form: FormData): Promise<Result> {
  await requireCtx();
  const db = await serverDb();
  const threadId = str(form, 'threadId');
  if (!threadId) return { error: 'Missing thread.' };
  try {
    await closeThread(db, threadId);
  } catch (e) {
    return actionError(e, 'messages.close');
  }
  revalidatePath('/messages');
  return { ok: true };
}
