import { isRecoverySession } from '@/lib/recoverySession';
import { serverDb } from '@/lib/supabase';

export type RecoveryGate =
  | { ok: true; email: string | undefined }
  | { ok: false; reason: 'no-session' | 'password-session' };

/**
 * The two-step check this route needs, in one place so the page and the action cannot disagree.
 *
 * ORDER MATTERS. `getUser()` first, because it asks GoTrue whether the access token is genuine and
 * unexpired — reading a claim out of a token nobody validated would be trusting the client. Only
 * then is the token's own `amr` claim worth anything.
 *
 * The route used to stop after the first step. "Is somebody signed in" is not the question: this is
 * the one screen in the product that sets a password **without** asking for the current one, so it
 * has to establish that the person proved control of the mailbox, not merely that a session exists.
 */
export async function recoveryGate(): Promise<RecoveryGate> {
  const db = await serverDb();

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { ok: false, reason: 'no-session' };

  const { data: session } = await db.auth.getSession();
  const token = session.session?.access_token;
  if (!token || !isRecoverySession(token)) return { ok: false, reason: 'password-session' };

  return { ok: true, email: auth.user.email };
}
