'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The sea reacts to the reader. Scroll position adds a horizontal offset on top of the CSS drift.
 *
 * This renders nothing. It is a behaviour attached to elements that server components already put
 * on the page and marked `data-parallax`, which keeps the markup static and the JavaScript to one
 * handler — the second client component in this app, after `NavLink`, and the site still ships no
 * framework, no scroll library and no polyfill.
 *
 * WHY EACH LINE OF THE HANDLER IS THE WAY IT IS. All four of these are failure modes rather than
 * preferences, and three of them fail silently:
 *
 *  1. **`capture: true` on `document`.** A `scroll` event does not bubble. Listening on `window`
 *     works only while the window is the scroller; the moment any ancestor becomes the scrolling
 *     box the effect dies with no error. The capture phase sees it either way.
 *  2. **`passive: true`.** Without it the browser must wait for this handler before it can scroll,
 *     which is the difference between a parallax and a stutter.
 *  3. **The `finally`.** If anything in the frame throws, the pending flag stays set and no further
 *     frame is ever scheduled — the waves freeze permanently after one bad frame. Clearing it in a
 *     `finally` means a dropped frame costs a frame.
 *  4. **Transform only.** `getBoundingClientRect` reads layout, so every write here is a
 *     `transform`; writing anything that affects layout would force a synchronous reflow per frame.
 *
 * `prefers-reduced-motion: reduce` returns before any listener is attached — not a no-op handler, no
 * listener at all — and the CSS drift is disabled by the same query in `globals.css`. The page has
 * to be finished with nothing moving, because that is the version most parents on older phones and
 * anyone with a vestibular disorder will see.
 */

/** Progress `p`: 0 when the element's centre is at the viewport bottom, 1 when it is at the top. */
type Transform = (p: number) => string;

const MOVES: Record<string, Transform> = {
  heroPearl: (p) => `translate3d(0, ${(-p * 46).toFixed(1)}px, 0) scale(${(1 + p * 0.02).toFixed(3)})`,
  glow: (p) => `translate3d(${(p * 60).toFixed(1)}px, ${(-p * 30).toFixed(1)}px, 0)`,
  boat: (p) => `translate3d(${(p * 180).toFixed(1)}px, ${(-p * 10).toFixed(1)}px, 0)`,
  wave1: (p) => `translate3d(${(p * -70).toFixed(1)}px, ${(p * 18).toFixed(1)}px, 0)`,
  wave2: (p) => `translate3d(${(p * 110).toFixed(1)}px, ${(p * 10).toFixed(1)}px, 0)`,
  wave3: (p) => `translate3d(${(p * -150).toFixed(1)}px, 0, 0)`,
  wave4: (p) => `translate3d(${(p * 120).toFixed(1)}px, 0, 0)`,
  wave5: (p) => `translate3d(${(p * -90).toFixed(1)}px, 0, 0)`,
  cluster: (p) => `translate3d(0, ${(-p * 34).toFixed(1)}px, 0)`,
};

export function Parallax() {
  /*
   * Re-collected per route. The app router swaps the tree without remounting this, so a set of
   * elements captured once would be a set of detached nodes after the first navigation — the
   * effect would appear to work on a hard load and be dead on every link click, which is the
   * shape of bug that gets reported as "it only works sometimes".
   */
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'));
    if (nodes.length === 0) return;

    let pending = 0;

    const frame = () => {
      try {
        const vh = window.innerHeight || 800;
        for (const el of nodes) {
          const move = MOVES[el.dataset.parallax ?? ''];
          if (!move) continue;
          const rect = el.getBoundingClientRect();
          const p = 1 - (rect.top + rect.height / 2) / vh;
          // Clamped so an element far off-screen does not accumulate an absurd offset.
          el.style.transform = move(Math.max(-1, Math.min(2, p)));
        }
      } finally {
        pending = 0;
      }
    };

    const onScroll = () => {
      if (pending) return;
      pending = requestAnimationFrame(frame);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Once immediately, so a page opened part-scrolled (a refresh, a #fragment) is not out of step.
    onScroll();

    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      if (pending) cancelAnimationFrame(pending);
    };
  }, [pathname]);

  return null;
}
