import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { TENANT_FILE } from './paths';
import { type AuditTenant } from './tenant';

export function tenant(): AuditTenant {
  return JSON.parse(readFileSync(TENANT_FILE, 'utf8')) as AuditTenant;
}

/**
 * The rule set the run is gated on.
 *
 * WCAG 2.2 AA and nothing else. `best-practice` is excluded from the gate — those are
 * axe's own opinions (a page should have one `main`, a list should not be nested
 * oddly) and several are debatable. They are still *reported*, because a debatable
 * warning is worth reading; they just do not fail a build, since a gate nobody can
 * satisfy is a gate somebody disables.
 *
 * `wcag2a` through `wcag22aa` are cumulative in axe's tagging: 2.2 AA does not imply
 * the earlier tags, so all six are listed. Missing one silently narrows the audit.
 */
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

export interface AuditOptions {
  /**
   * Selectors to exclude, each with the reason. A bare exclusion list is how an audit
   * quietly stops covering the thing that was hard to fix, so the reason is required
   * by the type rather than by a convention nobody follows.
   */
  exclude?: Array<{ selector: string; because: string }>;
}

/**
 * Run axe against the current page and fail on any WCAG 2.2 AA violation.
 *
 * The failure message names the rule, the impact, and every offending element, because
 * "1 violation" in CI output means somebody has to reproduce it locally to learn
 * anything.
 */
export async function auditPage(page: Page, label: string, options: AuditOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_22_AA, 'best-practice']);
  for (const { selector } of options.exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();

  const gated = results.violations.filter((v) => v.tags.some((t) => WCAG_22_AA.includes(t)));
  const advisory = results.violations.filter((v) => !v.tags.some((t) => WCAG_22_AA.includes(t)));

  if (advisory.length > 0) {
    // Printed, not thrown. See the note above about gates.
    console.log(
      `  advisory (${label}): ${advisory
        .map((v) => `${v.id}×${v.nodes.length}`)
        .join(', ')}`,
    );
  }

  const detail = gated
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `      ${n.target.join(' ')}\n        ${n.failureSummary?.replace(/\n/g, '\n        ')}`)
        .join('\n');
      return `  ${v.id} [${v.impact}] — ${v.help}\n    ${v.helpUrl}\n${nodes}`;
    })
    .join('\n\n');

  expect(gated, `WCAG 2.2 AA violations on ${label}:\n\n${detail}\n`).toEqual([]);
}

/**
 * Go to a path, wait for it to settle, and assert it did not bounce to a redirect.
 *
 * The redirect check matters: `requireCapability` sends an unauthorised caller to `/`,
 * and an audit that follows that redirect would report "no violations on /funding"
 * while never having loaded /funding.
 */
export async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  const landed = new URL(page.url()).pathname;
  const expected = path.split('?')[0];
  expect(landed, `expected to land on ${expected}, ended on ${landed}`).toBe(expected);
}
