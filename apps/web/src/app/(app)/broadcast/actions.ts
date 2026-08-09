'use server';

import { revalidatePath } from 'next/cache';
import { broadcastEmergency } from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true; recipientCount: number };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

/**
 * Send an emergency broadcast.
 *
 * `requireCapability('broadcastEmergency')` is the UI hint; `broadcast_emergency` (0057)
 * checks the same two roles again in Postgres, because a capability list only decides
 * whether a button is drawn.
 */
export async function send(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('broadcastEmergency');
  const db = await serverDb();

  const title = str(form, 'title');
  const body = str(form, 'body');
  if (!title) return { error: 'A title is required.' };
  if (!body) return { error: 'A message is required.' };
  if (str(form, 'confirm') !== 'yes') {
    return { error: 'Tick the box to confirm this reaches every family and staff member now.' };
  }

  try {
    const recipientCount = await broadcastEmergency(db, { centreId: ctx.centre.id, title, body });
    revalidatePath('/broadcast');
    return { ok: true, recipientCount };
  } catch (e) {
    return actionError(e, 'broadcast.send');
  }
}
