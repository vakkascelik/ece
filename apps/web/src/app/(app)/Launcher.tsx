import Link from 'next/link';
import type { MemberRole } from '@ece/core';
import { NavIcon } from './NavIcon';
import { launcherFor } from './launcherGroups';

/**
 * The launcher block. See `launcherGroups.ts` for why it exists and why it sits where it
 * does — including why the data module is named for the groups rather than matching this
 * file: `launcher.ts` beside `Launcher.tsx` resolves to one file on a case-insensitive
 * filesystem, and Windows is where this repo is developed. `next build` caught it;
 * `tsc --noEmit` did not. The pairing here is the one `NavGroup.tsx` and `navGroups.ts`
 * already use.
 *
 * NOT A `<nav>`, DELIBERATELY
 *
 * `layout.tsx` argues the landmark count explicitly — "two is not six" — and settles on
 * one rail nav with six headings inside it plus a second for the account. A third
 * navigation landmark on the overview would add a region a screen reader user has to
 * enter to find out what it is, to reach links that are already in the rail. The
 * section heading above these cards is the thing that makes them findable when skimming
 * headings, which is the same job done more cheaply.
 *
 * NO COUNTS ON THE CARDS
 *
 * Tempting, and wrong here. `page.tsx` states the rule this screen is built on: "a
 * dashboard that computes its own version of a figure is a dashboard that eventually
 * disagrees with the page it links to". Needs attention is directly above, it already
 * carries every outstanding figure, and each of its lines already links to the screen
 * that fixes it. A badge here would be the same fact twice on one screen, and the second
 * copy is the one that goes stale. A single coloured dot instead of a number would be
 * worse again — colour alone, which this product does not do (WCAG 1.4.1, and every
 * `Status` chip carries a glyph for exactly that reason).
 */
export function Launcher({ role }: { role: MemberRole }) {
  const groups = launcherFor(role);
  if (groups.length === 0) return null;

  return (
    <div className="launcher">
      {groups.map((group) => (
        <div key={group.label} className="lcard">
          <div className="lcard-head">
            <NavIcon name={group.icon} />
            <h3>{group.label}</h3>
          </div>
          <p>{group.blurb}</p>
          <ul>
            {group.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
