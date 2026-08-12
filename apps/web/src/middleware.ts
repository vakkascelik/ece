import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  contentSecurityPolicy,
  newNonce,
  STATIC_SECURITY_HEADERS,
} from '@/lib/securityHeaders';

/**
 * Refreshes the Supabase session on every request, and sets the security headers.
 *
 * The headers live here rather than in `next.config.ts` because the CSP carries a
 * per-request nonce, and a nonce in a static config is not a nonce. The cost is that they
 * are only applied to what the matcher covers — which is every route and no static asset,
 * and a stylesheet needs no CSP of its own.
 *
 * ORDER MATTERS. The nonce has to be written onto the *request* headers before the
 * response is built, because that is how Next finds it and attaches it to the inline
 * scripts it injects for the RSC payload. Setting the CSP only on the response gives a
 * page whose own scripts violate its own policy — which fails as a blank page with a
 * console error, on every route at once.
 *
 * Without this, an access token expires mid-visit and Server Components start
 * seeing a signed-out user while the browser still believes it is signed in —
 * which presents as random redirects to /login that nobody can reproduce.
 *
 * Two rules that are easy to get wrong and painful to debug:
 *
 *  - Cookies must be written to the SAME response object that is returned. A
 *    fresh NextResponse created after the client has set cookies drops them and
 *    the session silently never refreshes.
 *  - getUser() must actually be called. It is what triggers the refresh; a
 *    middleware that only constructs the client does nothing at all.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const nonce = newNonce();
  const csp = contentSecurityPolicy({
    nonce,
    supabaseUrl: url,
    // Without this, configuring a DSN would make every browser-side report fail the app's own
    // connect-src — silently, because a CSP violation is a console entry and not an exception.
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dev: process.env.NODE_ENV !== 'production',
  });

  // On the request, so Next can read the nonce and stamp its own inline scripts with it.
  request.headers.set('content-security-policy', csp);
  request.headers.set('x-nonce', nonce);

  const withHeaders = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', csp);
    for (const [name, value] of STATIC_SECURITY_HEADERS) res.headers.set(name, value);
    return res;
  };

  let response = withHeaders(NextResponse.next({ request }));

  // No Supabase configuration is a deployment fault, not a reason to serve an unprotected
  // page — so the headers are already on before this returns.
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        // A fresh response is built here, which loses the headers set above — hence
        // re-applying them. This is the same trap as the cookies themselves: the object
        // returned must be the object everything was written to.
        response = withHeaders(NextResponse.next({ request }));
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip static assets and images: running auth refresh on every icon request
  // multiplies the auth server's load by the number of assets on the page.
  // `\\.` not `\.`: this is a string, so `\.` collapses to a bare `.` and the
  // compiled pattern matches any character where a literal dot was meant. Harmless
  // in practice and still wrong — "logosvg" would have been treated as an asset.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
