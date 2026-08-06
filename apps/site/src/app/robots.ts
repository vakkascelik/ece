import type { MetadataRoute } from 'next';
import { isPreview, siteOrigin } from '@/lib/site';

/**
 * Their current site has no robots.txt at all — a 404. This is not a big win on its own, but the
 * sitemap reference is: theirs lists five `http://` URLs with a 2018 `lastmod` and a `changefreq`
 * of "weekly", which is a promise the site has not kept for eight years.
 *
 * **While this is a preview it disallows everything.** See `lib/site.ts` — a preview on a
 * railway.app hostname that gets indexed puts a second website for a real childcare centre into
 * search results, competing with their live one.
 */
export default function robots(): MetadataRoute.Robots {
  if (isPreview()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
