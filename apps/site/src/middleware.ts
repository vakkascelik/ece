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

  /*
   * The canonical redirect, and the two conditions that took a failed deploy to get right.
   *
   * THIS BROKE THE FIRST DEPLOY. The first version redirected whenever the request's host was not
   * `SITE_CANONICAL_HOST`, falling back to the `host` header. Railway's health check hits the
   * container on its internal address, so every probe got a 308 instead of a 200, eight attempts
   * failed with "service unavailable", and the replica never became healthy — while the container
   * itself was fine and had logged `Ready in 359ms`.
   *
   * Worse, it made the service unreachable in a browser too: the value was set to the real domain
   * before that domain pointed at the service, so the Railway URL redirected to a host that was
   * not yet there.
   *
   * **Never redirect the health path.** A health check is the platform asking this container
   * whether it is alive, and the answer has to come from this container. That single exemption is
   * what makes the probe return 200, verified by running this app with `SITE_CANONICAL_HOST` set
   * and curling it the way Railway does.
   *
   * A note on what does NOT work, because it looked like it would: requiring `x-forwarded-host` to
   * be present does not distinguish an internal request from a public one. **Next populates that
   * header from `Host` when the proxy has not**, so an internal request has it too — measured, not
   * assumed. The header is still the right thing to *compare* against, since it carries the public
   * host when there is one; it just says nothing about where the request came from.
   *
   * The operational corollary, which is in docs/deploy-railway.md: leave `SITE_CANONICAL_HOST`
   * unset until the custom domain actually resolves to this service. Set earlier, it redirects the
   * working Railway URL to a hostname that is not there yet.
   *
   * `proto === 'http'` rather than `!== 'https'`: only downgrade-redirect when the proxy actually
   * told us it was plain HTTP. Absent means unknown, and unknown is not a reason to bounce.
   */
  const canonical = process.env.SITE_CANONICAL_HOST;
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto');
  const isHealthCheck = request.nextUrl.pathname === '/api/health';

  /*
   * The platform's own hostname is never redirected.
   *
   * SECOND TIME THIS REDIRECT CAUSED A PROBLEM, so the shape changed rather than the docs. With
   * the canonical host set before the real domain pointed here, visiting
   * `little-pearls-production.up.railway.app` 308'd to `www.littlepearls.org.nz` — which still
   * serves the **old site this one replaces**. So the new website redirected to the old website,
   * and the only way out was to remember to unset a variable.
   *
   * A `*.up.railway.app` host is this service's own inspection URL. Bouncing it somewhere else is
   * never what anybody wanted: before go-live the target may not resolve, and after go-live the
   * canonical `<link>` tag already tells crawlers which URL is the real one. So the variable now
   * does only the job it is good at — choosing between www and apex, and forcing https — and the
   * preview URL keeps working whether it is set or not.
   */
  const isPlatformHost = forwardedHost?.endsWith('.up.railway.app') ?? false;

  if (
    canonical &&
    forwardedHost &&
    !isHealthCheck &&
    !isPlatformHost &&
    (forwardedHost !== canonical || proto === 'http')
  ) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${canonical}`);
    /*
     * 307, not 308 — and this is the third lesson from this redirect.
     *
     * Both preserve the request method, which is why neither is 301: a 301 is permitted to rewrite
     * a POST to a GET and would silently drop a form submission. The difference is caching. **308
     * is permanent, and browsers cache it hard** — often for the life of the profile. So when this
     * redirect was pointing the preview URL at the old website, fixing the code was not enough:
     * every browser that had already followed it kept redirecting, with no request reaching the
     * server at all, and the symptom was "the fix did nothing".
     *
     * A misconfigured permanent redirect is therefore not just wrong, it is *sticky* — the one
     * failure mode you cannot fix by deploying. 307 costs a little ranking consolidation, which is
     * worth nothing on a site that is not live yet, and buys the ability to be wrong recoverably.
     *
     * Once the real domain is serving and verified, promoting this to 308 is a one-line change and
     * a deliberate one.
     */
    return NextResponse.redirect(target, 307);
  }

  // On the request, so Next can read the nonce and stamp its own inline scripts with it.
  request.headers.set('content-security-policy', csp);
  request.headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of STATIC_SECURITY_HEADERS) response.headers.set(name, value);

  /*
   * Nothing served on a railway.app hostname may be indexed.
   *
   * WHY THIS IS A HEADER AND NOT A METADATA FLAG
   *
   * The first version keyed `noindex` on `SITE_CANONICAL_HOST` being unset, which was wrong twice
   * over. It made an environment variable — one that has nothing to do with indexing — the switch
   * for it, and it stopped working the moment that variable became safe to set early: the preview
   * then advertised itself as indexable while being reachable only at a railway.app URL.
   *
   * `X-Robots-Tag` is decided per request, from the host actually being served, which is the fact
   * that matters. It also keeps every page statically generated — reading headers inside
   * `generateMetadata` would make all ten routes dynamic to emit one meta tag.
   *
   * What it prevents is specific: this site is being shown to the centre's manager while
   * littlepearls.org.nz is still live. A crawler finding the preview would put two websites for one
   * childcare centre into search results, one of them on a hostname nobody chose.
   */
  if (isPlatformHost) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

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
