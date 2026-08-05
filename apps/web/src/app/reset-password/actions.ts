'use server';

import { redirect } from 'next/navigation';
import { actionError } from '@/lib/actionError';
import { passwordProblem } from '@/lib/password';
import { serverDb } from '@/lib/supabase';

export type ResetResult = { error: string } | null;

/**
 * Set a new password from a recovery session.
 *
 * No current-password check here, unlike /account — not knowing the current
 * password is the entire situation. What stands in for it is the recovery link:
 * it was sent to the account's mailbox and nowhere else, so holding it proves
 * holding the mailbox, the same reasoning the invitation flow rests on.
 */
export async function resetPassword(_prev: unknown, form: FormData): Promise<ResetResult> {
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const problem = passwordProblem(password, confirm);
  if (problem) return { error: problem };

  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) {
    return { error: 'This reset link has expired. Ask for a new one from the sign-in page.' };
  }

  const { error } = await db.auth.updateUser({ password });
  if (error) return actionError(error, 'resetPassword');

  // The recovery email exists because somebody may have lost control of the
  // account. Whatever sessions that somebody has, they end now.
  await db.auth.signOut({ scope: 'others' });

  redirect('/');
}
