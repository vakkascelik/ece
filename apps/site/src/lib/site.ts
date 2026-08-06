/*
 * There was an `isPreview()` here, keyed on `SITE_CANONICAL_HOST` being unset, used to decide
 * whether crawlers should index the site. It is gone: indexing depends on the host actually being
 * served, not on an environment variable that means something else, and `X-Robots-Tag` in
 * middleware decides it per request. See the note there.
 */

/**
 * The origin for absolute URLs — Open Graph, `robots.txt`, the sitemap.
 *
 * Falls back to the production domain so a build with nothing configured still emits sensible
 * absolute URLs rather than `undefined`.
 */
export function siteOrigin(): string {
  return process.env.SITE_ORIGIN ?? 'https://www.littlepearls.org.nz';
}

/** Where "Sign in to the centre app" points. */
export function appUrl(): string {
  return process.env.SITE_APP_URL ?? 'https://ece-production-fc07.up.railway.app/login';
}
