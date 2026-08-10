'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MemberRole } from '@ece/core';
import { hrefFor, tabsFor } from './tabs';

/**
 * The tab bar.
 *
 * A client component for the same single reason `NavLink` is one: `aria-current` has to say
 * which tab is open, and the shell above it is a server component with no pathname. The
 * styling keys off that attribute rather than a class, so what a screen reader announces and
 * what the eye sees cannot drift apart.
 *
 * Links, not buttons. Each tab is a route — middle-clickable, bookmarkable, and openable in a
 * new tab, which is exactly what somebody comparing two children's health records does.
 *
 * A `<nav>` with a label rather than the tab/tablist ARIA pattern. That pattern promises
 * arrow-key navigation between tabs and a tabpanel that moves with them; these are page
 * loads, so promising it would be a lie a keyboard user finds out about by pressing the
 * arrow key and having nothing happen. A labelled list of links is what this actually is.
 */
export function RecordTabs({ childId, role }: { childId: string; role: MemberRole }) {
  const pathname = usePathname();
  const tabs = tabsFor(role);

  return (
    <nav className="record-tabs" aria-label="This child’s record">
      <ul>
        {tabs.map((tab) => {
          const href = hrefFor(childId, tab.slug);
          // Exact, unlike the sidebar's prefix match: `/children/[id]` is the overview and
          // must not light up while a tab is open, and no tab is a prefix of another.
          const current = pathname === href;
          return (
            <li key={tab.label}>
              <Link href={href} aria-current={current ? 'page' : undefined}>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
