import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { report } from '@/lib/observability';
import { sameOriginPath } from '@/lib/nextPath';
import { originOf, publicAppBase } from '@/lib/origin';
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
/*
 * EVERY REDIRECT HERE USED `url.origin`, AND ON RAILWAY THAT IS `https://localhost:8080`.
 *
 * `request.url` is built from the address the container was reached on, and Railway reaches it
 * internally — so the successful path and the expired path both sent the person to localhost.
 * Measured against the console's own hostname with the website's proxy out of the picture, so this
 * predates the `/portal` mount by every deploy there has been; it survived only because nobody had
 * completed a password reset in production. The first person to try was the centre's own manager.
 *
 * Two different bases are needed and conflating them is what made the fix non-obvious:
 *
 *  - `publicAppBase()` builds the outbound redirect. It carries the mount and, behind the proxy,
 *    comes from configuration, because the app cannot learn its public host from the headers there.
 *  - `originOf()` is the *security* comparison for the client-supplied `next`. It must stay a bare
 *    origin: `sameOriginPath` compares `new URL(raw, base).origin` against it, and a base carrying a
 *    path would never match, silently collapsing every `next` to the fallback.
 *
 * `NextResponse.redirect` is also given an already-absolute URL deliberately, and gets no `basePath`
 * added — unlike `redirect()` from `next/navigation`, which does. That asymmetry is exactly why
 * `/portal/reset-password` redirected correctly while this route did not, and it is worth knowing
 * before adding another route handler that redirects.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  const base = await publicAppBase();
  // Client-supplied, so reduced to a path on this origin. See lib/nextPath.ts — the prefix check
  // this replaces was defeated by a single backslash. Compared against the bare request origin, not
  // `base`: the check is "is this the same site", and it has to keep working when `base` has a path.
  const dest = sameOriginPath(url.searchParams.get('next'), await originOf(), '/reset-password');

  const db = await serverDb();

  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${dest}`);
    report(error, { action: 'authConfirm' });
  } else if (tokenHash && type) {
    const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${base}${dest}`);
    report(error, { action: 'authConfirm' });
  }

  return NextResponse.redirect(`${base}/forgot-password?expired=1`);
}
