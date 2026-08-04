import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast';
import { color, CONTRAST_PAIRS, target } from '../tokens';

/**
 * The accessibility claims in tokens.ts, enforced.
 *
 * A colour palette described as "WCAG AA" in a comment drifts the first time
 * somebody nudges a shade to look nicer. This makes the drift a failing test.
 */
describe('colour contrast', () => {
  for (const pair of CONTRAST_PAIRS) {
    it(`${pair.label}: ${pair.fg} on ${pair.bg} meets ${pair.min}:1`, () => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(ratio, `got ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(pair.min);
    });
  }
});

describe('touch targets', () => {
  // WCAG 2.2 AA (2.5.8) sets 24px as the floor. Ours is well above it because
  // the primary action is tapped one-handed by somebody holding a child.
  it('minimum clears the WCAG 2.2 floor', () => {
    expect(target.min).toBeGreaterThanOrEqual(24);
  });

  it('sizes are ordered', () => {
    expect(target.min).toBeLessThan(target.comfortable);
    expect(target.comfortable).toBeLessThan(target.primary);
  });
});

describe('state chip borders are decorative, and the text is what carries meaning', () => {
  const chips = [
    { name: 'ok', border: color.okBorder, fill: color.okSoft, text: color.ok },
    { name: 'warn', border: color.warnBorder, fill: color.warnSoft, text: color.warn },
    { name: 'breach', border: color.breachBorder, fill: color.breachSoft, text: color.breach },
  ];

  it('has borders below the 3:1 that WCAG 1.4.11 would require of an informative boundary', () => {
    // Asserted in the direction it is actually true. These are a visual affordance,
    // not information — and writing the measurement down stops a future comment
    // claiming conformance the numbers do not support, which is what happened once.
    for (const chip of chips) {
      expect(contrastRatio(chip.border, chip.fill)).toBeLessThan(3);
    }
  });

  it('so the text inside every chip must meet AA against its fill', () => {
    // This is the assertion that makes the one above acceptable. If a chip ever
    // stopped carrying a symbol and a word, the border would become the only signal
    // and would have to be roughly three times darker.
    for (const chip of chips) {
      expect(contrastRatio(chip.text, chip.fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
