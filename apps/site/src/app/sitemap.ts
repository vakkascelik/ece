import type { MetadataRoute } from 'next';
import { CENTRES } from '@/lib/centres';

/**
 * Generated from the routes rather than hand-written.
 *
 * Their sitemap.xml is hand-maintained, lists `http://` URLs, and carries `lastmod` values from
 * July 2018 — so it advertises staleness to every crawler that reads it. Deriving this from the
 * route list means a new page cannot be forgotten, and a missing page cannot be claimed.
 *
 * No `lastModified`. A build timestamp would say every page changed whenever anything was
 * deployed, which is a lie a crawler can measure; and there is no per-page edit date to use
 * because the content lives in TSX rather than a CMS. Omitting the field is honest.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.SITE_ORIGIN ?? 'https://www.littlepearls.org.nz';

  const paths = [
    '/',
    '/philosophy',
    '/centres',
    ...CENTRES.map((centre) => `/centres/${centre.path}`),
    '/rooms',
    '/enrolment',
    '/careers',
    '/contact',
  ];

  return paths.map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: 'monthly' as const,
    priority: path === '/' ? 1 : 0.7,
  }));
}
