/**
 * The client-supplied destination, reduced to a path on this origin.
 *
 * THE PREFIX CHECK THIS REPLACES WAS DEFEATED BY ONE BACKSLASH.
 *
 * It read `next.startsWith('/') && !next.startsWith('//')`, which looks exhaustive and is not:
 *
 *   new URL('/\evil.com', 'https://app.example.nz').href  ->  'https://evil.com/'
 *
 * `/\evil.com` starts with a single slash, so it passed, and the WHATWG URL parser treats a
 * backslash as a slash for special schemes — so `/\` is `//` and everything after it is a host.
 * Measured, not deduced. The result is an open redirect on the domain a password-reset email points
 * at, which is the ideal phishing primitive: the link in the email really is the centre's own app,
 * and the page the person lands on is not. Cookies are same-origin so the session itself does not
 * leak, but a convincing "your session expired, sign in again" form does not need it.
 *
 * The fix is to stop reasoning about the string and ask the parser. Resolve the value against this
 * origin and compare the resolved origin — that is robust against backslashes, encodings,
 * whitespace, `javascript:`, and the next trick nobody has thought of, because it is the same
 * function the browser will use.
 *
 * Only `pathname + search` is carried forward. A fragment is never sent to the server, and rebuilding
 * one here would only be a place to put something.
 */
export function sameOriginPath(raw: string | null, origin: string, fallback: string): string {
  if (!raw) return fallback;
  let candidate: URL;
  try {
    candidate = new URL(raw, origin);
  } catch {
    return fallback;
  }
  if (candidate.origin !== origin) return fallback;
  return `${candidate.pathname}${candidate.search}`;
}

