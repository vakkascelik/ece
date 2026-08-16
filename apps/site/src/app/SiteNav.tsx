'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NAV } from '@/lib/nav';

/**
 * The main navigation: seven links, in a row beside the brand where they fit, behind a Menu button
 * on a phone.
 *
 * WHY THIS IS NOT `<details>`, HAVING BEEN WRITTEN AS `<details>` FIRST
 *
 * A native disclosure was the obvious choice and it is the one I built. It opens with no JavaScript
 * at all, the browser supplies the button role, the keyboard handling and the expanded state, and
 * there is no hydration flash. The one thing it has to do that it cannot is **stay open on
 * desktop**, where the same seven links have to be a visible row rather than a disclosure — and a
 * server render cannot know the viewport, so the `open` attribute cannot be set for one width and
 * not the other.
 *
 * The documented trick for that is to override the browser's hiding of a closed `<details>`'
 * content with `display: flex`. **It does not work, and it fails in the worst possible way.**
 * Measured in Chromium: the `<nav>` gets a real layout box — 725×44 at 1440, `display: flex`,
 * `visibility: visible`, `opacity: 1` — while its `<details>` parent stays 0px tall, and the content
 * is never painted or hit-tested. `elementFromPoint` at the nav's own coordinates returns the
 * container behind it. So every check that reads a rect or a computed style says the navigation is
 * fine, and the navigation is invisible and unclickable. My first verification pass did exactly
 * that and passed; the screenshot is what caught it.
 *
 * `::details-content` is the modern fix and was rejected: where it is unsupported the rule is
 * ignored and the desktop nav simply vanishes, which is not a failure mode to ship to browsers I
 * cannot test here.
 *
 * SO THE STATE IS EXPLICIT, AND THE NO-JAVASCRIPT CASE IS COVERED TWICE INSTEAD
 *
 * This is a `useState` disclosure, which means the panel is hidden in the server HTML and revealed
 * by script. On its own that would mean a failed bundle costs a phone visitor every link on the
 * site — not hypothetical here, since every script on every page was once refused in production by
 * a CSP the prerendered pages could not satisfy. Two independent fallbacks, because they cover
 * different failures:
 *
 *  1. **`<noscript>`** in `layout.tsx` forces the row open and hides the button. Covers scripting
 *     being *disabled*.
 *  2. **The footer carries all seven links**, in its own labelled `<nav>`, server-rendered and
 *     needing nothing. Covers the bundle failing to run — which `<noscript>` does *not*, because
 *     the browser considers scripting enabled right up until the script errors.
 *
 * ONE `<nav>` HERE, NOT TWO. The alternative — a desktop nav and a mobile nav hidden from each
 * other by media queries — puts these seven links in the document twice and gives a screen reader
 * two "Main" navigation landmarks listing the same pages. The footer's list is a second landmark,
 * but it is labelled differently and is genuinely a different thing.
 */

/*
 * The list is in `lib/nav.ts` rather than here, and that is a bug fix — see the note in that file.
 * A server component cannot import a value out of a `'use client'` module: it gets a client
 * reference instead of the array, and the footer's copy of these links 500'd every route.
 */
const NAV_ID = 'site-nav';

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /*
   * Close after a navigation. The app router swaps the page without unmounting this, so a panel
   * opened to tap "Rooms" would still be covering the top of the page it just went to.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* Escape closes it. Expected of anything that opens over the page, and cheap. */
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="nav-shell" data-open={open ? 'true' : undefined}>
      {/*
        A real `<button>`, so it is focusable, in the tab order and operable with Enter and Space
        without any of that being reimplemented. `aria-expanded` and `aria-controls` are explicit
        here — with `<details>` the browser supplied them, and this is the cost of not using it.

        The accessible name is the word "Menu" beside the bars rather than only a label on an icon:
        an icon-only control is one more thing to guess at, and there is room for four characters.
      */}
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={NAV_ID}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="nav-toggle__bars" aria-hidden="true" />
        Menu
      </button>

      <nav className="nav" id={NAV_ID} aria-label="Main">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            /*
              `aria-current` is what the stylesheet keys the current-item treatment off, rather than
              a class — so what a screen reader announces and what the eye sees cannot drift apart,
              and "looks current but is not announced as current" stops being a possible state. Same
              rule as the platform's rail, for the same reason.
            */
            aria-current={
              (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))
                ? 'page'
                : undefined
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
