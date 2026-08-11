'use client';

import { useEffect } from 'react';
import { NAV_CLOSED_COOKIE } from './navGroups';

/**
 * Remembers which nav groups are collapsed, and nothing else.
 *
 * WHY THIS IS THE ONLY CLIENT CODE THE GROUPS NEED
 *
 * The collapsing itself is native `<details>` — no JavaScript, works before hydration, keyboard
 * operable, announced correctly. What native HTML cannot do is survive a navigation, and a
 * disclosure that resets every time you click a link is worse than no disclosure at all: you
 * close Money, open Attendance, and Money is back. Nobody tries it a third time.
 *
 * So this listens and writes a cookie, and the server renders the `open` attribute from it on
 * the next request. Rendering it from JavaScript instead would flash every group open on first
 * paint and then collapse them, on every page load, forever.
 *
 * ONE LISTENER FOR THE WHOLE RAIL
 *
 * Mounted once beside the nav rather than making `NavGroup` a client component — `NavGroup`
 * stays a server component, which is what keeps the six groups out of the JavaScript payload.
 * The `toggle` event does not bubble, so this listens in the **capture** phase on the nav,
 * where it sees every group's toggle without one handler per group.
 *
 * IT IS A PREFERENCE, NOT A PERMISSION
 *
 * The cookie is client-controlled and anybody can set it to anything. All it can do is decide
 * whether a `<details>` renders open. What each group *contains* is decided by the `can()`
 * calls in `layout.tsx`, and what those links reach is decided in Postgres — a forged value
 * here collapses a group or expands one, and that is the whole blast radius.
 *
 * `SameSite=Lax` and no `Secure` in development: this is a layout preference on a first-party
 * request, and marking it `Secure` would silently stop it working on `http://localhost`, which
 * is where it is most often looked at.
 */
export function NavGroupMemory() {
  useEffect(() => {
    const nav = document.querySelector('nav');
    if (!nav) return;

    const onToggle = (event: Event) => {
      const el = event.target as HTMLElement | null;
      if (!(el instanceof HTMLDetailsElement) || !el.dataset.group) return;

      // Read the DOM rather than tracking state here. The elements are the source of truth —
      // one of them has just changed and the rest are however the reader left them, so
      // re-deriving the whole list cannot drift from what is on screen.
      const closed = Array.from(nav.querySelectorAll<HTMLDetailsElement>('details[data-group]'))
        .filter((d) => !d.open)
        .map((d) => d.dataset.group as string);

      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `${NAV_CLOSED_COOKIE}=${closed.join(',')}; path=/; max-age=${oneYear}; samesite=lax`;
    };

    // Capture, because `toggle` does not bubble.
    nav.addEventListener('toggle', onToggle, true);
    return () => nav.removeEventListener('toggle', onToggle, true);
  }, []);

  return null;
}
