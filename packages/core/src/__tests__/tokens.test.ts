import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast';
import { CONTRAST_PAIRS, target } from '../tokens';

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
