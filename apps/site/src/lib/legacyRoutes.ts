/**
 * The URLs the 2018 site published, and where they go now.
 *
 * Adobe Muse named pages after their navigation labels and encoded spaces and ampersands as
 * triple and double hyphens, which is why these look the way they do. All six are in the old
 * site's own `sitemap.xml`, which means all six are what Google indexed and what eight years of
 * inbound links point at. Measured against the new build before this file existed: every one of
 * them returned 404.
 *
 * WHY THIS IS A MODULE AND NOT SIX LINES IN next.config.ts
 *
 * So it can be tested. A redirect map is exactly the kind of thing that rots silently — a route
 * gets renamed, the redirect keeps pointing at the old name, and nothing fails until somebody
 * follows an eight-year-old link and lands on a 404 that nobody is watching for. The test asserts
 * every target against the routes that actually exist.
 *
 * WHY `permanent: false`
 *
 * A permanent redirect is cached by browsers for the life of the profile, which makes it the one
 * mistake that cannot be fixed by deploying — this repo has already been bitten by it once, when
 * a 308 pointed the Railway preview at the old website and clearing it required every visitor to
 * clear their own cache. These become permanent in Stage F of the cutover, after the live site has
 * been verified, and deliberately.
 */

export type LegacyRoute = {
  /** The path the old site published, exactly as it appeared in its sitemap. */
  readonly from: string;
  /** The route that now answers for it. */
  readonly to: string;
  /** Why this mapping and not another — read when the map is next edited. */
  readonly note: string;
};

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  {
    from: '/index.html',
    to: '/',
    note: 'Muse emitted an explicit index.html and linked to it by name from every page.',
  },
  {
    from: '/our-staff---career.html',
    to: '/careers',
    note: 'One page did staff and vacancies together; only the vacancies half survived, and the careers page is where an applicant expects to land.',
  },
  {
    from: '/contact-us.html',
    to: '/contact',
    note: 'Straight rename.',
  },
  {
    from: '/enrolment---fees.html',
    to: '/enrolment',
    note: 'The old page named fees and contained none. /enrolment is the honest successor; CONTENT-GAPS.md gap 6 tracks the fees themselves.',
  },
  {
    from: '/our-centres.html',
    to: '/centres',
    note: 'Straight rename. /centres lists both Mt Albert and Mt Roskill.',
  },
  {
    from: '/assets/little-pearls-educare--philosophy.pdf',
    to: '/philosophy',
    note: 'The PDF is deliberately not republished — its "shoe-free inside" claim was retracted by the manager on 2026-08-17, so re-serving the file would put a known-false claim back on the live site. The page carries the current philosophy instead.',
  },
] as const;

/**
 * Shaped for `next.config.ts`'s `redirects()`.
 *
 * `permanent` is a parameter rather than a constant so Stage F is a one-word change at the call
 * site instead of an edit to this list — and so the test can assert both states.
 */
export function legacyRedirects(permanent = false): Array<{ source: string; destination: string; permanent: boolean }> {
  return LEGACY_ROUTES.map(({ from, to }) => ({ source: from, destination: to, permanent }));
}
