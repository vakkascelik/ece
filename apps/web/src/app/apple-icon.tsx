import { ImageResponse } from 'next/og';
import { MARK } from '@ece/core';

/**
 * The home-screen icon, generated from the same geometry as the tab icon and the rail.
 *
 * WHY GENERATED AND NOT A COMMITTED PNG
 *
 * `apps/site` commits a `icon.png` because that is a customer's own logo — a drawn asset that
 * arrived as a file and whose bytes are the thing to preserve. This one is *ours*, and it is
 * three primitives on a 128 grid in `@ece/core`. Committing a raster of it would create the
 * fourth hand-maintained copy of a mark this repo has just spent an afternoon consolidating
 * into one, and the copy would be the one nobody notices going stale because nobody diffs a
 * PNG in review.
 *
 * `next/og` ships inside `next`, so this adds no dependency — which the design handover
 * forbids, and which is also why the rail's icons are hand-drawn rather than installed.
 *
 * WHY 180px AND NO TRANSPARENCY
 *
 * The size iOS asks for when somebody adds this to a home screen — which on a wall-mounted
 * tablet at a centre is a real thing somebody does. The mark's own box is the background, so
 * there is no transparency for iOS to composite onto black and no pre-rounded corner for it to
 * round a second time. Both are rejections in Apple's own guidance and both are avoided by the
 * mark being a filled tile rather than a floating glyph.
 *
 * Rendered with `div`s rather than SVG because that is what this renderer takes. The numbers
 * are scaled from `MARK` rather than retyped, so the tab icon cannot drift from the rail.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** 128-unit design grid up to the 180px raster. */
const s = (n: number) => (n / MARK.size) * size.width;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: MARK.box.fill,
          borderRadius: s(MARK.box.radius),
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: s(MARK.head.cx - MARK.head.r),
            top: s(MARK.head.cy - MARK.head.r),
            width: s(MARK.head.r * 2),
            height: s(MARK.head.r * 2),
            borderRadius: '50%',
            background: MARK.head.fill,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: s(MARK.shoulders.x),
            top: s(MARK.shoulders.y),
            width: s(MARK.shoulders.width),
            height: s(MARK.shoulders.height),
            borderRadius: s(MARK.shoulders.radius),
            background: MARK.shoulders.fill,
          }}
        />
      </div>
    ),
    size,
  );
}
