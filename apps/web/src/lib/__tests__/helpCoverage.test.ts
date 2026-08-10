import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABS, tabDoc } from '../../app/(app)/help/tabs';

/**
 * Every screen in the navigation has an entry in the help documentation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS TEST EXISTS AT ALL
 *
 * `TABS` is a hand-maintained list that has to be edited whenever an unrelated file
 * grows a route — which is the exact defect shape `conventions.md` collects under "the
 * same shape, four times in one day". Four separate bugs in this repo had that one cause,
 * and three of them failed silently. This one would too: add a nav link, forget the
 * entry, and `/help` simply omits the screen while `TabHelp` renders nothing. Nobody
 * gets an error. The help page goes on looking complete, which is worse than looking
 * broken, because it reads as coverage.
 *
 * So the list is checked against something that is not another list: the navigation's
 * own source. `layout.tsx` is where a route becomes reachable, so parsing it is parsing
 * the thing itself rather than a second description of it. Same technique as
 * `bounded-queries.test.ts` scanning source, and as the audit-trigger assertion reading
 * `pg_class` — a check that derives its contents cannot be forgotten into silence.
 *
 * It is a regex over JSX and not a parse, which is a real limitation: a route added by
 * some other mechanism (a `map` over an array, a conditional built elsewhere) will not
 * be seen. Stated rather than implied. It catches the ordinary case, which is somebody
 * typing one more `<NavLink>` beside twenty others.
 */

const LAYOUT = join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx');

function navRoutes(): string[] {
  const src = readFileSync(LAYOUT, 'utf8');
  return [...src.matchAll(/<NavLink href="([^"]+)"/g)].map((m) => m[1]!);
}

describe('help documentation covers the navigation', () => {
  it('finds the navigation, so a passing suite means something', () => {
    // Guards the regex itself. If `layout.tsx` is restructured and this returns nothing,
    // every assertion below would pass vacuously — the failure mode this whole file is
    // about.
    expect(navRoutes().length).toBeGreaterThan(10);
  });

  it('has an entry for every screen in the navigation', () => {
    const missing = navRoutes()
      // `/help` documents the others and does not document itself.
      .filter((href) => href !== '/help')
      .filter((href) => tabDoc(href) === undefined);

    expect(
      missing,
      `These routes are in the navigation with no entry in help/tabs.ts:\n  ${missing.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('documents no screen that is not in the navigation', () => {
    const nav = new Set(navRoutes());
    const orphans = TABS.map((t) => t.href).filter((href) => !nav.has(href));

    // The other direction, and it matters for a different reason: an entry describing a
    // screen that no longer exists sends somebody looking for a link that is not there.
    expect(
      orphans,
      `These entries in help/tabs.ts describe routes not in the navigation:\n  ${orphans.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('gives every entry all three fields it promises', () => {
    for (const tab of TABS) {
      expect(tab.what.length, `${tab.href} has no "what"`).toBeGreaterThan(20);
      expect(tab.how.length, `${tab.href} has no "how"`).toBeGreaterThan(20);
    }
  });
});
