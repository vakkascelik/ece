import type { Centre } from './centres';

/**
 * A map of each centre, fetched by **this server** and served from **this origin**.
 *
 * WHY THIS EXISTS WHEN A MAP WAS EXPLICITLY REJECTED
 *
 * `llm-wiki/wiki/public-website.md` listed "a Google Maps embed" under Rejected, and
 * `securityHeaders.ts` said the same: *"an iframe is a third party on a page read by parents of
 * three-month-olds, and `frame-src 'none'` stays"*. That reasoning is intact and this does not
 * contradict it — it satisfies it. What was rejected was **the browser talking to Google**, not
 * the picture. An embed loads Google's JavaScript into the page, sets Google's cookies in the
 * parent's browser, and hands Google the IP address of everyone who reads the contact page. None
 * of that is a property of a map; it is a property of an iframe.
 *
 * So: the container fetches a PNG from the Maps Static API, holds it in memory, and serves it from
 * `/api/map/<centre>`. The reader's browser makes one request, to this origin, for an image.
 *
 * **The CSP is unchanged.** `img-src` is still `'self' data:` and `frame-src` is still `'none'` —
 * verified by there being no edit to `securityHeaders.ts` in the commit that added this, other than
 * to the comment that said a map had been refused. `connect-src 'self'` also still describes the
 * app: nothing here runs in a browser. The same test that proves it for the Supabase key proves it
 * here — the variable is unprefixed, so Next cannot inline `GOOGLE_MAPS_API_KEY` into client
 * JavaScript even by accident, exactly as `lib/db.ts` describes for `SUPABASE_ANON_KEY`.
 *
 * WHAT IS NOT SETTLED, AND IS IN CONTENT-GAPS.md
 *
 * Google's Maps Platform terms restrict how long their content may be cached, and serving it from
 * our own origin is caching. Nobody here has read the current terms, so the TTL below is set short
 * and conservative rather than argued to a limit — and if the answer turns out to be that the
 * image must be requested by the reader's browser, the change is `img-src` plus a URL, and the
 * privacy cost of that is the thing to weigh at the time. Do not treat the number below as a
 * finding about the terms.
 */

const ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';

/**
 * 600×300 at `scale=2`, so 1200×600 real pixels.
 *
 * `size` is capped at 640 on the standard tier and `scale` multiplies the output without touching
 * that cap — which is the only way to get a map that is not soft on a phone. The card it sits in is
 * about 340px wide at the narrowest layout, so 1200 is more than enough for a 3× display.
 */
const WIDTH = 600;
const HEIGHT = 300;
const SCALE = 2;

/** Close enough to see the street it is on and the cross streets either side. */
const ZOOM = 16;

/** Their coral, darkened to `--coral-ink`, which is the one that stays legible on a pale map. */
const MARKER_COLOUR = '0xc12727';

/** How long a successful image is held. Deliberately conservative — see the note above. */
const GOOD_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a failure is remembered.
 *
 * Short, and it is the difference between a fixable mistake and a redeploy. The Maps Static API is
 * a *separate* API to enable in the Google Cloud console from the Geocoding one, and with it off
 * every request returns 403 with a plain-text body. Somebody who ticks the box should see maps
 * appear within the quarter hour rather than having to work out that the container is holding on
 * to a "no".
 */
const BAD_TTL_MS = 15 * 60 * 1000;

/** Google is a third party on the render path. Five seconds, then the page renders without a map. */
const TIMEOUT_MS = 5000;

export interface MapImage {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * `why` is the last refusal, kept so `/api/health` can say *why* there is no map rather than only
 * that there is none. See `mapsStatus()`.
 */
type Entry = { image: MapImage | null; at: number; why?: string };

/**
 * In-memory, per container, keyed by centre path. Two entries, forever.
 *
 * NOT `fetch(..., { next: { revalidate } })`, and that is a deliberate rejection rather than an
 * oversight. The root layout is `force-dynamic`, which changes the *default* caching of `fetch`,
 * and whether an explicit `next.revalidate` wins over that default is a question about Next's
 * internals that would have to be re-answered on every upgrade. A `Map` and a timestamp behave the
 * same way on every version, are readable by anyone, and cost about fifteen lines.
 *
 * The consequence worth knowing: a restart empties it, so the first reader after a deploy pays one
 * round trip to Google. At this traffic that is the right trade.
 */
const cache = new Map<string, Entry>();

/**
 * Set on the Railway service, unprefixed on purpose — see the note above, and `lib/db.ts` for the
 * same decision made for the same reason about the Supabase key.
 */
export function mapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

function staticMapUrl(centre: Centre, key: string): string {
  const at = `${centre.lat},${centre.lng}`;
  const params = new URLSearchParams({
    center: at,
    zoom: String(ZOOM),
    size: `${WIDTH}x${HEIGHT}`,
    scale: String(SCALE),
    maptype: 'roadmap',
    // So the labels come back in the language and the conventions of the country the centre is in,
    // rather than of whichever server happens to answer.
    language: 'en-NZ',
    region: 'NZ',
    markers: `color:${MARKER_COLOUR}|${at}`,
    key,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * The map for one centre, or `null` if there is not one to show.
 *
 * `null` is a normal answer, not an error: the key may be unset in development, the API may not be
 * enabled on the project, or Google may be having a bad minute. Every caller renders the address
 * and the link out regardless, so a missing map costs a picture and nothing else. The alternative —
 * letting the page emit an `<img>` and find out in the reader's browser — puts a broken-image icon
 * on the contact page of a childcare centre, which is worse than no map by a distance.
 *
 * On a failure with a good image already in hand, **the old image is kept**. A blip at Google must
 * not blank a page that was working a second ago.
 */
export async function centreMap(centre: Centre): Promise<MapImage | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;

  const cached = cache.get(centre.path);
  if (cached) {
    const ttl = cached.image ? GOOD_TTL_MS : BAD_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.image;
  }

  try {
    const response = await fetch(staticMapUrl(centre, key), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Next's own fetch cache is deliberately bypassed; the Map above is the cache.
      cache: 'no-store',
    });

    /*
     * A 403 here is almost always "Maps Static API is not enabled on this project" — the body says
     * so in plain text, and it is a different API to the Geocoding one the coordinates in
     * `centres.ts` came from. Logged rather than swallowed, because the alternative is a site that
     * silently has no maps and nobody knows why.
     */
    if (!response.ok) {
      const why = `HTTP ${response.status}: ${scrub(await response.text()).slice(0, 200)}`;
      console.error(`[map] ${centre.path}: Google returned ${why}`);
      return remember(centre.path, cached?.image ?? null, why);
    }

    const contentType = response.headers.get('content-type') ?? 'image/png';
    // Guards against caching an error page as if it were an image — the API answers `text/plain`
    // on refusal, and a 200 with a text body would otherwise be served as a PNG forever.
    if (!contentType.startsWith('image/')) {
      const why = `expected an image, got ${contentType}`;
      console.error(`[map] ${centre.path}: ${why}`);
      return remember(centre.path, cached?.image ?? null, why);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return remember(centre.path, { bytes, contentType });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error(`[map] ${centre.path}: ${why}`);
    return remember(centre.path, cached?.image ?? null, why);
  }
}

/**
 * Never let a key reach a response body, however unlikely.
 *
 * Google's refusals are sentences — "This API project is not authorized to use this API" — and do
 * not echo the request. This is insurance, not a fix for an observed leak: `mapsStatus()` puts this
 * text on a public endpoint, and "the error message turned out to contain the credential" is a
 * well-worn way for a key to get published.
 */
function scrub(text: string): string {
  return text.replace(/key=[^&\s"']+/gi, 'key=<redacted>');
}

function remember(path: string, image: MapImage | null, why?: string): MapImage | null {
  cache.set(path, { image, at: Date.now(), why });
  return image;
}

/**
 * Why there is no map, for `/api/health`.
 *
 * THE PROBLEM THIS SOLVES, observed on 2026-08-16. The centre manager asked why the contact page
 * showed no map. From outside the container the two states are identical — `CentreMap` renders the
 * links and no image either way — and `mapsConfigured()` said `true`, so the key was set and
 * something else was refusing. The only place the reason existed was the container log.
 *
 * This does **not** call Google. It reports what the last real page render already found out, which
 * is the distinction the health route's own note draws: a health check that fails because a third
 * party is slow rolls back a container that is fine.
 *
 * The consequence of that, and it is worth knowing before reading an empty result: nothing here is
 * populated until somebody loads `/contact` or a centre page after the container starts. An empty
 * list means "not attempted since the last restart", never "working".
 */
export function mapsStatus(): { centre: string; why: string; agoMinutes: number }[] {
  const out: { centre: string; why: string; agoMinutes: number }[] = [];
  for (const [centre, entry] of cache) {
    if (!entry.why) continue;
    out.push({ centre, why: entry.why, agoMinutes: Math.round((Date.now() - entry.at) / 60000) });
  }
  return out;
}

/**
 * The two links out, in one place.
 *
 * Both pages built the query string inline and identically, which is the duplication this repo has
 * been bitten by before. `?api=1` is Google's documented, versioned URL form — the shape that keeps
 * working and opens the native app on a phone rather than the web view.
 */
function addressQuery(centre: Centre): string {
  return encodeURIComponent(`${centre.street}, ${centre.suburb} ${centre.postcode}`);
}

/** "Look at this place." The address string, which was verified to resolve — see `centres.ts`. */
export function mapPlaceUrl(centre: Centre): string {
  return `https://www.google.com/maps/search/?api=1&query=${addressQuery(centre)}`;
}

/** "Take me there from wherever I am." No origin, so Google uses the reader's own location. */
export function directionsUrl(centre: Centre): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${addressQuery(centre)}`;
}
