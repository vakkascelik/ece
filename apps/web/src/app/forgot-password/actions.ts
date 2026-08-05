'use server';

import { report } from '@/lib/observability';
import { originOf } from '@/lib/origin';
import { serverDb } from '@/lib/supabase';

export type ForgotResult = { error?: string; sent?: boolean } | null;

/**
 * Ask for a password reset email.
 *
 * One outcome for every address, known or not — the same reasoning as the single
 * login error string. "No account for that address" on a form pointed at named
 * childcare centres is a way to enumerate who works there, so the answer is
 * always "if that address has an account, the email is on its way".
 *
 * A real send failure (SMTP down, rate limit) is reported to observability but
 * still shows the uniform sentence: varying the message by cause reopens the
 * oracle this exists to close.
 */
export async function requestReset(_prev: unknown, form: FormData): Promise<ForgotResult> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email.includes('@')) return { error: 'That is not an email address.' };

  const db = await serverDb();
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${await originOf()}/auth/confirm?next=/reset-password`,
  });
  if (error) report(error, { action: 'requestReset' });

  return { sent: true };
}
