'use server';

import { cookies } from 'next/headers';
import { createAnonClient } from '@ece/api';
import { actionError } from '@/lib/actionError';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/lib/locale';
import { passwordProblem } from '@/lib/password';
import { serverDb } from '@/lib/supabase';

export type ChangePasswordResult = { error?: string; ok?: boolean } | null;

/**
 * Change the signed-in user's password.
 *
 * The current password is required and verified first. A session in a browser is
 * not proof of knowing the password — an unlocked laptop in a staff room is the
 * ordinary case, not the edge case — and without this check whoever is at the
 * keyboard owns the account permanently.
 *
 * Verification happens on a throwaway anon client rather than the cookie-backed
 * one, so a wrong guess cannot disturb the session that is asking, and a right
 * one does not rotate cookies mid-action.
 */
export async function changePassword(_prev: unknown, form: FormData): Promise<ChangePasswordResult> {
  const current = String(form.get('current') ?? '');
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  if (!current) return { error: 'Enter your current password.' };
  const problem = passwordProblem(password, confirm);
  if (problem) return { error: problem };
  if (password === current) return { error: 'The new password is the same as the current one.' };

  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user?.email) return { error: 'You are not signed in.' };

  /*
   * No session persistence and no refresh ticker — now the default in `createAnonClient`, which used
   * to set both to true for a browser it has no callers in. Each password change was leaving a timer
   * firing every thirty seconds against a client nobody would use again.
   */
  const checker = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const verify = await checker.auth.signInWithPassword({
    email: auth.user.email,
    password: current,
  });
  if (verify.error) return { error: 'Your current password is not right.' };

  /*
   * The throwaway session is ended explicitly. `signInWithPassword` created a real session on the
   * auth server; leaving it alive means every password change leaves a live refresh token behind
   * that nothing will ever use and nothing will revoke. `scope: 'local'` because it is this
   * client's own session and no other device is involved.
   */
  await checker.auth.signOut({ scope: 'local' });

  const { error } = await db.auth.updateUser({ password });
  if (error) return actionError(error, 'changePassword');

  // Every other session — a forgotten sign-in on a shared tablet, or whoever
  // prompted this change — stops working now. This one stays.
  await db.auth.signOut({ scope: 'others' });

  return { ok: true };
}

/**
 * Set the display language for this browser.
 *
 * `next-intl` reads this cookie on the very next render — see `src/i18n/request.ts` — so
 * no session or database write is involved and no other device is affected. Anything not
 * in `LOCALES` is silently ignored rather than erroring: a stray value in a hand-edited
 * cookie should not crash the account page.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!(LOCALES as readonly string[]).includes(locale)) return;
  // `.includes` does not narrow `locale` for TypeScript even though LOCALES is a literal
  // union — the check above is what actually guarantees this cast is safe.
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale as Locale, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
}
