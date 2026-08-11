import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site';

/**
 * Their current site has no robots.txt at all — a 404. This is not a big win on its own, but the
 * sitemap reference is: theirs lists five `http://` URLs with a 2018 `lastmod` and a `changefreq`
 * of "weekly", which is a promise the site has not kept for eight years.
 *
 * This allows crawling unconditionally, and that is deliberate. Keeping the **preview** out of
 * search results is done in middleware with `X-Robots-Tag` on any `*.up.railway.app` host, because
 * that is a per-request fact rather than a build-time one. Two mechanisms for one rule is how they
 * come to disagree — the first version gated this file on an environment variable and was wrong the
 * moment that variable's meaning changed.
 *
 * `/portal` IS THE ONE EXCEPTION, AND IT NEEDS THE OTHER HALF TO BE ANY USE
 *
 * The console is proxied onto this hostname at `/portal`, and this file is the only robots.txt a
 * crawler will ever ask for — it fetches `/robots.txt` from the host, so a robots route inside
 * `apps/web` would be published at `/portal/robots.txt` and read by nobody. The middleware cannot
 * cover it either: it is deliberately excluded from that matcher so it does not overwrite the
 * console's CSP.
 *
 * **This alone does not keep the console out of search results.** `Disallow` stops the crawl, not
 * the indexing — a disallowed URL still gets listed, title-less, from any external link to it. The
 * control that actually prevents indexing is `X-Robots-Tag: noindex`, which `apps/web` now sends on
 * every response of its own. Both, doing different jobs; neither is sufficient.
 *
 * Hardcoded for the same reason as the middleware matcher, and it must move with
 * `ECE_PORTAL_MOUNT` if that ever changes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/portal' }],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
