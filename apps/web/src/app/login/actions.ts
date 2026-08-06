'use server';

import { redirect } from 'next/navigation';
import { serverDb } from '@/lib/supabase';

/**
 * Password sign-in.
 *
 * The error message is deliberately the same whether the address is unknown or
 * the password is wrong. Distinguishing them turns the login form into a way to
 * find out who has an account here — and the accounts belong to staff at named
 * childcare centres.
 */
export async function signIn(_prev: unknown, form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const db = await serverDb();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { error: 'Those details are not right.' };

  redirect('/');
}

export async function signOut() {
  const db = await serverDb();
  /*
   * `local`, not the default `global`.
   *
   * Global revokes refresh tokens on every device the person owns, so signing out of the staffroom
   * tablet would sign them out of their own phone. `llm-wiki/wiki/offline-outbox.md` has said this
   * since the mobile sign-out work — remote revocation is a containment action for the breach
   * runbook, not a side effect of a tap on the device you are still holding — and the web app was
   * doing the thing that page says not to do.
   *
   * `/account` and `/reset-password` still use `scope: 'others'` after a password change, which is
   * the opposite case and deliberately so: there, ending every other session is the point.
   */
  await db.auth.signOut({ scope: 'local' });
  redirect('/login');
}
