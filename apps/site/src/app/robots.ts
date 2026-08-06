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
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
