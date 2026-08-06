import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce, STATIC_SECURITY_HEADERS } from '@/lib/securityHeaders';

/**
 * Security headers, and the canonical host.
 *
 * NO SESSION REFRESH HERE
 *
 * `apps/web`'s middleware calls `supabase.auth.getUser()` on every request, because it owns the
 * auth cookie and a stale token presents as random redirects nobody can reproduce. This app has
 * no session, so it does none of that — which matters more than it sounds: that call is a network
 * round trip, and paying it on an anonymous marketing page view is the difference between a page
 * that renders from cache and one that waits on a third party.
 *
 * ORDER MATTERS, for the same reason it does in the app: the nonce has to be written onto the
 * *request* headers before the response is built, because that is how Next finds it and stamps it
 * onto the inline scripts it injects for the RSC payload. Setting the CSP only on the response
 * gives a page whose own scripts violate its own policy — a blank page with a console error, on
 * every route at once.
 *
 * THE CANONICAL HOST
 *
 * Their current site answers on four addresses — `http://` and `https://`, with and without
 * `www` — all returning 200 rather than redirecting. That splits whatever search ranking they
 * have across four URLs and means a link somebody shares may be the insecure one. One host wins
 * here, with a 308 so the method and body survive (a 301 would turn the enquiry POST into a GET).
 *
 * Driven by `SITE_CANONICAL_HOST` rather than hardcoded, because it differs between the Railway
 * generated domain and the real one, and a hardcoded host is a redirect loop on the other.
 */
export function middleware(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV !== 'production' });

  const canonical = process.env.SITE_CANONICAL_HOST;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (canonical && host && (host !== canonical || proto !== 'https')) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${canonical}`);
    // 308, not 301: the enquiry form is a POST, and a 301 is permitted to rewrite it to a GET —
    // which would silently drop a family's message.
    return NextResponse.redirect(target, 308);
  }

  // On the request, so Next can read the nonce and stamp its own inline scripts with it.
  request.headers.set('content-security-policy', csp);
  request.headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of STATIC_SECURITY_HEADERS) response.headers.set(name, value);
  return response;
}

export const config = {
  // Skip static assets and images: stamping a CSP onto every icon request multiplies the work by
  // the number of assets on the page for no benefit — a PNG needs no script policy.
  // `\\.` not `\.`: this is a string, so `\.` collapses to a bare `.` and would match any
  // character where a literal dot was meant.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
