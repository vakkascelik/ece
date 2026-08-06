'use server';

import { redirect } from 'next/navigation';
import { actionError } from '@/lib/actionError';
import { passwordProblem } from '@/lib/password';
import { serverDb } from '@/lib/supabase';
import { recoveryGate } from './guard';

export type ResetResult = { error: string } | null;

/**
 * Set a new password from a recovery session.
 *
 * No current-password check here, unlike /account — not knowing the current
 * password is the entire situation. What stands in for it is the recovery link:
 * it was sent to the account's mailbox and nowhere else, so holding it proves
 * holding the mailbox, the same reasoning the invitation flow rests on.
 *
 * **That paragraph was true as a description and false as a statement about this code**, which is
 * the kind of comment this repo treats as a defect. Nothing checked that the session came from a
 * link: the action tested `auth.user` and called `updateUser`, which GoTrue accepts on session
 * authority alone. So the recovery link was not standing in for anything — any signed-in session
 * would do, and the `signOut({ scope: 'others' })` below then locked the real holder out of every
 * other device. The gate is now enforced by `recoveryGate()`; see `lib/recoverySession.ts` for why
 * it is a signed claim rather than a cookie.
 */
export async function resetPassword(_prev: unknown, form: FormData): Promise<ResetResult> {
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const problem = passwordProblem(password, confirm);
  if (problem) return { error: problem };

  /*
   * Checked here as well as on the page, and not only because a server action is a public endpoint
   * that a page render does not protect. The page could be rendered from a cache or reached with a
   * stale RSC payload; the action is the thing that changes the password, so the action is where
   * the guard has to hold.
   */
  const gate = await recoveryGate();
  if (!gate.ok) {
    if (gate.reason === 'no-session') {
      return { error: 'This reset link has expired. Ask for a new one from the sign-in page.' };
    }
    return {
      error:
        'You are signed in already, so this page cannot change your password. Change it in your ' +
        'account settings, where you will be asked for your current password.',
    };
  }

  const db = await serverDb();
  const { error } = await db.auth.updateUser({ password });
  if (error) return actionError(error, 'resetPassword');

  // The recovery email exists because somebody may have lost control of the
  // account. Whatever sessions that somebody has, they end now.
  await db.auth.signOut({ scope: 'others' });

  redirect('/');
}
