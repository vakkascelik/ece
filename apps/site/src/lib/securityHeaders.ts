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
 * Nothing, yet. It was tempting to open `frame-src` for a Google Map and `font-src` for a
 * webfont, and both were refused for the same reason the app refuses them: a third party on a
 * page read by parents of three-month-olds. The map is a link out, and the type is the system
 * stack — which is also what their current site uses, so nothing is lost.
 *
 * `img-src` stays `'self' data:` because every image on this site is committed to
 * `apps/site/public/`. Their current photography is hosted on Flickr and none of it is used here
 * until the consent position for each photograph is known.
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
