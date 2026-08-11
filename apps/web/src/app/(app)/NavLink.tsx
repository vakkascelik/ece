'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * A nav item that knows whether it is the current page.
 *
 * `aria-current="page"` is what the design pack's annotations ask for, and the
 * stylesheet keys the current-item treatment off that same attribute rather than a
 * class — so what a screen reader announces and what the eye sees cannot drift apart.
 * That is the whole reason this is a client component: the shell around it is a server
 * component and has no pathname.
 *
 * Exact match except for the root, because `/children` must not light up while the
 * reader is on `/children/[id]`… and it must, since that is still the Children section.
 * `/` is the only one that needs an exact test, or it would be current everywhere.
 */
export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  /**
   * The row's glyph, from `NavIcon`. Optional in the type and present on every caller.
   *
   * A separate prop rather than something a caller folds into `children`, so the label
   * cannot be replaced by the icon: `aria-hidden` on the glyph means an icon-only link would
   * have no accessible name at all, and this is a rail a screen reader user navigates by
   * reading. The one arrangement the type forbids is the one that breaks.
   */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
