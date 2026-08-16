/**
 * The seven pages, in the order they appear in both navigations.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT AN EXPORT FROM `SiteNav.tsx`, which is where it started.
 *
 * `SiteNav.tsx` is `'use client'`. A server component importing a value from a client module does
 * not get the value — Next replaces every export of a client module with a *client reference*, a
 * proxy the bundler swaps in at hydration time. The layout's footer nav therefore called `.map` on
 * an object that is not an array, and every route returned **500**:
 *
 *     TypeError: p.NAV.map is not a function
 *
 * It compiles, it typechecks, and it fails at request time on every page. The boundary is a
 * bundler transform rather than anything TypeScript can see.
 *
 * So the list lives in a plain module that both sides import: the masthead nav (client) and the
 * footer nav (server). One array, which is the point — the footer is the no-JavaScript fallback for
 * the masthead, and a fallback listing different pages from the thing it stands in for is worse
 * than no fallback.
 */
export interface NavItem {
  href: string;
  label: string;
}

export const NAV: readonly NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/philosophy', label: 'Our philosophy' },
  { href: '/centres', label: 'Our centres' },
  { href: '/rooms', label: 'Rooms' },
  { href: '/enrolment', label: 'Enrolment' },
  { href: '/careers', label: 'Careers' },
  { href: '/contact', label: 'Contact' },
];
