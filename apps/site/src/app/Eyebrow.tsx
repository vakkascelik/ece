import type { ReactNode } from 'react';

/**
 * A pearl dot and a small uppercase label, above a section heading.
 *
 * THIS IS THE REPLACEMENT FOR THE DIVIDER GLYPH, and the distinction matters. The old teal dashed
 * mark was a *divider* — a thing between two sections — and it read as a missing image, which is
 * recorded at length in `globals.css` under `.rule`. This is a *label bullet*: it belongs to the
 * words beside it rather than sitting alone in whitespace, so there is nothing for it to be mistaken
 * for. Sections are still separated by the hairline rule and the 48px gap, as they were.
 *
 * A 9px pearl, drawn with the same radial gradient as the real ones. It is the smallest instance of
 * the page's one idea, and it is the reason the mark can be this plain: it means something here.
 *
 * `aria-hidden` on the dot, and the label is real text — a screen reader gets "Why pearls" and not
 * "bullet, Why pearls". The heading below still carries the document structure; this is a caption
 * for the eye.
 */
export function Eyebrow({
  children,
  tone = 'ink',
}: {
  children: ReactNode;
  /** `ocean` when the eyebrow sits on a dark band, where `--muted` would fail contrast. */
  tone?: 'ink' | 'ocean';
}) {
  return (
    <p className={`eyebrow eyebrow--${tone}`}>
      <span className="eyebrow__dot" aria-hidden="true" />
      {children}
    </p>
  );
}
