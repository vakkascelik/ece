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

/**
 * Little Pearls Educare Centre's own brand, for the public website in `apps/site`.
 *
 * WHY THIS IS A SEPARATE EXPORT AND NOT A CHANGE TO `color`
 *
 * `color` above is the *platform's* design system — the thing the mobile theme reads and the
 * thing the design pack specifies. This is one tenant's public identity. They are different
 * systems that happen to live in one file so that neither is duplicated in a stylesheet, which
 * is the failure this package exists to prevent.
 *
 * WHERE THE VALUES CAME FROM
 *
 * Read out of their existing site's CSS (Adobe Muse output, untouched since 2018), not invented.
 * Their teal was authored three times as `#83AFAF`, `#83ADAF` and `#83AEAF`; that is
 * inconsistent authoring rather than three colours, so it is one value here.
 *
 * THE PART THAT MATTERS: NONE OF THEIR COLOURS CAN CARRY TEXT
 *
 * Measured with `contrastRatio`, against the 4.5:1 that WCAG 2.2 AA asks of body text:
 *
 *     white on teal      2.41:1   FAILS
 *     white on coral     2.88:1   FAILS
 *     white on pink      2.12:1   FAILS
 *     white on tealMid   1.81:1   FAILS
 *     teal text on white 2.41:1   FAILS
 *     coral text on white 2.88:1  FAILS
 *
 * So the light palette is **background only**, where dark text sits on it comfortably (grey body
 * on `aquaPale` is 6.47:1, black on `teal` is 8.72:1). Anything that needs white text, or needs
 * to *be* text, uses the `Ink` variants below — their own hues walked down until white passes at
 * 4.65:1. Derived from their colours, not replacements for them: the originals still carry the
 * brand on every surface where they are not being asked to do a job they cannot do.
 */
export const brandLittlePearls = {
  /** Background only. Dark text on these passes; white text does not. */
  teal: '#83afaf',
  tealMid: '#99c9cc',
  aqua: '#c1ebef',
  aquaPale: '#edf8fa',
  coral: '#ff6565',
  pink: '#ff9399',

  /**
   * The two warm grounds the site actually sits on. Added 2026-08-07 with "the pearl and the
   * woven mat".
   *
   * The site was white. White is not neutral — it is clinical, and it was the largest single
   * reason a centre whose rooms are timber, woven baskets and daylight had a website that looked
   * like an accountant's. `shell` is the paper the whole site is printed on; `sand` is the
   * alternate ground that separates one section from the next without a rule.
   *
   * They are warm where the brand palette is cool, which is the point: aqua and coral now sit on
   * something rather than floating on nothing, and the pairing is the one already in their rooms —
   * daylight on timber, with the cool tones as the objects in it.
   *
   * MEASURED BEFORE BEING CHOSEN, against all four text colours, because the last time a colour
   * here was picked and checked afterwards it failed on the surface nobody tested. The worst pair
   * on `sand` is tealInk at 4.79:1 and on `shell` 5.40:1 — both above 4.5:1 with room, and all
   * eight combinations are asserted in `LITTLE_PEARLS_CONTRAST_PAIRS`.
   */
  shell: '#faf7f0',
  sand: '#f0e9dd',

  /**
   * Their hues darkened for white text on them, or for use as text themselves.
   *
   * CORRECTED IMMEDIATELY AFTER FIRST USE — worth keeping, because the mistake is the kind that
   * looks verified.
   *
   * These were first derived as `#507c7c` and `#d53b3b`, walked down until they passed 4.5:1
   * **against white**, and asserted against white in the tests below. Both passed at 4.65:1.
   * Then axe found contrast failures on every page: the footer, the callouts and the gap blocks
   * sit on `aquaPale`, which is *darker* than white, and on it the same colours measure
   * **4.29:1**.
   *
   * So a pair asserted against one background says nothing about the others. These are now
   * derived against the darkest surface they are used on — `aqua` at #c1ebef — and asserted
   * against all three, which is what makes them safe to use anywhere:
   *
   *     on #ffffff  teal 5.78   coral 5.85
   *     on #edf8fa  teal 5.34   coral 5.41
   *     on #c1ebef  teal 4.51   coral 4.57
   */
  tealInk: '#416d6d',
  coralInk: '#c12727',

  /** Body copy. 7.00:1 on white, 6.47:1 on aquaPale. */
  ink: '#595959',
  surface: '#ffffff',

  /**
   * The ocean. Added 2026-08-16 with the pearl-and-ocean direction the centre manager asked for:
   * bring back the pearl analogy, put the children's photos inside the pearls, and give the page
   * moving water to sit on.
   *
   * THESE ARE A SURFACE, NEVER AN ACCENT. Nothing here becomes a button, a link or body text on
   * `shell`. `tealInk` remains the one interface accent on this site, which is the rule the last
   * pass established and the reason the ocean can be this saturated without the page gaining a
   * second voice — a band you read *on* is not a colour that competes with the thing you click.
   *
   * WHY THIS IS THE ONE PART OF THE PALETTE THAT CAN CARRY WHITE TEXT, when the note at the top of
   * this block says none of their colours can. Because these are not their colours. Their teal is a
   * pale ground (`#83afaf`, white on it 2.41:1); this is the same hue taken *down* rather than up,
   * far enough that the relationship holds by eye and the contrast problem inverts — white on
   * `oceanDeep` is 9.11:1. It is the `tealInk` move again, applied to a background instead of to
   * text.
   *
   * MEASURED AGAINST ALL THREE DEPTHS, NOT JUST THE DARKEST, and that is the whole point of the
   * nine pairs below. The handoff quotes its contrast against `oceanDeep` only — but the hero is a
   * gradient that *ends* at `oceanShallow`, which is the lightest of the three, and the buttons and
   * the intro paragraph sit at the bottom of it. Checking the top of a gradient tells you nothing
   * about the text at the bottom of it; that is the same mistake the `Ink` variants above were
   * corrected for, one surface later.
   *
   * LIGHTENED AND TURNED TOWARD TURQUOISE, 2026-08-25, at the owner's request. Hue moved 183 -> 192,
   * lightness +7 points, saturation +6. The brightening is as much saturation as lightness on
   * purpose: past about hue 195 the band stops reading as turquoise and starts reading as petrol,
   * and lightness alone just makes it chalky.
   *
   * The two secondary tones had to move with it, and NOT by walking them up to a shared contrast
   * threshold — that was tried, it satisfies every pair, and it lands muted and soft within 0.3
   * lightness points of each other and of white, which silently deletes the three-step hierarchy
   * this block exists to provide. They are instead derived from fixed contrast targets on
   * `oceanShallow` (5.40 and 4.80), which pins the gap between them at 5.5 lightness points rather
   * than letting it close.
   *
   *     white on deep  9.11   mid  7.86   shallow  6.43
   *     muted on deep  7.69   mid  6.63   shallow  5.42
   *     soft  on deep  6.85   mid  5.91   shallow  4.83   <- worst pair, still AA with room
   */
  oceanDeep: '#104f5f',
  oceanMid: '#15596b',
  oceanShallow: '#19677b',
  onOcean: '#ffffff',
  onOceanMuted: '#e6edef',
  onOceanSoft: '#d3e2e6',
} as const;

/**
 * Asserted in `__tests__/tokens.test.ts`, separately from the platform's pairs.
 *
 * Both directions are checked deliberately: that the `Ink` variants work, *and* that the light
 * originals still work with dark text on them — because the temptation with a pale brand is to
 * put white on it anyway.
 */
export const LITTLE_PEARLS_CONTRAST_PAIRS: readonly {
  fg: string;
  bg: string;
  min: number;
  label: string;
}[] = [
  { fg: brandLittlePearls.ink, bg: brandLittlePearls.surface, min: 4.5, label: 'body on white' },
  { fg: brandLittlePearls.ink, bg: brandLittlePearls.aquaPale, min: 4.5, label: 'body on pale aqua' },
  { fg: brandLittlePearls.ink, bg: brandLittlePearls.aqua, min: 4.5, label: 'body on aqua' },
  { fg: '#1b1a18', bg: brandLittlePearls.teal, min: 4.5, label: 'dark text on teal' },
  { fg: '#1b1a18', bg: brandLittlePearls.coral, min: 4.5, label: 'dark text on coral' },
  { fg: brandLittlePearls.surface, bg: brandLittlePearls.tealInk, min: 4.5, label: 'white on teal ink' },
  { fg: brandLittlePearls.surface, bg: brandLittlePearls.coralInk, min: 4.5, label: 'white on coral ink' },

  /*
   * The Ink variants against **every** surface they are used on, not just white.
   *
   * This is the assertion that was missing when they were first added, and axe found what it
   * missed: 4.29:1 in the footer, which is `aquaPale`. A pair checked against one background is
   * not a checked colour — it is a checked colour on one background.
   */
  { fg: brandLittlePearls.tealInk, bg: brandLittlePearls.surface, min: 4.5, label: 'teal ink on white' },
  { fg: brandLittlePearls.tealInk, bg: brandLittlePearls.aquaPale, min: 4.5, label: 'teal ink on pale aqua' },
  { fg: brandLittlePearls.tealInk, bg: brandLittlePearls.aqua, min: 4.5, label: 'teal ink on aqua' },
  { fg: brandLittlePearls.coralInk, bg: brandLittlePearls.surface, min: 4.5, label: 'coral ink on white' },
  { fg: brandLittlePearls.coralInk, bg: brandLittlePearls.aquaPale, min: 4.5, label: 'coral ink on pale aqua' },
  { fg: brandLittlePearls.coralInk, bg: brandLittlePearls.aqua, min: 4.5, label: 'coral ink on aqua' },

  /*
   * The two warm grounds, against every colour that sits on them.
   *
   * Eight pairs rather than the two that would obviously break, because the lesson from the Ink
   * variants is that checking a colour on one background tells you nothing about the others. These
   * were measured before the hex values were chosen, not after.
   */
  { fg: brandLittlePearls.ink, bg: brandLittlePearls.shell, min: 4.5, label: 'body on shell' },
  { fg: brandLittlePearls.ink, bg: brandLittlePearls.sand, min: 4.5, label: 'body on sand' },
  { fg: brandLittlePearls.tealInk, bg: brandLittlePearls.shell, min: 4.5, label: 'teal ink on shell' },
  { fg: brandLittlePearls.tealInk, bg: brandLittlePearls.sand, min: 4.5, label: 'teal ink on sand' },
  { fg: brandLittlePearls.coralInk, bg: brandLittlePearls.shell, min: 4.5, label: 'coral ink on shell' },
  { fg: brandLittlePearls.coralInk, bg: brandLittlePearls.sand, min: 4.5, label: 'coral ink on sand' },
  { fg: '#1b1a18', bg: brandLittlePearls.shell, min: 4.5, label: 'heading on shell' },
  { fg: '#1b1a18', bg: brandLittlePearls.sand, min: 4.5, label: 'heading on sand' },

  /*
   * The ocean band, every text colour against every depth.
   *
   * NINE PAIRS FOR WHAT LOOKS LIKE THREE, because the band is a gradient rather than a fill. A pair
   * asserted against `oceanDeep` is an assertion about the top edge of the hero; the intro
   * paragraph and both buttons are at the bottom edge, where the ground is `oceanShallow` and every
   * ratio is at its worst. The handoff quotes only the `oceanDeep` figures, so taking them on trust
   * would have left the three pairs that actually matter unchecked.
   *
   * `soft` on `oceanShallow` at 4.83:1 is the floor. It holds AA, so the eyebrow may stay the
   * quietest thing in the band — but it is the pair that breaks first if anyone lightens the water,
   * and the 2026-08-25 lightening proved it: it is the pair that decided how far the water could
   * go. Anyone lightening it again should re-derive `onOceanMuted` and `onOceanSoft` from their
   * contrast targets on `oceanShallow` in the same pass, not afterwards.
   */
  { fg: brandLittlePearls.onOcean, bg: brandLittlePearls.oceanDeep, min: 4.5, label: 'white on ocean deep' },
  { fg: brandLittlePearls.onOcean, bg: brandLittlePearls.oceanMid, min: 4.5, label: 'white on ocean mid' },
  { fg: brandLittlePearls.onOcean, bg: brandLittlePearls.oceanShallow, min: 4.5, label: 'white on ocean shallow' },
  { fg: brandLittlePearls.onOceanMuted, bg: brandLittlePearls.oceanDeep, min: 4.5, label: 'muted on ocean deep' },
  { fg: brandLittlePearls.onOceanMuted, bg: brandLittlePearls.oceanMid, min: 4.5, label: 'muted on ocean mid' },
  { fg: brandLittlePearls.onOceanMuted, bg: brandLittlePearls.oceanShallow, min: 4.5, label: 'muted on ocean shallow' },
  { fg: brandLittlePearls.onOceanSoft, bg: brandLittlePearls.oceanDeep, min: 4.5, label: 'soft on ocean deep' },
  { fg: brandLittlePearls.onOceanSoft, bg: brandLittlePearls.oceanMid, min: 4.5, label: 'soft on ocean mid' },
  { fg: brandLittlePearls.onOceanSoft, bg: brandLittlePearls.oceanShallow, min: 4.5, label: 'soft on ocean shallow' },

  /*
   * The white button that inverts on the ocean, and its label. This is the primary CTA in both
   * bands — `tealInk` on white would be the site's usual fill, and on a dark ground it disappears.
   */
  { fg: brandLittlePearls.oceanDeep, bg: brandLittlePearls.surface, min: 4.5, label: 'ocean deep on white' },
];

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
