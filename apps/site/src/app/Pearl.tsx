import type { Photo as PhotoData } from '@/lib/photos';

/**
 * A pearl: a circular photograph with the three layers that make it read as nacre rather than as a
 * round crop.
 *
 * THE CENTRE MANAGER ASKED FOR THIS BY NAME — bring back the pearl analogy from the old site, and
 * put the children's photographs *inside* the pearls. So the pearl is the photo frame, and it is
 * one component at five sizes rather than five hand-tuned circles: hero 420, story cards 64/80/98,
 * footer cluster 56/74/124.
 *
 * WHY THREE LAYERS AND NOT ONE GRADIENT
 *
 * A single overlay makes a shiny disc. What makes a pearl is that three different things happen at
 * once and none of them is the photograph:
 *
 *  - `sheen` is the specular highlight — the hard white point where the light source is.
 *  - `nacre` is the iridescence, and it is `mix-blend-mode: soft-light` on purpose: at `normal` it
 *    lays a pink film over the child's face, at `soft-light` it tints what is already there. The
 *    difference between a photograph behind coloured glass and a photograph inside a pearl.
 *  - `rim` is the curvature — dark at the bottom, light at the top, and a 1px pearly edge. Without
 *    it the thing is flat and reads as a circular crop, which is what every other site does.
 *
 * THE SHADOWS SCALE WITH THE DIAMETER and that is not tidiness. The handoff's inset blurs are
 * written for the 420px hero; applied unchanged to a 64px card pearl the -34px inset swallows the
 * whole circle and it renders as a dark blob. They are ~8% and ~5% of the diameter, derived in the
 * stylesheet with `calc()` off `--pearl-size`, so a small pearl is the same object seen from
 * further away rather than a different one.
 *
 * ABSENCE IS A RENDER, AND THIS IS THE ONE PLACE THAT IS TRUE.
 *
 * `lib/photos.ts` holds the line that a photograph without current consent is not rendered at all —
 * no placeholder, no caption, no gap. That still holds everywhere else on this site. Here it does
 * not, because the pearl is the decoration and the photograph is the content: a pearl with no photo
 * is still a pearl, and the layout does not develop a hole. Passing no `photo` is a supported state,
 * not a failure mode.
 */
export function Pearl({
  photo,
  size,
  className = '',
  parallax,
  priority = false,
}: {
  /** Omit for an empty pearl — the nacre with nothing behind it. A deliberate state. */
  photo?: PhotoData;
  /**
   * Rendered diameter. A number is px; a string is any CSS length, which is how the hero gets
   * `min(420px, 78vw)`.
   *
   * IT HAS TO BE EXPRESSIBLE HERE RATHER THAN IN A MEDIA QUERY, and that is a bug fix. This sets
   * `--pearl-size` as an **inline style**, so a stylesheet rule cannot override it — a
   * `@media (max-width: 40rem) { .hero .pearl { --pearl-size: … } }` loses to it silently. The hero
   * pearl therefore stayed 420px on a 390px phone, and because a grid item's `min-width` defaults
   * to `auto` it dragged the whole copy column out to 420px with it. The heading and the intro
   * paragraph were cut off mid-word at the right edge.
   *
   * `overflow: hidden` on the band is why nothing caught it: the page had no horizontal scrollbar,
   * so `npm run audit:site` passed. Clipped text and no overflow look identical to that check.
   */
  size: number | string;
  className?: string;
  /** `data-parallax` name, if this pearl is one of the things that moves on scroll. */
  parallax?: string;
  /** True above the fold. The hero pearl is the largest image on the page. */
  priority?: boolean;
}) {
  /*
   * Both highlights are declared here rather than in the stylesheet because the choice is per
   * image — see the `sheen` field in `lib/photos.ts`, which exists because the default lands on a
   * child's face in the one photograph the hero uses.
   */
  const sheenAt = photo?.sheen === 'right' ? '66% 26%' : '34% 26%';

  return (
    <figure
      /*
       * `pearl--photo` softens the highlight. The handoff's sheen is tuned against an empty pearl —
       * there is no photograph in any pearl in its reference file — and over a real image it washes
       * the picture out. See the note on the modifier in globals.css.
       */
      className={`pearl ${photo ? 'pearl--photo' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      data-parallax={parallax}
      style={
        {
          '--pearl-size': typeof size === 'number' ? `${size}px` : size,
          /*
           * The shadow scaling moved to `calc()` in the stylesheet. It used to be computed here,
           * which forced `size` to be a number — and a number cannot express `min(420px, 78vw)`,
           * which is the whole fix above. `calc(var(--pearl-size) * 0.08)` works for any length.
           */
          '--pearl-sheen-at': sheenAt,
        } as React.CSSProperties
      }
    >
      {photo && (
        <img
          src={photo.src}
          alt={photo.alt}
          width={720}
          height={720}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          style={{
            objectPosition: `${(photo.focalX ?? 0.5) * 100}% ${(photo.focalY ?? 0.35) * 100}%`,
          }}
        />
      )}
      {/* Decorative in the strictest sense — they carry no information the photograph does not. */}
      <span className="pearl__sheen" aria-hidden="true" />
      <span className="pearl__nacre" aria-hidden="true" />
      <span className="pearl__rim" aria-hidden="true" />
    </figure>
  );
}
