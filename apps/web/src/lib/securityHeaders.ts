/**
 * Security response headers.
 *
 * FOUND BY THE SECURITY REVIEW: THERE WERE NONE
 *
 * No CSP, no frame protection, no referrer policy, no `nosniff`. For an application whose
 * screens show a named under-five's anaphylaxis plan and a court order reference, that is
 * a gap in the same category as a missing policy — it just fails in the browser rather
 * than in Postgres, so no amount of SQL testing would have surfaced it.
 *
 * WHY EACH ONE, IN ORDER OF WHAT IT ACTUALLY PREVENTS HERE
 *
 * `Content-Security-Policy` — the only one that limits the damage of an injected script.
 * There is no `dangerouslySetInnerHTML` and no `eval` in this codebase today, but a
 * strict `connect-src` also means that *if* a script ever did run, it could not post a
 * child's record to an attacker's host: the only origins it may talk to are this one and
 * the Supabase project.
 *
 * `frame-ancestors 'none'` plus `X-Frame-Options: DENY` — clickjacking. The specific
 * attack that matters is not stealing a click on a "like" button: it is framing
 * `/children/<id>` and reading nothing, or framing the roll and overlaying it. Both
 * headers, because `frame-ancestors` is the modern one and `X-Frame-Options` is what an
 * older browser on a centre's ageing tablet will honour.
 *
 * `Referrer-Policy: same-origin` — the URLs in this app contain child UUIDs
 * (`/children/<uuid>`), and a UUID in a `Referer` header sent to another host is an
 * identifier leaving the building. `same-origin` sends the full referrer within this site
 * and nothing at all to anywhere else, which is exactly the goal.
 *
 * IT WAS `no-referrer` FIRST, AND THAT BROKE EVERY WRITE IN THE APPLICATION.
 *
 * Sign-in failed with `TypeError: Invalid URL … input: 'null'` from the server, on the
 * POST and never on a GET. Next's server-action origin check compares the request origin
 * against the host, and where `Origin` is absent it falls back to `Referer` — which
 * `no-referrer` strips, so it parsed the string "null". Every server action in the product
 * is a write, so the whole application was read-only: the roll rendered, the ratio
 * rendered, and signing a child in did nothing.
 *
 * A header that silently disables every mutation is a good argument for the end-to-end
 * suite existing. `npm run typecheck`, `lint` and `next build` were all clean, the page
 * looked perfect, and the failure was one test away.
 *
 * `X-Content-Type-Options: nosniff` — a media file served with the wrong type must not be
 * sniffed into something executable. Media comes from Supabase Storage on a different
 * origin, so this is defence in depth rather than the primary control.
 *
 * `Permissions-Policy` — camera, microphone and geolocation are switched off because the
 * web app uses none of them. If a photo-capture feature is added, the header must change
 * in the same commit or the feature will fail in a way that looks like a browser bug.
 *
 * `Strict-Transport-Security` — usually set by the host. Set here too, because "the host
 * does it" is an assumption about a deployment that does not exist yet.
 *
 * WHY A NONCE AND NOT `unsafe-inline`
 *
 * Next injects inline scripts to stream the RSC payload, so a CSP without either a nonce
 * or `unsafe-inline` breaks every page. `unsafe-inline` would make `script-src` decorative
 * — it permits exactly the thing CSP exists to stop. So the middleware generates a nonce
 * per request and Next attaches it to its own scripts automatically, which it does by
 * reading the CSP off the *request* headers.
 *
 * `'strict-dynamic'` is included so that a script already trusted via the nonce may load
 * another; without it, Next's chunk loading is blocked in some browsers. It also makes
 * host-based allowlisting in `script-src` redundant, which is why there is none.
 */

/** Per-request, from the Web Crypto API — available in the Edge runtime, unlike node:crypto. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa over a binary string: the Edge runtime has no Buffer.
  return btoa(String.fromCharCode(...bytes));
}

export interface CspInput {
  nonce: string;
  /** The Supabase project origin. Requests, realtime and storage all live here. */
  supabaseUrl: string | undefined;
  /**
   * The Sentry ingest origin, derived from `NEXT_PUBLIC_SENTRY_DSN`. Undefined when unset, which
   * is the current state and the reason this was never noticed.
   *
   * `connect-src` is `'self'` plus Supabase. Sentry's browser SDK posts to
   * `https://<id>.ingest.<region>.sentry.io`, so the moment a DSN is configured **every**
   * browser-side error report would be refused by this app's own policy — silently, because a CSP
   * violation is a console entry, not an exception. The reports would simply never arrive, and the
   * conclusion would be that the client had no errors.
   *
   * Passed in rather than read here, so this function stays pure and testable — the same shape
   * `supabaseUrl` already has.
   */
  sentryDsn?: string | undefined;
  /** Relaxed in development, where Next uses eval for hot reloading. */
  dev: boolean;
}

export function contentSecurityPolicy({ nonce, supabaseUrl, sentryDsn, dev }: CspInput): string {
  // Derive the origin rather than trusting the whole configured string: a stray path or
  // query on the env var would end up inside a CSP directive, where it is silently
  // ignored and the resulting policy blocks every request to Supabase.
  let supabase = '';
  let supabaseWs = '';
  /*
    The Sentry ingest origin, derived rather than trusted whole, for the same reason the Supabase
    one is: a DSN carries a public key and a project path, and pasting the lot into a CSP directive
    yields a source expression the browser ignores — which would fail closed, blocking every report
    while looking configured. Empty when no DSN is set, and `.filter(Boolean)` drops it.
  */
  let sentry = '';
  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl);
      supabase = u.origin;
      supabaseWs = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
    } catch {
      // A malformed URL is a configuration error the app will fail on anyway. Leaving
      // the directive empty is better than emitting a broken source expression.
    }
  }

  if (sentryDsn) {
    try {
      sentry = new URL(sentryDsn).origin;
    } catch {
      // Same reasoning as above. A DSN that will not parse is a deployment fault; emitting
      // nothing is better than emitting something the browser silently discards.
    }
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'strict-dynamic' lets a nonce-trusted script load its own chunks. In development
    // 'unsafe-eval' is required by Next's hot reloader and is never sent in production.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Next inlines critical CSS as a <style> element, and there is no nonce plumbing for
    // it. 'unsafe-inline' on *styles* cannot execute script; the realistic attack it
    // leaves open is exfiltration by selector, which is not a risk this app carries.
    'style-src': ["'self'", "'unsafe-inline'"],
    // blob: for object URLs; the Supabase origin for signed media URLs.
    'img-src': ["'self'", 'data:', 'blob:', supabase].filter(Boolean),
    'font-src': ["'self'", 'data:'],
    // The list that matters. A script that did run could reach nowhere else.
    'connect-src': ["'self'", supabase, supabaseWs, sentry].filter(Boolean),
    'media-src': ["'self'", 'blob:', supabase].filter(Boolean),
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    // Server actions post to the same origin. Nothing else may be a form target.
    'form-action': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  // Not sent in development, where the dev server is plain http and this would break it.
  if (!dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/**
 * The headers that do not depend on a nonce.
 *
 * Returned as a list rather than set directly so the same values can be asserted by the
 * end-to-end suite — a header that is only defined inside middleware is a header nobody
 * can test without a browser.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'same-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  // Two years, subdomains included. Deliberately without `preload`: preloading is
  // effectively irreversible and is not a commitment to make before a domain is chosen.
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
  /*
   * Not a security header, and in this list anyway — because it belongs on every response
   * this app sends, and this array is the only place that is true of *and* that the
   * end-to-end suite can assert against.
   *
   * FOUND BY ASKING WHERE THE CONSOLE WOULD BE INDEXED, AND FINDING NOTHING STOPPING IT.
   * This app had no robots.txt and no `noindex` of any kind. That was survivable while its
   * only hostname was an unlinked `*.up.railway.app` address. It stopped being survivable
   * the moment the console was mounted at `/portal` on a website that is linked, published
   * and — after the domain cutover — indexed.
   *
   * UNCONDITIONAL, unlike apps/site's version of this header, and the asymmetry is the
   * point. That app decides per request from the hostname, because it has pages that should
   * be indexed and a preview that should not. This app has no page that should ever appear
   * in a search result: every route is behind a session except `/login` and `/no-access`,
   * and neither is any use to somebody arriving from Google. So there is no condition to
   * get wrong and no variable to key it on — the first version of the site's rule was keyed
   * on an environment variable and was wrong as soon as that variable's meaning changed.
   *
   * The `Disallow: /portal` in apps/site's robots.txt is the other half and does a different
   * job: that one stops the crawl, this one stops the indexing. A disallowed URL can still
   * be listed from an external link; a `noindex` response cannot.
   */
  ['X-Robots-Tag', 'noindex, nofollow'],
];
