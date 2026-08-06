import type { MetadataRoute } from 'next';

/**
 * Their current site has no robots.txt at all — a 404. This is not a big win on its own, but the
 * sitemap reference is: theirs lists five `http://` URLs with a 2018 `lastmod` and a
 * `changefreq` of "weekly", which is a promise the site has not kept for eight years.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.SITE_ORIGIN ?? 'https://www.littlepearls.org.nz';
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
