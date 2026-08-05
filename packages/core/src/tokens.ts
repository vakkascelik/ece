/**
 * Design tokens — plain data, consumed by both apps.
 *
 * Shared here rather than in a component library because the two surfaces need
 * genuinely different components: an educator holding a child needs large
 * targets and one-handed reach, a manager at a desk needs density. What they
 * must share is the vocabulary — the same green means the same thing in both.
 *
 * Web reads these through the Tailwind config. Mobile reads them through a
 * StyleSheet theme. Nothing here may import from either.
 */

/**
 * Colour.
 *
 * Every foreground/background pair used for text is checked to WCAG 2.2 AA
 * (4.5:1 for body, 3:1 for large text and UI boundaries). The ratios are
 * recorded so a future change has to consciously break them rather than drift.
 */
export const color = {
  // Surfaces
  bg: '#faf9f7',
  surface: '#ffffff',
  surfaceSunken: '#f2f1ee',
  line: '#e3e1dd',

  // Text. Measured against bg: ink 16.53:1, muted 6.23:1. Enforced by
  // __tests__/tokens.test.ts, not trusted to this comment.
  ink: '#1b1a18',
  inkMuted: '#605d58',
  inkInverse: '#ffffff',

  // Brand. Deliberately not the cream-and-terracotta that AI tooling defaults
  // to, and not a purple gradient. Green reads as growth without reading as
  // clinical, which suits early learning.
  accent: '#2f6f4f',
  accentHover: '#25583f',
  accentSoft: '#e8f1ec',

  /**
   * Ratio and compliance states.
   *
   * These are the most important colours in the product: an educator glances at
   * one of them across a room. They must be distinguishable at a distance AND
   * without colour vision — every use is paired with an icon and a text label,
   * never colour alone (WCAG 1.4.1).
   */
  ok: '#2f6f4f',
  okSoft: '#e8f1ec',
  warn: '#8a5a00', // 5.38:1 on warnSoft — a lighter amber fails AA, this does not
  warnSoft: '#fdf3e0',
  breach: '#a3341c',
  breachSoft: '#fbeae5',

  /**
   * Borders for the state chips.
   *
   * Here rather than written into two stylesheets and two React Native components,
   * which is where they were: five copies of #eccec4 with nothing keeping them equal.
   *
   * These are **decorative and measured between 1.17:1 and 1.45:1** against both the
   * fill and the page — well under the 3:1 that WCAG 1.4.11 asks of a non-text
   * boundary. That is deliberate and it is allowed, for a specific reason: 1.4.11
   * applies to boundaries that carry information, and these carry none. Every chip
   * states its meaning as a symbol *and* a word inside it, and that text is checked to
   * AA against the fill by `CONTRAST_PAIRS` below. Remove the text and these borders
   * would have to be about three times darker.
   *
   * (An earlier version of this comment claimed they satisfied 1.4.11. They do not,
   * and measuring beat asserting. The values changed on 2026-08-05 to match the
   * design handoff's token table, and the range above was re-measured rather than
   * carried over — the previous set sat at 1.23–1.41.)
   */
  okBorder: '#cfe2d7',
  warnBorder: '#ecd9ae',
  breachBorder: '#eccabe',

  // Pending sync. A queued-offline write is a normal state, not an error, so it
  // gets its own neutral-blue rather than borrowing the warning colour.
  pending: '#2f5d8a',
  pendingSoft: '#e9f0f7',
  // The fourth border, which the tinted-block set was missing — the offline strip
  // and the pending chip were falling back to `line`, a warmer grey that reads as
  // a different family from the blue it surrounds.
  pendingBorder: '#d3e0ed',
} as const;

export const space = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 24,
  '6': 32,
  '7': 48,
  '8': 64,
} as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const font = {
  /** Type scale. Mobile body is 17 rather than 15 — read at arm's length, standing. */
  size: { xs: 12, sm: 13, base: 15, mobileBase: 17, lg: 18, xl: 22, '2xl': 28, '3xl': 36 },
  weight: { regular: '400', medium: '500', semibold: '600' },
  lineHeight: { tight: 1.25, normal: 1.5, relaxed: 1.65 },
} as const;

/**
 * Touch targets.
 *
 * WCAG 2.2 AA (2.5.8) requires 24px minimum. That is a floor for compliance,
 * not a target for usability: the sign-in button gets tapped by someone with a
 * child on one hip and a bag in the other hand. 56px is the size that survives
 * that; 44px is the smallest anything interactive may be.
 */
export const target = { min: 44, comfortable: 56, primary: 64 } as const;

/**
 * Motion.
 *
 * Short, and every animation must be skippable. `prefers-reduced-motion` is
 * respected on both platforms — vestibular disorders are common and an app used
 * daily by staff is exactly where unskippable motion becomes intolerable.
 */
export const motion = {
  fast: 120,
  base: 180,
  slow: 260,
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/**
 * Shadows are near-flat by design, and there is exactly one place a shadow is used:
 * the modal dialog. `card` is the handoff's `0 1px 2px rgba(27,26,24,.06)`.
 *
 * `raised` is not in the design system and is currently consumed by nothing — left
 * in place rather than removed, because deleting it is unrelated to this change.
 */
export const elevation = {
  card: '0 1px 2px rgba(27, 26, 24, 0.06)',
  raised: '0 4px 12px rgba(27, 26, 24, 0.08)',
} as const;

/** Contrast pairs verified to WCAG 2.2 AA. Kept as data so a test can assert them. */
export const CONTRAST_PAIRS: readonly { fg: string; bg: string; min: number; label: string }[] = [
  { fg: color.ink, bg: color.bg, min: 4.5, label: 'body text' },
  { fg: color.inkMuted, bg: color.bg, min: 4.5, label: 'muted text' },
  { fg: color.inkMuted, bg: color.surface, min: 4.5, label: 'muted on card' },
  { fg: color.inkInverse, bg: color.accent, min: 4.5, label: 'primary button' },
  { fg: color.ok, bg: color.okSoft, min: 4.5, label: 'ratio ok' },
  { fg: color.warn, bg: color.warnSoft, min: 4.5, label: 'ratio warning' },
  { fg: color.breach, bg: color.breachSoft, min: 4.5, label: 'ratio breach' },
  { fg: color.pending, bg: color.pendingSoft, min: 4.5, label: 'pending sync' },
];

export const tokens = { color, space, radius, font, target, motion, elevation } as const;
