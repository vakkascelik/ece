import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEGACY_ROUTES, legacyRedirects } from '../legacyRoutes';

/**
 * The six URLs the 2018 site published.
 *
 * Hardcoded here rather than imported from the module under test, on purpose: a test that reads
 * its expectations out of the thing it is testing asserts only that the file parses. This list was
 * taken from the old site's own `sitemap.xml`, fetched over HTTP, and it is the fact the module is
 * supposed to match — so it belongs on this side of the assertion.
 */
const OLD_SITEMAP_PATHS = [
  '/index.html',
  '/our-staff---career.html',
  '/contact-us.html',
  '/enrolment---fees.html',
  '/our-centres.html',
  '/assets/little-pearls-educare--philosophy.pdf',
];

/**
 * Every route this app actually serves, read off the filesystem.
 *
 * The point of walking `src/app` instead of listing routes by hand is that a renamed page breaks
 * this test rather than breaking a redirect in production. A redirect map is a promise about
 * routes that exist somewhere else in the codebase, and nothing else in the build checks it.
 */
function actualRoutes(): Set<string> {
  const appDir = join(__dirname, '..', '..', 'app');
  const found = new Set<string>(['/']);

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      // Route groups `(x)` add no path segment; private folders `_x` are not routes at all.
      if (entry.startsWith('_')) continue;
      const segment = entry.startsWith('(') ? '' : `/${entry}`;
      const path = `${prefix}${segment}`;
      if (readdirSync(full).includes('page.tsx')) found.add(path || '/');
      walk(full, path);
    }
  };

  walk(appDir, '');
  return found;
}

describe('legacy URL map', () => {
  it('covers every path in the old sitemap, and nothing else', () => {
    expect(LEGACY_ROUTES.map((r) => r.from).sort()).toEqual([...OLD_SITEMAP_PATHS].sort());
  });

  it('sends every one of them to a route that exists', () => {
    const routes = actualRoutes();
    for (const { from, to } of LEGACY_ROUTES) {
      // `[centre]` is a dynamic segment; no legacy path targets one, and if that ever changes this
      // assertion should be revisited rather than loosened.
      expect(routes.has(to), `${from} -> ${to} — no such route`).toBe(true);
    }
  });

  it('never redirects a path to itself', () => {
    for (const { from, to } of LEGACY_ROUTES) expect(from).not.toBe(to);
  });

  // Asserts that a reason was written, not that it was long. The first version of this gated on
  // `note.length > 20` and failed on "Straight rename." — which is the correct note for a straight
  // rename. A test that pushes prose towards a word count makes the notes worse, not better.
  it('gives every mapping a stated reason', () => {
    for (const r of LEGACY_ROUTES) expect(r.note.trim()).not.toBe('');
  });

  /**
   * Stage F of the cutover promotes these to permanent. Until then a wrong redirect has to be
   * fixable by deploying, which a 308 is not — browsers cache it for the life of the profile.
   */
  it('is temporary by default and permanent only when asked', () => {
    expect(legacyRedirects().every((r) => r.permanent === false)).toBe(true);
    expect(legacyRedirects(true).every((r) => r.permanent === true)).toBe(true);
  });

  it('produces exactly the shape next.config expects', () => {
    for (const r of legacyRedirects()) {
      expect(Object.keys(r).sort()).toEqual(['destination', 'permanent', 'source']);
      expect(r.source.startsWith('/')).toBe(true);
      expect(r.destination.startsWith('/')).toBe(true);
    }
  });
});
