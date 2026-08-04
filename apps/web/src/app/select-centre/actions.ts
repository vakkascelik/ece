'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listMyCentres } from '@ece/api';
import { serverDb } from '@/lib/supabase';
import { CENTRE_COOKIE } from '@/lib/auth';

/**
 * Choose the active centre.
 *
 * The submitted id is checked against the caller's own centres before it is
 * stored. A form field is client-controlled, and while RLS would refuse the
 * queries anyway, writing an unverified id into the cookie means the next page
 * renders an empty shell for a centre the user cannot see — a confusing failure
 * instead of a clear one.
 */
export async function chooseCentre(form: FormData) {
  const centreId = String(form.get('centreId') ?? '');

  const db = await serverDb();
  const centres = await listMyCentres(db);
  if (!centres.some((c) => c.id === centreId)) redirect('/select-centre');

  const store = await cookies();
  store.set(CENTRE_COOKIE, centreId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });

  redirect('/');
}
