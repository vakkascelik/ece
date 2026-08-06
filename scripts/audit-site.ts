/**
 * axe against the public website, on every route, at a phone width and a laptop width.
 *
 * WHY THIS IS A SCRIPT AND NOT A PLAYWRIGHT PROJECT
 *
 * `apps/web`'s suite needs a seeded tenant and two signed-in sessions, so its config carries setup
 * and teardown projects and a `webServer` pointing at the app. This needs none of that: the site has
 * no session, no database rows and nothing to seed. Bolting it onto that config would make every
 * site check depend on Supabase being reachable and a tenant being seedable, which is the opposite of
 * true.
 *
 * WHY IT EXISTS AT ALL
 *
 * `llm-wiki/wiki/public-website.md` has claimed since the site was built that "all ten routes pass
 * axe (WCAG 2.2 AA) at 390px and 1440px with zero violations". That was true when it was written and
 * it was a **one-off run**, not something anybody could repeat — so it was a claim of the exact kind
 * this repo keeps catching itself making. Adding eight images across five pages is precisely what
 * would have quietly broken it, because the commonest image failure is a missing or useless `alt`.
 *
 *   npm run audit:site
 *
 * Assumes `npm run build:site` has already run.
 */
import { spawn } from 'node:child_process';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';

const PORT = 4319;
const BASE = `http://localhost:${PORT}`;

/** Every route a person can open. `robots.txt` and `sitemap.xml` are not pages. */
const ROUTES = [
  '/',
  '/philosophy',
  '/centres',
  '/centres/mt-albert',
  '/centres/mt-roskill',
  '/rooms',
  '/enrolment',
  '/careers',
  '/contact',
  '/this-route-does-not-exist',
];

/**
 * The same rule set as the app's audit fixture: WCAG 2.2 AA, and `best-practice` deliberately NOT
 * included — it flags things that are matters of taste, and a gate that cries wolf gets skipped.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const WIDTHS = [
  { label: 'phone', width: 390, height: 780 },
  { label: 'laptop', width: 1440, height: 900 },
];

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the site did not come up on ${PORT}. Has \`npm run build:site\` been run?`);
}

async function main() {
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'start', '-p', String(PORT)],
    { cwd: 'apps/site', stdio: 'ignore', shell: process.platform === 'win32' },
  );

  let failures = 0;
  let checked = 0;

  try {
    await waitForServer();
    const browser = await chromium.launch();

    for (const size of WIDTHS) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const page: Page = await context.newPage();

      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        checked += 1;

        /*
         * Horizontal overflow, checked here rather than in a separate pass. Their predecessor fails
         * this on every page at every width, and it is the defect a phone shows and a desktop hides —
         * so it belongs beside the axe run rather than in a document nobody re-reads. One pixel of
         * tolerance because sub-pixel rounding is not a defect.
         */
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );

        const problems: string[] = [];
        for (const v of results.violations) {
          problems.push(`${v.id} (${v.impact ?? 'unknown'}) — ${v.help} [${v.nodes.length} node(s)]`);
        }
        if (overflow > 1) problems.push(`scrolls sideways by ${overflow}px`);

        if (problems.length === 0) {
          console.log(`  ok    ${size.label.padEnd(7)} ${route}`);
        } else {
          failures += problems.length;
          console.log(`  FAIL  ${size.label.padEnd(7)} ${route}`);
          for (const p of problems) console.log(`          ${p}`);
        }
      }

      await context.close();
    }

    await browser.close();
  } finally {
    server.kill();
  }

  console.log(
    `\n  ${checked} page views checked across ${ROUTES.length} routes and ${WIDTHS.length} widths.`,
  );
  if (failures > 0) {
    console.log(`  ${failures} problem(s).\n`);
    process.exit(1);
  }
  console.log('  No violations, no horizontal overflow.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
