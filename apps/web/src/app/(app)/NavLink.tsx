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
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
