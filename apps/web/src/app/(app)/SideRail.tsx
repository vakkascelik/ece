'use client';

import { useState, type ReactNode } from 'react';

/**
 * The rail, and on a phone the one thing that collapses it.
 *
 * WHY THIS EXISTS, AFTER ARGUING IT SHOULDN'T
 *
 * The first fix for the rail on a narrow screen turned it into a bar across the top,
 * with the reasoning that a disclosure "needs state, a focus trap and an escape key,
 * all to save vertical space on a surface that scrolls anyway". Two of those three
 * claims were wrong and the third was not the point:
 *
 *  - A focus trap and an Escape handler belong to a **modal**. This is an inline
 *    expander. Focus moves through it in DOM order and nothing needs trapping.
 *  - The vertical space was not a rounding error. Measured at 393x852: the bar was
 *    312px, so **37% of the screen was navigation before any content began**. On a
 *    phone that is the whole first screenful.
 *
 * So: collapsed behind one 44px control on narrow screens, always open above 768px
 * where the rail has a column of its own. The toggle is hidden by CSS at that width
 * rather than removed, so the links are in the DOM at every viewport — which is also
 * what keeps the role-based navigation assertions in the e2e suite meaningful.
 *
 * "☰ Menu" carries a word as well as the glyph, per the design pack: no control in this
 * product is a bare symbol.
 */
export function SideRail({ head, children }: { head: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <aside className="side">
      <div className="side-head">
        <div className="side-ident">{head}</div>
        <button
          type="button"
          className="secondary nav-toggle"
          aria-expanded={open}
          aria-controls="side-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
      </div>

      <div className={open ? 'side-collapse open' : 'side-collapse'} id="side-nav">
        {children}
      </div>
    </aside>
  );
}
