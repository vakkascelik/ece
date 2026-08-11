/**
 * The product's own identity: its name, and the geometry of its mark.
 *
 * WHY THIS IS DATA IN `core` RATHER THAN AN SVG IN EACH APP
 *
 * Because there are three surfaces that draw it — the public website's masthead, the console's
 * rail, and the console's favicon — and this repo has already paid once for the shape where a
 * value is hand-maintained in two places. `globals.css` used to restate the token palette and
 * the two had silently diverged: the background was `#fafaf9` in one and `#faf9f7` in the
 * other, and the contrast test asserted the copy nobody was rendering. A logo drifting the same
 * way is quieter and more embarrassing.
 *
 * So the mark is three numbers-and-shapes here, and every surface reads them. `core` takes no
 * Node, no Next and no React Native, so this is data and never a component — the same
 * arrangement `tokens.ts` has with the stylesheets generated from it.
 *
 * WHY THE COLOURS ARE LITERALS AND NOT TOKENS
 *
 * They are not this product's palette. `#1b1a18` happens to equal `color.ink` today and the
 * white is not `surface`; the mark is a fixed asset from the design handoff, in its sanctioned
 * mono variant, and a mark that shifted when somebody adjusted the ink token would no longer be
 * the mark. Identity is not theme — the same reason a customer's own logo is not recoloured
 * into ours.
 */

/**
 * The product name.
 *
 * **Not cleared as a trade mark.** `doorway.co.nz` was confirmed available by the owner on
 * 2026-08-11, which is one of the three checks; an IPONZ search in the relevant classes and a
 * companies-register check have still not been run. See `unverified-claims` §19 before this
 * name goes onto anything that is expensive to change — a store listing, printed material, or
 * a second customer's site.
 */
export const PRODUCT_NAME = 'Doorway';

/**
 * The mono variant of the mark, on a 128 unit grid.
 *
 * A head and shoulders in a doorway: a rounded box, a circle, and a rounded bar. Three
 * primitives on purpose — a solid shape survives being small, which is why this reads at 16px
 * in a browser tab where an outline drawing would render as a smudge. That is the same
 * argument recorded against the Salix mark on the public site, where the line-drawing variant
 * had to be swapped for the solid tile.
 */
export const MARK = {
  /** Every coordinate below is on this grid, so a consumer can scale by dividing. */
  size: 128,
  box: { radius: 28, fill: '#1b1a18' },
  head: { cx: 64, cy: 45, r: 19, fill: '#ffffff' },
  shoulders: { x: 28, y: 74, width: 72, height: 23, radius: 11.5, fill: '#ffffff' },
} as const;
