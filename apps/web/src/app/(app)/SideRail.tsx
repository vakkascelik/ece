'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** Kept in step with the breakpoint in globals.css by hand; see the note below. */
const MOBILE = '(max-width: 767px)';

/**
 * The rail. A column above 768px, a slide-in drawer below it.
 *
 * WHY A DRAWER, HAVING ARGUED TWICE AGAINST ONE
 *
 * The first version was a bar across the top and the second collapsed it behind a button.
 * Both kept the navigation *in the flow*, and the argument for that was that an inline
 * expander needs no focus management. True, and beside the point: an expander still pushes
 * the page down when it opens, so the thing you were reading moves. A drawer overlays.
 *
 * The cost is real and is paid here rather than skipped. An overlay that covers the page IS
 * a modal, so this one has all of it: Escape closes, the scrim closes, focus moves in on
 * open and back to the button on close, Tab is trapped while it is over the page, and the
 * body cannot scroll behind it. My earlier note claiming a disclosure "needs a focus trap and
 * an escape key" was wrong about an inline expander and right about this.
 *
 * WHY THE BREAKPOINT IS ALSO IN JAVASCRIPT
 *
 * `role="dialog"` and `aria-modal` are attributes, and attributes do not respond to media
 * queries. Left on unconditionally they would tell a screen reader that the sidebar on a
 * 1440px desktop is a modal dialog trapping their focus — which it is not. So the semantics
 * are applied only when the drawer is actually a drawer, which needs `matchMedia`. The
 * duplication with the stylesheet is a real cost; the alternative is lying about the
 * structure at one of the two widths.
 *
 * The palette stays this product's own. The reference this was modelled on uses a dark
 * drawer; borrowing it would mean inventing a colour the token file does not have, and the
 * ask was about how the menu appears and disappears.
 */
export function SideRail({ head, children }: { head: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const sync = () => setDrawerMode(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /*
    Navigating closes it. This layout is not remounted between routes, so without this the
    drawer stays open on top of the page it just took you to — which reads as a tap that did
    nothing.
  */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    // Back to the control that opened it, not to the top of the document.
    toggle.current?.focus();
  }, []);

  useEffect(() => {
    if (!open || !drawerMode) return;
    const panel = drawer.current;
    panel?.querySelector<HTMLElement>('[data-drawer-close]')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      // `offsetParent` filters what CSS has hidden — without it Tab lands on the desktop-only
      // controls that are still in the DOM.
      const stops = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((el) => el.offsetParent !== null);
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // A drawer over a scrolling page scrolls the page behind it, which loses the reader's
    // place for the sake of an animation.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, drawerMode, close]);

  return (
    <aside className="side">
      <div className="side-head">
        <div className="side-ident">{head}</div>
        <button
          ref={toggle}
          type="button"
          className="secondary nav-toggle"
          aria-expanded={open}
          aria-controls="side-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
      </div>

      {/* Rendered only while it is over the page, so it cannot be tabbed to or clicked at
          desktop width where it does not exist. */}
      {drawerMode && open && <div className="side-scrim" onClick={close} aria-hidden="true" />}

      <div
        ref={drawer}
        id="side-nav"
        className={open ? 'side-collapse open' : 'side-collapse'}
        {...(drawerMode ? { role: 'dialog' as const, 'aria-modal': true, 'aria-label': 'Menu' } : {})}
      >
        <div className="side-drawer-head">
          <strong>Menu</strong>
          <button
            type="button"
            className="secondary drawer-close"
            data-drawer-close
            onClick={close}
          >
            <span aria-hidden="true">✕</span>
            <span className="visually-hidden">Close menu</span>
          </button>
        </div>
        {children}
      </div>
    </aside>
  );
}
