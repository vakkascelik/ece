import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTRES } from '../centres';

/**
 * The map proxy.
 *
 * Every test re-imports the module, because the cache is a module-level `Map` — sharing it across
 * cases would make each one depend on the order the others ran in, which is the class of test that
 * passes until somebody adds a fourth.
 */
async function freshModule() {
  vi.resetModules();
  return import('../staticMap');
}

const MT_ALBERT = CENTRES[0];

function pngResponse() {
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  // The 403 path logs, on purpose — see `staticMap.ts`. Silenced so a passing run is quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('centreMap', () => {
  it('does not call Google at all when the key is unset', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { centreMap, mapsConfigured } = await freshModule();

    expect(mapsConfigured()).toBe(false);
    await expect(centreMap(MT_ALBERT)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * The pin comes from the committed coordinates, not from the address string.
   *
   * This is the assertion that would fail if somebody "simplified" the URL builder to hand Google
   * the address and let it geocode — which works, and moves the decision about which building a
   * childcare centre is in from a reviewable value in `centres.ts` to a service call nobody sees.
   */
  it('centres and pins on the geocoded coordinates', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pngResponse());
    const { centreMap } = await freshModule();
    await centreMap(MT_ALBERT);

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    const at = `${MT_ALBERT.lat},${MT_ALBERT.lng}`;
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/staticmap');
    expect(url.searchParams.get('center')).toBe(at);
    expect(url.searchParams.get('markers')).toContain(at);
    expect(url.searchParams.get('key')).toBe('test-key');
    // Not the street, anywhere in the request.
    expect(url.search).not.toContain('Lorraine');
  });

  it('serves the second reader from memory rather than calling Google twice', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pngResponse());
    const { centreMap } = await freshModule();

    const first = await centreMap(MT_ALBERT);
    const second = await centreMap(MT_ALBERT);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * The guard that matters most, and the failure it prevents is live right now: as of 2026-08-07
   * the Maps Static API is not enabled on the Google Cloud project, so every request comes back
   * 403 with a **plain-text** body explaining that. Without the content-type check a 200-shaped
   * variant of that would be cached and then served as `image/png` for hours — a contact page
   * whose map is Google's error message rendered as a broken file.
   */
  it('refuses a 200 that is not an image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('This API is not activated on your API project.', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
      }),
    );
    const { centreMap } = await freshModule();
    await expect(centreMap(MT_ALBERT)).resolves.toBeNull();
  });

  it('treats a 403 as no map rather than throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('This API is not activated on your API project.', { status: 403 }),
    );
    const { centreMap } = await freshModule();
    await expect(centreMap(MT_ALBERT)).resolves.toBeNull();
  });

  it('treats a network failure as no map rather than throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const { centreMap } = await freshModule();
    await expect(centreMap(MT_ALBERT)).resolves.toBeNull();
  });

  it('does not hammer Google after a failure', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 403 }));
    const { centreMap } = await freshModule();

    await centreMap(MT_ALBERT);
    await centreMap(MT_ALBERT);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * A blip at Google must not blank a page that was working a second ago.
   *
   * The clock is faked past the good TTL so the second call really does go out and really does
   * fail — asserting on the stale image without that would only prove the cache was still warm.
   */
  it('keeps the last good image when a later refresh fails', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pngResponse());
    const { centreMap } = await freshModule();

    const good = await centreMap(MT_ALBERT);
    expect(good).not.toBeNull();

    vi.advanceTimersByTime(7 * 60 * 60 * 1000);
    fetchSpy.mockResolvedValue(new Response('upstream is having a moment', { status: 500 }));

    await expect(centreMap(MT_ALBERT)).resolves.toEqual(good);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * `/api/health` reporting why there is no map.
 *
 * This exists because of a real morning spent guessing: the centre manager asked why the contact
 * page showed no map, the health endpoint said the key was set, and the only place the reason
 * existed was the container log.
 */
describe('mapsStatus', () => {
  it('says nothing before anything has been attempted', async () => {
    const { mapsStatus } = await freshModule();
    // Empty means "not attempted since the restart", never "working" — asserted so the health
    // route's wording and this function cannot drift apart.
    expect(mapsStatus()).toEqual([]);
  });

  it('reports the refusal Google actually gave, per centre', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('This API project is not authorized to use this API.', { status: 403 }),
    );
    const { centreMap, mapsStatus } = await freshModule();

    await centreMap(MT_ALBERT);
    const status = mapsStatus();

    expect(status).toHaveLength(1);
    expect(status[0].centre).toBe(MT_ALBERT.path);
    expect(status[0].why).toContain('403');
    // The sentence itself, because "403" alone does not distinguish "API not enabled" from
    // "billing is off" from "this key is referrer-restricted" — which is the whole point.
    expect(status[0].why).toContain('not authorized');
  });

  it('reports a network failure too, not only an HTTP refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const { centreMap, mapsStatus } = await freshModule();

    await centreMap(MT_ALBERT);
    expect(mapsStatus()[0].why).toContain('ENOTFOUND');
  });

  it('says nothing once the map is working', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pngResponse());
    const { centreMap, mapsStatus } = await freshModule();

    await centreMap(MT_ALBERT);
    expect(mapsStatus()).toEqual([]);
  });

  /**
   * THE ONE THAT MATTERS FOR SAFETY. This text is served on a public endpoint, so a refusal that
   * echoed the request URL would publish the API key. Google's refusals are sentences and do not
   * echo it — this is insurance against the day one does, and "the error message contained the
   * credential" is a well-worn way for a key to end up published.
   */
  it('never lets an API key reach the response, even if Google echoes the URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'Bad Request: https://maps.googleapis.com/maps/api/staticmap?center=1,2&key=SECRET_KEY_VALUE',
        { status: 400 },
      ),
    );
    const { centreMap, mapsStatus } = await freshModule();

    await centreMap(MT_ALBERT);
    const why = mapsStatus()[0].why;

    expect(why).not.toContain('SECRET_KEY_VALUE');
    expect(why).toContain('key=<redacted>');
  });
});

describe('the links out', () => {
  it('encode the address and use the versioned URL form', async () => {
    const { directionsUrl, mapPlaceUrl } = await freshModule();

    // `?api=1` is Google's documented, stable shape — the one that opens the native app on a phone.
    expect(mapPlaceUrl(MT_ALBERT)).toBe(
      'https://www.google.com/maps/search/?api=1&query=2a%20Lorraine%20Avenue%2C%20Mount%20Albert%2C%20Auckland%201025',
    );
    expect(directionsUrl(MT_ALBERT)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=2a%20Lorraine%20Avenue%2C%20Mount%20Albert%2C%20Auckland%201025',
    );
  });

  it('give directions with no origin, so Google uses the reader s own location', async () => {
    const { directionsUrl } = await freshModule();
    expect(new URL(directionsUrl(MT_ALBERT)).searchParams.get('origin')).toBeNull();
  });
});
