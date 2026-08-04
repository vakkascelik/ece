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
  await db.auth.signOut();
  redirect('/login');
}
