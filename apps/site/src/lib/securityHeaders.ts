/**
 * Security response headers for the public website.
 *
 * WHY THIS IS NOT `apps/web/src/lib/securityHeaders.ts`
 *
 * Not duplication for its own sake — the two policies are genuinely different, and merging them
 * would mean a single function with a growing set of flags for "is this the app or the site".
 *
 * The app's policy exists to limit what an injected script could exfiltrate from a screen showing
 * a named under-five's anaphylaxis plan. Its `connect-src` allows exactly itself and Supabase.
 * Here `connect-src` is `'self'` and nothing else, which is *stricter* than the app's on the
 * directive that matters most.
 *
 * **CORRECTED 2026-08-07.** That used to be justified with "this app has no Supabase dependency at
 * all — `apps/site/package.json` does not list one, and `tsconfig.json` has no `@ece/api` path".
 * The careers form falsified both halves, and this file mattered most of the four places that
 * claimed it, because the CSP decision was resting on it.
 *
 * The directive is still correct, for a narrower and now-verified reason: **the browser** reaches
 * nothing but this origin. The anon key is read from unprefixed environment variables, so Next
 * cannot inline it into client JavaScript, and only the site's *server* talks to Postgres. Checked
 * rather than asserted — `.next/static/` was grepped for the key, the project URL and the string
 * `supabase`, and contains none of them.
 *
 * What is deliberately deferred: extracting the shared shape into `packages/core`. The app's
 * exact header values are asserted byte-for-byte by its end-to-end suite, so that move is a
 * refactor with a real regression surface and no user-visible benefit today. Recorded in
 * llm-wiki/wiki/public-website.md rather than left as an unexplained second copy.
 *
 * WHAT THIS POLICY ALLOWS THAT THE APP'S DOES NOT
 *
 * Still nothing. Two requests have been made of this file and both were answered by building the
 * feature differently rather than by widening a directive, which is the pattern worth keeping.
 *
 * **The webfont.** This used to say the type was the system stack because "a webfont is a third
 * party on a page read by parents of three-month-olds". There is a typeface now. `next/font`
 * downloads the files at build time and serves them from this origin, so `font-src 'self' data:`
 * never had to change — "no webfont" and "no third-party request" were being treated as one
 * decision and are not.
 *
 * **The map.** Same shape, and it is the newer one — 2026-08-07. `frame-src` is still `'none'` and
 * `img-src` is still `'self' data:`, because the container fetches the picture from the Maps Static
 * API and serves the bytes from `/api/map/<centre>`. What was refused was never the map; it was an
 * iframe running Google's JavaScript, setting Google's cookies and collecting the IP address of
 * everyone who opens the contact page. The reader's browser still talks to exactly one origin. See
 * `lib/staticMap.ts`, which carries the reasoning and the one thing about it nobody has checked.
 *
 * `img-src` therefore stays `'self' data:`. Every image on this site is either committed to
 * `apps/site/public/` or proxied through this origin, and the alternative to the proxy — allowing
 * `maps.googleapis.com` — is a directive that would let any future page fetch any image from
 * Google, to save one route handler.
 */

/** Per-request, from the Web Crypto API — available in the Edge runtime, unlike node:crypto. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa over a binary string: the Edge runtime has no Buffer.
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy({ nonce, dev }: { nonce: string; dev: boolean }): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'strict-dynamic' lets a nonce-trusted script load its own chunks. 'unsafe-eval' is
    // required by Next's hot reloader in development and is never sent in production.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Next inlines critical CSS as a <style> element with no nonce plumbing. 'unsafe-inline' on
    // *styles* cannot execute script.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    // The directive that matters. There is no Supabase origin here because this app never talks
    // to a database — if that ever changes, it changes here in the same commit.
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    // The enquiry form posts to this origin and is handled server-side. Nothing else may be a
    // form target — a marketing site posting a child's details to a third-party form service is
    // the thing this forbids.
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
 * `Referrer-Policy` is `strict-origin-when-cross-origin` rather than the app's `same-origin`.
 * The app's URLs contain child UUIDs, so it sends nothing outward at all. This site's URLs are
 * `/centres/mt-albert` — there is no identifier to leak, and a centre linking out to the Ministry
 * or to a local school should show up in that site's referrals rather than as direct traffic.
 */
export const STATIC_SECURITY_HEADERS: readonly [string, string][] = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
];
