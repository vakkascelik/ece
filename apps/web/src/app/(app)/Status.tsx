import type { ReactNode } from 'react';

/**
 * One state chip, in four tones.
 *
 * WHAT WAS AD-HOC ABOUT THE FLAGS
 *
 * Not the CSS — `.flag` and its modifiers were already one block. What varied was the
 * *symbol*, typed by hand at every call site: warn appeared as `●` on one screen and `◌`
 * on the next, ok as `✓` here and nothing there. A tone whose glyph changes between
 * screens is a tone a reader has to re-learn, and the glyph is not decoration here — it is
 * the half of WCAG 1.4.1 that keeps the meaning off colour alone, for the roughly one man
 * in twelve who cannot separate the red from the green reliably. Binding the symbol to the
 * tone makes that structural instead of a habit.
 *
 * THE FIFTH TONE
 *
 * The handover specifies four — ok, pending, warn, breach — and its own mockup of the
 * incidents strip draws a fifth: "3 awaiting acknowledgement" in grey, beside an amber
 * draft count and a red one. That is a real category and it is not any of the four. It is
 * not `pending` either, which in this product means *waiting to reach the server* — the
 * offline queue's blue. Rendering "3 awaiting acknowledgement" in that blue would tell an
 * educator three reports are stuck in the outbox.
 *
 * So `neutral` exists, it carries no symbol because it reports no state, and the four named
 * tones mean exactly what the handover says they mean.
 *
 * THE SYMBOL IS `aria-hidden`
 *
 * A screen reader announcing "black up-pointing triangle, 1 whānau not told" is worse than
 * announcing the sentence. Every label here is complete without its glyph — that is a
 * requirement of using this component, not a coincidence — and 1.4.1 is about what the eye
 * can distinguish. Same treatment the ☰ and the `?` already get.
 */
const TONES = {
  ok: { className: 'flag-ok', symbol: '✓' },
  /** Waiting to reach the server. The offline queue's blue, and nothing else's. */
  pending: { className: 'flag-pending', symbol: '↻' },
  warn: { className: 'flag-warn', symbol: '●' },
  breach: { className: 'flag-critical', symbol: '▲' },
  /** A count that is context rather than state. No symbol: there is nothing to signal. */
  neutral: { className: 'flag-quiet', symbol: null },
} as const;

export type StatusTone = keyof typeof TONES;

export function Status({
  tone,
  symbol,
  children,
}: {
  tone: StatusTone;
  /**
   * Overrides the tone's glyph. One meaning earns it: `◌` for "nobody has answered this
   * yet", which is warn-toned but is an absence rather than a problem — an unanswered
   * consent and an expired certificate should not look identical at a glance.
   */
  symbol?: string;
  children: ReactNode;
}) {
  const { className, symbol: fallback } = TONES[tone];
  const glyph = symbol ?? fallback;

  return (
    <span className={`flag ${className}`}>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}
