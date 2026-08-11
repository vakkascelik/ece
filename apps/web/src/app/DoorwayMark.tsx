import { MARK } from '@ece/core';

/**
 * The product's mark, drawn from the geometry in `@ece/core`.
 *
 * Inlined rather than fetched: three shapes are smaller than the request that would fetch
 * them, and `img-src` is `'self' data:` so a file would exist only for this. The public
 * website makes the same call for the same mark, and both now read the same numbers instead
 * of each holding a copy.
 *
 * `aria-hidden` wherever it appears beside the word "Doorway", because the word is the name
 * and a screen reader announcing it twice is noise. `focusable="false"` because SVG otherwise
 * picks up a tab stop in some engines — the rail already has twenty-four of those.
 */
export function DoorwayMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${MARK.size} ${MARK.size}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        width={MARK.size}
        height={MARK.size}
        rx={MARK.box.radius}
        fill={MARK.box.fill}
      />
      <circle cx={MARK.head.cx} cy={MARK.head.cy} r={MARK.head.r} fill={MARK.head.fill} />
      <rect
        x={MARK.shoulders.x}
        y={MARK.shoulders.y}
        width={MARK.shoulders.width}
        height={MARK.shoulders.height}
        rx={MARK.shoulders.radius}
        fill={MARK.shoulders.fill}
      />
    </svg>
  );
}
