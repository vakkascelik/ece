import type { Centre } from '@/lib/centres';
import { centreMap, directionsUrl, mapPlaceUrl } from '@/lib/staticMap';

/**
 * A map of one centre, and the two things a reader does next.
 *
 * A SERVER COMPONENT THAT ASKS BEFORE IT RENDERS. It awaits `centreMap` purely to find out whether
 * there is an image, then emits an `<img>` pointing at `/api/map/<path>` — which serves the copy
 * that call has already put in memory, so the picture is fetched from Google once, not once per
 * element. Without the check, a missing key or an API that is not enabled would put a broken-image
 * icon on the contact page; with it, the page is simply the page it was before maps existed.
 *
 * **THE LINKS ARE NOT CONDITIONAL, ONLY THE PICTURE IS.** The first version of this returned `null`
 * outright when there was no image, which quietly took the "open in maps" link off `/contact` and
 * `/centres/*` — a page that had a working way to find the place would have lost it because an API
 * key was missing. The picture is the enhancement; the links are the content, and they render
 * whether or not Google answered.
 *
 * NOT `next/image`, for the reason `Photo.tsx` gives at more length: optimising a PNG that this
 * server just fetched, through a second request to `/_next/image`, is machinery in exchange for
 * nothing.
 *
 * THE ALT TEXT IS NOT DECORATIVE, and this is the one judgement call in the file. The image sits
 * inside a link, so its `alt` is the link's accessible name — an empty one would leave a screen
 * reader announcing "link" and nothing else. It names the destination rather than describing the
 * cartography, because "what happens if I press this" is the useful thing and the address is
 * already written out in text immediately below.
 */
export async function CentreMap({ centre }: { centre: Centre }) {
  const image = await centreMap(centre);

  return (
    <>
      {image && (
        <a className="map" href={mapPlaceUrl(centre)}>
          {/*
            `width`/`height` are the real pixel dimensions the API returns (600×300 at scale 2), so
            the browser reserves the right box before the bytes arrive. The CSS scales it down.
            Lazy, because on `/contact` there are two of these and neither is above the fold.
          */}
          <img
            src={`/api/map/${centre.path}`}
            alt={`Map showing Little Pearls ${centre.shortName} at ${centre.street}. Opens Google Maps.`}
            width={1200}
            height={600}
            loading="lazy"
            decoding="async"
          />
        </a>
      )}
      <p className="map-actions">
        <a className="btn" href={directionsUrl(centre)}>
          Get directions
        </a>
        {/*
          The phone number and not the word "Call". A parent on a laptop has nothing to press, and
          a button whose label hides the number makes them hunt for it — where the number itself is
          useful whether or not `tel:` does anything on that device.
        */}
        <a className="btn btn-quiet" href={`tel:${centre.phoneHref}`}>
          {centre.phone}
        </a>
      </p>
    </>
  );
}
