/**
 * The four social marks, drawn here rather than fetched.
 *
 * WHY DRAWN AND NOT AN ICON SET. The site's standing rule is no new dependencies — no CSS
 * framework, no icon library, no SVG sprite — and it holds for four glyphs. These are inline, so
 * they cost no request, and `img-src 'self' data:` never has to widen for them.
 *
 * WHY `currentColor` AND NOT THE BRAND COLOURS. Four saturated logos on the ocean band would be
 * four accents in a footer, on a site whose whole design rule is one accent. Facebook blue and
 * Instagram's gradient also both fail contrast against `--ocean-deep`. Inheriting the footer's own
 * white keeps them legible, keeps the row reading as one thing, and sidesteps reproducing somebody
 * else's brand colour incorrectly — which is a worse outcome than a monochrome glyph.
 *
 * THE SHAPES ARE DELIBERATELY THE SIMPLE, GEOMETRIC FORM OF EACH MARK — a lettered circle, a
 * rounded square with a lens, two crossed strokes, two dots. That is the honest limit of what can
 * be drawn accurately from primitives, and a recognisable simplification is better than a bad
 * freehand trace of a trademark. Anybody wanting the exact marks should take them from each
 * company's own brand assets, at which point the note above about `currentColor` has to be
 * revisited, because most of those guidelines forbid recolouring.
 *
 * NO ACCESSIBLE NAME HERE. Every icon is `aria-hidden` and the link beside it carries a visually
 * hidden label — see `layout.tsx`. An icon that names itself *and* sits in a named link is read
 * out twice.
 */
export function SocialIcon({ name }: { name: string }) {
  const shape = SHAPES[name];
  if (!shape) return null;

  return (
    <svg
      className="social-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

/*
 * Keyed by the `name` in `SOCIAL_LINKS`. A name with no shape renders nothing rather than a box
 * with a question mark in it — adding a fifth account without a glyph should cost a missing icon,
 * not a broken footer.
 */
const SHAPES: Record<string, React.ReactNode> = {
  /* A filled disc with the letter reversed out, which is the mark's essential form at 20px. */
  Facebook: (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M13.2 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.1 1.2-1.1h1.2V5.8c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8H8.7V13h2.1v6z"
        fill="var(--ocean-deep)"
      />
    </>
  ),

  /* Rounded square, lens, and the corner dot. Strokes so it reads at 20px rather than filling in. */
  Instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
    </>
  ),

  /* Two crossed strokes. `strokeLinecap` square, because the mark has no rounded terminals. */
  X: (
    <>
      <path d="M4 4 L20 20 M20 4 L4 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
    </>
  ),

  /* Two dots, which is the whole mark. */
  Flickr: (
    <>
      <circle cx="8" cy="12" r="4.2" fill="currentColor" />
      <circle cx="17" cy="12" r="4.2" fill="currentColor" opacity="0.65" />
    </>
  ),
};
