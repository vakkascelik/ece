/**
 * Is this the real site, or a preview?
 *
 * WHY `SITE_CANONICAL_HOST` IS THE SIGNAL
 *
 * Rather than a second variable nobody would remember to set. That variable already means "this
 * service answers on the real domain" — the middleware uses it to redirect everything else there —
 * so it is exactly the fact that decides whether a crawler should be indexing this.
 *
 * WHAT IT PREVENTS
 *
 * The website is being shown to the centre's manager on `little-pearls-production.up.railway.app`
 * before it replaces littlepearls.org.nz. With `robots: allow /` and a sitemap, a crawler can find
 * that preview and index it — so the search results for a real childcare centre would contain two
 * of its websites, one of them on a hostname nobody chose, competing with the live one. Undoing
 * that afterwards is slower than preventing it.
 *
 * So: no canonical host set means preview, which means `noindex, nofollow` and a `robots.txt` that
 * disallows everything. Going live is then one variable, and indexing follows the same switch that
 * turns on the canonical redirect.
 */
export function isPreview(): boolean {
  return !process.env.SITE_CANONICAL_HOST;
}

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
