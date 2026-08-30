import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_GROUPS, launcherFor } from '../../app/(app)/launcherGroups';

/**
 * The launcher on `/` offers exactly the screens the rail offers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS TEST EXISTS AT ALL
 *
 * `launcherGroups.ts` is a second hand-maintained list of the navigation, which is the
 * defect shape CLAUDE.md rule 4 exists to prevent and which this repo has already been
 * bitten by once — two hand-written copies of the design tokens had silently diverged
 * before `tokens:check` was written. Add a link to the rail, forget the launcher, and
 * the overview quietly stops mentioning a screen. Nobody gets an error, and the launcher
 * goes on looking complete, which is worse than looking broken because it reads as
 * coverage.
 *
 * So the list is checked against something that is not another list: `layout.tsx`, where
 * a route becomes reachable. Exactly the technique `helpCoverage.test.ts` already uses
 * on the same file, and for the same reason.
 *
 * It is a regex over JSX and not a parse — the same real limitation stated there. A
 * route added by some other mechanism will not be seen. It catches the ordinary case,
 * which is somebody typing one more `<NavLink>` beside twenty others.
 *
 * WHAT THIS DOES NOT CHECK
 *
 * That each link is gated on the same capability in both places. The rail's conditions
 * are `can()` calls inside JSX and this file does not evaluate them; `roles.spec.ts`
 * does, against a real browser and four real sessions. What is checked here is the set
 * of routes, which is the half that goes wrong silently.
 */

const LAYOUT = join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx');

/**
 * The rail's main nav, without the account nav pinned under it.
 *
 * Account, Notifications and Help are about the person rather than about the day's work
 * — `layout.tsx` says so where it puts them in their own landmark — and the launcher is
 * a map of the centre's screens. Splitting on the account nav's own label keeps that
 * exclusion derived from the file instead of listing three hrefs here that would then
 * need maintaining.
 */
function railRoutes(): string[] {
  const src = readFileSync(LAYOUT, 'utf8');
  const mainNav = src.split('aria-label="Your account"')[0]!;
  return [...mainNav.matchAll(/<NavLink href="([^"]+)"/g)].map((m) => m[1]!);
}

const launcherRoutes = () => LAUNCHER_GROUPS.flatMap((g) => g.links.map((l) => l.href));

/**
 * The two rail links whose label depends on who is reading — a parent gets "Your
 * tamariki" and "Pānui" where staff get "Children" and "Posts". Listed rather than
 * detected because there are two of them and a regex that found ternaries would be a
 * parser; if a third appears, this test fails loudly and someone adds it here.
 */
const ROLE_DEPENDENT_LABEL = new Set(['/children', '/posts']);

describe('the launcher covers the navigation', () => {
  it('finds the rail, so a passing suite means something', () => {
    // Guards the regex and the split. If either stops matching, every assertion below
    // would pass vacuously — the failure mode this whole file is about.
    expect(railRoutes().length).toBeGreaterThan(10);
    expect(railRoutes()).toContain('/attendance');
    // The split worked: the account nav is on the other side of it.
    expect(railRoutes()).not.toContain('/help');
  });

  it('has a card entry for every screen in the rail', () => {
    const inLauncher = new Set(launcherRoutes());
    const missing = railRoutes()
      // The page the launcher is on.
      .filter((href) => href !== '/')
      .filter((href) => !inLauncher.has(href));

    expect(
      missing,
      `These routes are in the rail with no entry in launcherGroups.ts:\n  ${missing.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('points at no screen that is not in the rail', () => {
    const rail = new Set(railRoutes());
    const orphans = launcherRoutes().filter((href) => !rail.has(href));

    // The other direction, and it fails differently: a card link to a route that no
    // longer exists is a 404 offered from the first screen somebody sees.
    expect(
      orphans,
      `These entries in launcherGroups.ts point at routes not in the rail:\n  ${orphans.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('names each screen the same way the rail does', () => {
    const src = readFileSync(LAYOUT, 'utf8');
    for (const group of LAUNCHER_GROUPS) {
      for (const link of group.links) {
        // The rail's label is the text between the tags, and two of them are ternaries
        // on the caller's role: `{ctx.role === 'parent' ? 'Your tamariki' : 'Children'}`.
        // The launcher is staff-only, so what it has to agree with is the *else* branch —
        // which is a precise thing to look for, not a reason to skip the assertion. Found
        // by this test failing on its first run against a comment claiming every label
        // was plain.
        const needle = ROLE_DEPENDENT_LABEL.has(link.href)
          ? `: '${link.label}'}`
          : `>${link.label}</NavLink>`;
        expect(
          src.includes(needle),
          `The rail does not label ${link.href} "${link.label}"`,
        ).toBe(true);
      }
    }
  });

  it('drops a group rather than showing an empty heading', () => {
    // `NavGroup`'s rule, and roles.spec.ts is emphatic about why: a heading is a
    // disclosure. "Money" over an empty list tells an educator money screens exist.
    const educator = launcherFor('educator').map((g) => g.label);
    expect(educator).toEqual(['Today', 'Tamariki', 'Records', 'People']);
    expect(educator).not.toContain('Money');
    expect(educator).not.toContain('Centre');

    const owner = launcherFor('owner').map((g) => g.label);
    expect(owner).toEqual(['Today', 'Tamariki', 'Records', 'People', 'Money', 'Centre']);

    // An educator's People card is Staff and Roster; the other three are office work.
    const people = launcherFor('educator').find((g) => g.label === 'People');
    expect(people?.links.map((l) => l.label)).toEqual(['Staff', 'Roster']);

    // Every group that survives has something in it.
    for (const role of ['owner', 'manager', 'educator', 'parent'] as const) {
      for (const group of launcherFor(role)) {
        expect(group.links.length, `${role}'s "${group.label}" is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('returns only Tamariki for a parent, which the page never asks for', () => {
    // Tamariki's three links carry no capability, so the model does answer for a parent.
    // `page.tsx` gates the whole section on `recordDailyPractice` and never calls this —
    // recorded here so that the guard being presentation-only is a stated fact rather
    // than something a reader has to reconstruct from two files.
    expect(launcherFor('parent').map((g) => g.label)).toEqual(['Tamariki']);
  });

  it('gives every group the two things a card renders', () => {
    for (const group of LAUNCHER_GROUPS) {
      expect(group.blurb.length, `${group.label} has no blurb`).toBeGreaterThan(20);
      expect(group.icon.length, `${group.label} has no icon`).toBeGreaterThan(0);
    }
  });
});
