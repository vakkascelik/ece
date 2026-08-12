/*
 * There was an `isPreview()` here, keyed on `SITE_CANONICAL_HOST` being unset, used to decide
 * whether crawlers should index the site. It is gone: indexing depends on the host actually being
 * served, not on an environment variable that means something else, and `X-Robots-Tag` in
 * middleware decides it per request. See the note there.
 */

const DEFAULT_ORIGIN = 'https://www.littlepearls.org.nz';
/*
 * THE FALLBACK POINTED AT A PATH THAT NO LONGER EXISTS, WHICH IS WORSE THAN POINTING AT NOTHING.
 *
 * It was `https://ece-production-fc07.up.railway.app/login`. Mounting the console at `/portal` moved
 * every route in it, so that URL became a 404 — and this value is used precisely when `SITE_APP_URL`
 * is **unset**, which the runbook recommends as the safe default. So "Sign in to Doorway", the
 * most-used link on this site, 404'd for anybody whose deployment had not set the variable.
 *
 * The mounted path on this site's own hostname now, because that is where the console actually is
 * and because a link that stays on one origin is the whole point of the mount. It is a same-origin
 * path written absolutely rather than as `/portal/login`, because `urlFromEnv` validates this as a
 * URL and a bare path is not one — see the recovery logic below, which exists because a value with
 * no scheme is resolved as *relative* and silently landed on this site's own 404 once already.
 */
const DEFAULT_APP_URL = 'https://little-pearls-production.up.railway.app/portal/login';

/**
 * An environment variable used as a URL, checked before it is used as one.
 *
 * WHY THIS EXISTS — a real failure, not a defensive habit.
 *
 * `SITE_APP_URL` was set on the Railway service to the **description column** out of the variable
 * table in `docs/deploy-railway.md`, not to a URL:
 *
 *   SITE_APP_URL = where "Sign in to the centre app" points
 *
 * `appUrl()` returned it verbatim, so the footer rendered
 * `<a href="where &quot;Sign in to the centre app&quot; points">`. A value with no scheme is a
 * **relative** URL, so the browser resolved it against the site's own host and "Sign in to the centre
 * app" landed on the site's own 404 page. Reported from a phone, and the 404 was convincing enough to
 * look like a routing bug rather than a configuration one.
 *
 * Two lessons, and only one is about this file. The doc table put a copy-pasteable value and a prose
 * description in adjacent columns and somebody copied the wrong one — so the table now carries
 * literal values. And nothing here validated a string that goes straight into an `href`.
 *
 * WHY THE RESULT IS A STATE AND NOT A STRING
 *
 * The first version returned the fallback on failure and reported trouble by comparing the result to
 * that fallback. Its own test caught the flaw: a bare host like
 * `ece-production-fc07.up.railway.app/login` is recovered by prepending `https://`, and the recovered
 * value **is** the fallback — so "recovered successfully" and "gave up" were indistinguishable, and
 * a working configuration was reported as broken. Comparing to a fallback is not a way to ask whether
 * something worked.
 *
 * Nothing here throws. A misconfigured link must not take a working website down: nine of the ten
 * pages do not need it, and the fallback is the correct URL anyway. It falls back, and `/api/health`
 * reports the bad variable so somebody can see it without reading the HTML.
 */
type UrlEnv = { state: 'unset' } | { state: 'ok'; href: string } | { state: 'unusable' };

function readUrlEnv(name: string): UrlEnv {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return { state: 'unset' };

  const value = raw.trim();

  try {
    const parsed = new URL(value);
    // Anything that is not http(s) is not a link to a website, and `javascript:` parses fine.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { state: 'unusable' };
    return { state: 'ok', href: parsed.href };
  } catch {
    /*
     * Not absolute. A bare host — `ece-production-fc07.up.railway.app/login` — is the likeliest
     * honest mistake and is recoverable, so it is upgraded rather than discarded. A value containing
     * whitespace, like the one that caused this, is not a host and is not rescued.
     */
    if (/\s/.test(value)) return { state: 'unusable' };
    try {
      const upgraded = new URL(`https://${value}`);
      // A single word is a relative path, not a hostname.
      if (!upgraded.hostname.includes('.')) return { state: 'unusable' };
      return { state: 'ok', href: upgraded.href };
    } catch {
      return { state: 'unusable' };
    }
  }
}

export function urlFromEnv(name: string, fallback: string): string {
  const read = readUrlEnv(name);
  return read.state === 'ok' ? read.href : fallback;
}

/** True only when the variable is set to something that could not be used. For `/api/health`. */
export function isUnusableUrl(name: string): boolean {
  return readUrlEnv(name).state === 'unusable';
}

/**
 * The origin for absolute URLs — Open Graph, `robots.txt`, the sitemap.
 *
 * Falls back to the production domain so a build with nothing configured still emits sensible
 * absolute URLs rather than `undefined`. The trailing slash is stripped because every caller
 * concatenates a path onto it.
 */
export function siteOrigin(): string {
  return urlFromEnv('SITE_ORIGIN', DEFAULT_ORIGIN).replace(/\/$/, '');
}

/** Where "Sign in to Doorway" points — the masthead link, and two in body copy. */
export function appUrl(): string {
  return urlFromEnv('SITE_APP_URL', DEFAULT_APP_URL);
}

/** The URL variables, for the health check to report on. */
export const URL_ENV = ['SITE_ORIGIN', 'SITE_APP_URL'] as const;
