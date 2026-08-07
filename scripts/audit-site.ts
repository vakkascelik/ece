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

/**
 * Kill the server and everything under it.
 *
 * ON WINDOWS `server.kill()` IS NOT ENOUGH and this cost most of an afternoon. Spawning with
 * `shell: true` — which Node requires for a `.cmd` since CVE-2024-27980 — puts `cmd.exe` between
 * this process and Next. `kill()` reaps the shell and leaves the Next server running, holding its
 * port.
 *
 * The consequence was not a leak, it was **wrong answers**. Eleven orphaned servers accumulated
 * across runs; the audit then bound to a port already held by an older one, which happily served a
 * STALE BUILD whose asset hashes no longer matched the freshly rendered HTML. Every
 * `/_next/static/*` request came back 400, so the page under test had no stylesheet at all — and an
 * unstyled page fails `target-size` on every link while passing every contrast check trivially.
 *
 * So the audit reported the same failures no matter what the CSS was changed to, which read as "the
 * fix does not work" and caused a correct fix to be reverted as a regression. A test harness that
 * silently tests the wrong build is worse than no harness.
 */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(-pid, 'SIGTERM');
  }
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
        /*
         * `networkidle` and then the fonts, and both matter — this was `domcontentloaded` and the
         * audit was measuring an UNSTYLED page.
         *
         * It reported three `target-size` failures per page that do not exist: without the
         * stylesheet, links are bare 20px inline boxes rather than the padded 26px ones they render
         * as. Running axe by hand against the same URL and viewport returned zero violations, which
         * is what exposed it.
         *
         * The false failure is the harmless half. An unstyled page is black text on a white
         * background, so every **contrast** check passes trivially — the rule this audit exists to
         * enforce was the one it was least able to see. And because `domcontentloaded` is a race
         * with the stylesheet, it did not fail every time; it passed clean when it happened to lose.
         *
         * `document.fonts.ready` as well as the network, because Literata's metrics decide how tall
         * every heading and link box actually is, and axe measures boxes.
         */
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);

        /*
         * PROVE THE PAGE IS STYLED BEFORE MEASURING IT.
         *
         * This is the guard the whole afternoon above argues for. An unstyled page does not look
         * broken to axe — it looks like a page that fails target-size everywhere and passes contrast
         * everywhere, which is a plausible-looking result and a completely false one.
         *
         * `body` is given its warm ground by the stylesheet and has no background without it, so a
         * transparent body is proof the CSS never arrived. Throwing beats reporting: a failed run is
         * obvious, and a confidently wrong one is not.
         */
        const styled = await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)',
        );
        if (!styled) {
          throw new Error(
            `${route} rendered without its stylesheet, so nothing measured here would mean ` +
              'anything. Usually an orphaned `next start` from an earlier run is holding the port ' +
              'and serving a stale build — check for a listener on ' + PORT + '.',
          );
        }

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

        /*
         * The failing nodes, not just a count.
         *
         * The first version printed `rule (impact) — help [n node(s)]` and nothing else, which is
         * enough to know something is wrong and useless for knowing what. It cost an hour of
         * bisecting to find out that three anonymous `target-size` nodes were a footer, and the
         * whole point of a gate is that its output tells you where to look.
         */
        /*
         * `lines` is what gets printed; `count` is what decides the exit code. Keeping them apart
         * because the first version did `failures += problems.length` and then grew to print three
         * or four lines per node — so adding detail to the output silently multiplied the reported
         * failure count from 25 to 297 without a single new defect. A counter that counts its own
         * log lines is a counter that lies the moment somebody improves the log.
         */
        const problems: string[] = [];
        let count = 0;
        for (const v of results.violations) {
          count += v.nodes.length;
          problems.push(`${v.id} (${v.impact ?? 'unknown'}) — ${v.help}`);
          for (const node of v.nodes) {
            problems.push(`    ${node.target.join(' ')}`);
            problems.push(`      ${node.html.replace(/\s+/g, ' ').slice(0, 110)}`);
            // axe's own explanation. Without it a `target-size` failure on a 44px-tall link is a
            // riddle — the rule fails for overlap as well as for size, and only the message says which.
            for (const check of [...node.any, ...node.all, ...node.none]) {
              if (check.message) problems.push(`      why: ${check.message.replace(/\s+/g, ' ')}`);
            }
          }
        }
        if (overflow > 1) {
          problems.push(`scrolls sideways by ${overflow}px`);
          count += 1;
        }

        if (problems.length === 0) {
          console.log(`  ok    ${size.label.padEnd(7)} ${route}`);
        } else {
          failures += count;
          console.log(`  FAIL  ${size.label.padEnd(7)} ${route}`);
          for (const p of problems) console.log(`          ${p}`);
        }
      }

      await context.close();
    }

    await browser.close();
  } finally {
    killTree(server.pid);
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
