import type { Photo as PhotoData } from '@/lib/photos';

/**
 * One of the centre's photographs, with its caption.
 *
 * A server component and a plain `<img>`, not `next/image`. `next/image` would optimise at request
 * time through `/_next/image`, which needs `sharp` in the running container and adds a round trip per
 * image — for seven files that are already WebP at the one size this site displays them, it would be
 * machinery in exchange for nothing. The trade would change if these were user-uploaded or came in
 * arbitrary sizes.
 *
 * `width`/`height` are always emitted so the browser reserves the space before the bytes arrive.
 * Their old site omits them, which is why it reflows as you scroll it on a phone.
 */
export function Photo({
  photo,
  className = '',
  showCaption = true,
  priority = false,
}: {
  photo: PhotoData;
  className?: string;
  /** Off where the surrounding prose already says what the picture is. */
  showCaption?: boolean;
  /** True for an image above the fold. Lazy-loading one of those delays it for no benefit. */
  priority?: boolean;
}) {
  return (
    <figure className="photo-figure">
      <img
        className={`photo ${className}`.trim()}
        src={photo.src}
        alt={photo.alt}
        width={720}
        height={720}
        loading={priority ? 'eager' : 'lazy'}
        // `high` only for the one image that is part of the first impression; the rest must not
        // compete with the stylesheet for bandwidth on a slow connection.
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
      {showCaption && <figcaption>{photo.caption}</figcaption>}
    </figure>
  );
}
