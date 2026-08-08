import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing in this repo may ask UTC what day it is.
 *
 * WHY A TEST THAT READS SOURCE CODE
 *
 * Same reasoning as `bounded-queries.test.ts` in `@ece/api`: the bug is invisible to every
 * other check. `new Date().toISOString().slice(0, 10)` typechecks, lints, and returns the
 * right answer for eleven hours a day — then returns **yesterday** for the whole New Zealand
 * morning, because Auckland is twelve or thirteen hours ahead of UTC. A unit test written at
 * 3pm passes. The same test written at 9am passes too, as long as it was authored in the same
 * wrong way as the code.
 *
 * This has already cost this repo twice. `0006` records the first: a `CHECK` constraint using
 * `current_date` rejected a baby born that morning as born in the future. The second was found
 * on 2026-08-07 in `recordPayment`, which would have dated every payment reconciled before
 * about 1pm to the previous day — in the wrong month for anything reconciled on the 1st.
 * [AGENTS.md](../../../../AGENTS.md) states the rule; until now nothing enforced it.
 *
 * THE DISTINCTION THIS DRAWS
 *
 * The forbidden thing is not `toISOString`, which is correct and necessary for a `timestamptz`
 * — a point in time has no timezone problem. It is taking the **date part** of a UTC instant
 * and treating it as a calendar day, because a calendar day only exists relative to a place.
 *
 * `todayInZone(centre.timezone)` is the answer for "what day is it". Arithmetic on a date that
 * has *already* been resolved in the right zone is fine, and is what the allowlist below is
 * for — with the argument written out, so the exemption is a decision rather than a habit.
 */

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

/** Source trees that ship. Tests, config and build output are not scanned. */
const TREES = [
  join('packages', 'core', 'src'),
  join('packages', 'api', 'src'),
  join('apps', 'web', 'src'),
  join('apps', 'site', 'src'),
  join('apps', 'mobile'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.expo', '__tests__', 'coverage']);

/**
 * The date part of a UTC instant, however it is spelled. `slice`, `substring`, `split('T')[0]`
 * and a `toJSON()` in place of `toISOString()` all produce the same wrong answer, so the
 * pattern matches the shape rather than one spelling of it.
 */
const UTC_DATE_PART =
  /\.(?:toISOString|toJSON)\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*10\s*\)|\.(?:toISOString|toJSON)\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/;

/**
 * Uses that are correct, each with the reason it is correct.
 *
 * Keyed by `path:line-content-fragment` so moving a function does not silently carry its
 * exemption to different code. An entry here is an argument that the Date being formatted was
 * built from components already resolved in the centre's zone — never that the call site is
 * "probably fine".
 */
const RESOLVED_ELSEWHERE: Record<string, string> = {
  /*
    `shiftLocalDate` walks a date a caller already resolved with `todayInZone`, using
    explicit `Date.UTC` components at both ends — so the offset cancels and it never
    asks what day it is.

    There is still exactly one entry here, and it has now moved twice: from an inline
    copy in `/incidents`, to `apps/web/src/lib/dayWindow.ts`, to core when
    `staff.ts` needed it and core cannot import from an app. Each time the guard
    refused a second exemption and the function moved instead, which is the whole
    argument for keeping the list short enough to notice.
  */
  'packages/core/src/children.ts': 'arithmetic on an already-resolved date, via explicit Date.UTC components',
};

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // A tree that is not checked out (mobile on a web-only install) is not a failure.
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('no calendar day is taken from UTC', () => {
  const files = TREES.flatMap((tree) => walk(join(REPO, tree)));

  it('scans a source tree that actually exists', () => {
    // A glob that silently matches nothing is a green test that checked nothing — the exact
    // failure this file exists to prevent, one level up.
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds no UTC date-part extraction outside the allowlist', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(REPO, file).split(sep).join('/');
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);

      lines.forEach((line, i) => {
        // Comments explaining the trap are how this repo documents it. Only code counts.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (!UTC_DATE_PART.test(code)) return;
        if (RESOLVED_ELSEWHERE[rel]) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `A calendar day was taken from a UTC instant. For the whole New Zealand morning that is\n` +
        `yesterday. Use todayInZone(centre.timezone), or add an entry to RESOLVED_ELSEWHERE\n` +
        `stating why the Date was already resolved in the right zone.\n\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });

  it('would catch the defect it was written for', () => {
    // Mutation test, inline. The suite's own rule: a test that cannot fail is not a test, and
    // this one's whole value is the regex — which is the part most likely to rot silently.
    expect(UTC_DATE_PART.test('paid_on: new Date().toISOString().slice(0, 10),')).toBe(true);
    expect(UTC_DATE_PART.test("const d = new Date().toISOString().split('T')[0];")).toBe(true);
    expect(UTC_DATE_PART.test('new Date().toISOString().substring(0,10)')).toBe(true);
    // A timestamptz is a point in time and has no calendar-day problem. Not an offence.
    expect(UTC_DATE_PART.test('voided_at: new Date().toISOString(),')).toBe(false);
  });
});
