/**
 * The waterline. Two or three drifting layers at the edge of an ocean band.
 *
 * HOW THE SEAMLESS LOOP WORKS, because it is the whole trick and it is invisible in the output
 *
 * Each layer is three nested elements, and they cannot be collapsed into fewer:
 *
 *   .wave        positioned, `left: -10%`, `width: 220%` — the reservoir the drift slides through
 *     .wave__drift   carries the CSS animation, which translates it by exactly -50%
 *       svg          a path containing TWO IDENTICAL PERIODS across the viewBox
 *
 * Translating by half the width moves period 2 to exactly where period 1 was, so the reset at the
 * end of the keyframe is invisible. That only holds if the two periods really are identical — which
 * is why the paths below are written as one period repeated rather than four hand-drawn curves, and
 * why `footerBack` has a corrected first co-ordinate (see its note).
 *
 * The scroll parallax writes `transform` on `.wave`, and the drift animation writes `transform` on
 * `.wave__drift`. SEPARATE ELEMENTS ON PURPOSE: one element cannot hold both, the second would
 * silently overwrite the first, and the symptom is waves that stop moving the moment you scroll.
 *
 * TWO DIRECTIONS AND THREE SPEEDS is what makes it read as water rather than as a loading bar.
 * Nothing here goes under ~15s per cycle; the handoff is explicit that faster looks like a spinner,
 * and it is right.
 */

/**
 * Fills are the page's own paper, not the handoff's `#faf9f7`.
 *
 * The solid layer is the page floor — it is the join between the ocean band and the page below it,
 * so if it is not *exactly* `--shell` there is a 1px seam of the wrong cream along the whole width.
 * The translucent layers are the same colour at low alpha, which is what keeps the foam reading as
 * the same water rather than as two greys.
 */
const FOAM = (alpha: number) => `rgba(250, 247, 240, ${alpha})`;

/**
 * FOUR PERIODS, BUILT BY REPETITION RATHER THAN WRITTEN OUT — and both halves of that are fixes.
 *
 * **Why four and not the handoff's two.** With two periods and `width: 220%`, the right-hand edge of
 * a fully-drifted layer lands at `left + width/2` = `-10% + 110%` = exactly 100% of the viewport.
 * Exactly. There is no slack at all, and the scroll parallax then subtracts up to ~160px from it —
 * so at the bottom of the drift cycle the solid page-floor layer stopped short of the right edge and
 * a wedge of open ocean showed *below the waterline*, at the very edge of the page. Found in a
 * screenshot of `/rooms`; the handoff's own definition of done asks for "no white gap at either edge
 * at 1440, 1024, 768 and 390px", and its geometry cannot deliver that once its own parallax table is
 * applied.
 *
 * Four periods with `width: 440%` and `left: -60%` keeps the drift at -50% (period 3 lands exactly
 * where period 1 was, so the loop is still seamless) while putting 60% of the viewport of slack at
 * *both* edges — 864px at 1440, 234px at 390, against a worst case of ~160px. **The rendered period
 * is unchanged**: 440%/4 is the same 110% of the viewport that 220%/2 was, so the waves are not
 * stretched or flattened by this. It is more of the same wave, not a different one.
 *
 * **Why by repetition.** The periods have to be identical or the loop has a seam, and the reference
 * file's `wave5` proved that eyeballing that is not enough — it started at y=30 and hit y=34 at the
 * halfway mark, a ~2px step across the full width once every 19 seconds. Writing one period as
 * *relative* curves and emitting it four times makes identity structural: there is no longer a
 * co-ordinate that can disagree with its twin.
 */
interface Layer {
  /** `data-parallax` key. Must match the table in `Parallax.tsx`. */
  name: string;
  /** Distance from the band edge, px. */
  offset: number;
  /** Rendered height, px. */
  height: number;
  fill: string;
  /** Which drift keyframe, and how long one cycle takes. */
  animation: string;
  /** `y` at x=0. Every period returns to it, which is what makes the wrap invisible. */
  start: number;
  /** One period as relative cubics, 1440 wide. Repeated four times to fill the viewBox. */
  period: string;
}

/** How many times `period` is emitted. See the note above for why it is four and not two. */
const PERIODS = 4;
const PERIOD_WIDTH = 1440;
const VIEW_WIDTH = PERIODS * PERIOD_WIDTH;

/**
 * `M0,start`, four identical periods, then the closing edge.
 *
 * `close` is the y the fill runs to: the band's own edge. Hero waves fill *down* to the bottom of
 * the viewBox; footer waves fill *up* to zero, which is what mirrors them.
 */
function path(layer: Layer, close: number): string {
  return `M0,${layer.start} ${Array(PERIODS).fill(layer.period).join(' ')} L${VIEW_WIDTH},${close} L0,${close} Z`;
}

/*
 * Each `period` is the handoff's own curve, converted to relative cubics so it can be repeated.
 * Every one nets zero vertical change across the period — that is what makes `M0,start` still true
 * at every period boundary, and it is the property the reference file's `wave5` did not have.
 */
const HERO: Layer[] = [
  {
    name: 'wave1',
    offset: 56,
    height: 70,
    fill: FOAM(0.16),
    animation: 'lpwaveback 34s linear infinite',
    start: 52,
    period: 'c 240,-36 420,28 720,-2 c 300,-30 500,32 720,2',
  },
  {
    name: 'wave2',
    offset: 28,
    height: 72,
    fill: FOAM(0.34),
    animation: 'lpwave 22s linear infinite',
    start: 44,
    period: 'c 220,40 400,-36 720,0 c 320,36 520,-36 720,0',
  },
  {
    /* Solid, and it is the page floor rather than a wave — everything below this line is `--shell`. */
    name: 'wave3',
    offset: 0,
    height: 64,
    fill: 'var(--shell)',
    animation: 'lpwaveback 16s linear infinite',
    start: 50,
    period: 'c 260,-38 460,28 720,-2 c 260,-30 480,32 720,2',
  },
];

/* Mirrored: the paths close to `y=0` so the fill runs upward into the page above the band. */
const FOOTER: Layer[] = [
  {
    name: 'wave4',
    offset: 0,
    height: 62,
    fill: 'var(--shell)',
    animation: 'lpwave 28s linear infinite',
    start: 40,
    period: 'c 260,-36 470,34 720,10 c 260,-24 460,-56 720,-10',
  },
  {
    name: 'wave5',
    offset: 0,
    height: 44,
    fill: FOAM(0.2),
    animation: 'lpwaveback 19s linear infinite',
    /*
     * `start: 34` AND NOT THE REFERENCE FILE'S 30. A real defect in the handoff, found by checking
     * the periods rather than by looking at the wave.
     *
     * Every other path starts and ends each period at the same y. This one began at 30 and reached
     * 34 at the halfway mark, so the `-50%` wrap put a 34 where a 30 had been — a ~2px vertical step
     * along the whole width, once every 19 seconds. Small, and exactly the kind of thing that gets
     * seen once, disbelieved, and never reproduced.
     *
     * 34 rather than 30 because 34 is what the other period boundaries already use: one number moves
     * and the periods become identical, where changing the others would redraw the wave.
     */
    start: 34,
    period: 'c 240,32 420,-32 720,0 c 300,32 500,-32 720,0',
  },
];

/** The inner-page bands are shallower, so they carry the translucent layer and the floor only. */
const PAGE: Layer[] = [HERO[1], HERO[2]];

const SETS = { hero: HERO, footer: FOOTER, page: PAGE };

export function Waves({ variant }: { variant: keyof typeof SETS }) {
  const layers = SETS[variant];
  const footer = variant === 'footer';
  const edge = footer ? 'top' : 'bottom';
  /* Footer waves fill upward to y=0; hero and page waves fill down to the foot of the viewBox. */
  const depth = footer ? 80 : 90;

  return (
    <div className={`waves waves--${variant}`} aria-hidden="true">
      {layers.map((layer) => (
        <div
          key={layer.name}
          className="wave"
          data-parallax={layer.name}
          style={{ [edge]: `${layer.offset}px` }}
        >
          {/*
            The animation arrives as a CUSTOM PROPERTY, not as an inline `animation` declaration,
            and that is a bug fix rather than a style.

            It was `style={{ animation: … }}`. An inline declaration beats a stylesheet rule at any
            specificity, so `@media (prefers-reduced-motion: reduce) { .wave__drift { animation:
            none } }` could not touch it — all five wave layers went on drifting for a reader who had
            asked the operating system for no motion. Handing the *value* in inline and keeping the
            `animation` property itself in the stylesheet puts the media query back in charge.

            Measured, not assumed: with reduced motion requested, the page reported eight running
            animations before this change and zero after.
          */}
          <div className="wave__drift" style={{ '--wave-drift': layer.animation } as React.CSSProperties}>
            <svg
              viewBox={`0 0 ${VIEW_WIDTH} ${depth}`}
              preserveAspectRatio="none"
              style={{ display: 'block', width: '100%', height: `${layer.height}px` }}
              aria-hidden="true"
              focusable="false"
            >
              <path d={path(layer, footer ? 0 : depth)} fill={layer.fill} />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
