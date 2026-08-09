import { NextResponse } from 'next/server';
import { centreByPath } from '@/lib/centres';
import { centreMap } from '@/lib/staticMap';

/**
 * The centre's map, served from this origin.
 *
 * This route is the whole reason the Content Security Policy did not have to change. `img-src` is
 * `'self' data:`, so the only way a map could appear on this site without opening the policy to
 * `maps.googleapis.com` is for the bytes to come from here. See `lib/staticMap.ts` for why that was
 * worth the route rather than just allowing the origin.
 *
 * `force-dynamic` because the answer depends on an environment variable and on whether Google is
 * answering. Prerendering this would bake "there is no map" into the build for a service whose key
 * is set after the first deploy — the failure `lib/db.ts` records for the careers form, in a
 * different shape. It costs nothing: the image itself is held in memory by `centreMap`, so a hit
 * here is a `Map` lookup and a write, not a call to Google.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ centre: string }> }) {
  const centre = centreByPath((await params).centre);
  // Same guard as the centre page: an unknown path is a 404, not a render.
  if (!centre) return new NextResponse(null, { status: 404 });

  const image = await centreMap(centre);
  /*
   * 404 rather than 500, and it should be unreachable from the site itself: the pages ask
   * `centreMap` first and omit the `<img>` entirely when there is nothing to show. This answers
   * somebody who typed the URL, or a page that raced a key going away.
   */
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(image.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': image.contentType,
      /*
       * An hour in the reader's browser. The container's own copy is held longer — see the TTLs in
       * `lib/staticMap.ts` — so this number only decides how often a returning reader re-asks *us*,
       * and it is short for the same unresolved reason the TTL there is: nobody has read Google's
       * terms on how long their content may be held.
       */
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
