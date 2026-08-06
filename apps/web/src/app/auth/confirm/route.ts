import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { report } from '@/lib/observability';
import { sameOriginPath } from '@/lib/nextPath';
import { serverDb } from '@/lib/supabase';

/**
 * Where the password-reset email lands.
 *
 * A route handler rather than a page because turning the link into a session
 * means writing auth cookies, and a Server Component render cannot (the
 * `setAll` in `serverDb` swallows the attempt there — middleware owns refresh).
 * Here the cookie store is writable, so the exchange sticks.
 *
 * Two link shapes arrive, depending on the Supabase email template:
 *
 *  - `?code=…` — the default template. The PKCE verifier for the exchange lives
 *    in a cookie set when the reset was requested, so the link only works in the
 *    browser that asked for it. Opened anywhere else, the exchange fails and the
 *    person is sent back to ask again — annoying, not dangerous.
 *  - `?token_hash=…&type=recovery` — a customised template
 *    (`{{ .TokenHash }}`). No verifier involved, so it works cross-browser.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  // Client-supplied, so reduced to a path on this origin. See lib/nextPath.ts — the prefix check
  // this replaces was defeated by a single backslash.
  const dest = sameOriginPath(url.searchParams.get('next'), url.origin, '/reset-password');

  const db = await serverDb();

  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, url.origin));
    report(error, { action: 'authConfirm' });
  } else if (tokenHash && type) {
    const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(dest, url.origin));
    report(error, { action: 'authConfirm' });
  }

  return NextResponse.redirect(new URL('/forgot-password?expired=1', url.origin));
}
