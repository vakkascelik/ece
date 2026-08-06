'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A nav item that knows whether it is the current page.
 *
 * `aria-current="page"` is what the stylesheet keys the current-item treatment off, rather than a
 * class — so what a screen reader announces and what the eye sees cannot drift apart, and "looks
 * current but is not announced as current" stops being a possible state. Same rule as the
 * platform's rail, for the same reason.
 *
 * The only client component in this app. Everything else is static, which is the point: a
 * marketing site that ships React to do nothing is a slower marketing site.
 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
