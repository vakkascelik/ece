/**
 * Performance budgets, enforced.
 *
 * WHY BUDGETS AND NOT A LIGHTHOUSE SCORE
 *
 * A Lighthouse number is a measurement of the machine that ran it. On a laptop with a
 * warm cache and a local server it says 99; on a manager's four-year-old Windows
 * laptop on centre wifi it says something else, and neither number tells you what
 * changed. Bytes shipped are deterministic, attributable to a commit, and the thing
 * that actually causes a slow first paint on a slow connection.
 *
 * The plan asks for "web LCP under 2.5s". LCP depends on the network, the device and
 * the hosting region, none of which exist yet — there is no deployment. What can be
 * governed today is the input: how much JavaScript and CSS a first visit must fetch,
 * and how much the middleware costs on *every single request*. Both are checked here.
 * When there is a deployment, add a real LCP measurement; do not retro-fit this script
 * into pretending it made one.
 *
 * WHY GZIP
 *
 * Because that is what goes over the wire. Raw byte counts overstate JavaScript by
 * roughly three times and would make every budget here meaningless.
 *
 *   npm run check:bundle
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = 'apps/web';
const NEXT = join(WEB, '.next');

/**
 * The budgets.
 *
 * Each is set slightly above the measurement taken when it was written, so that an
 * ordinary refactor does not fail the build and a new dependency does. The reason
 * matters more than the number: a budget nobody can justify gets raised the first time
 * it is inconvenient.
 */
const BUDGETS: Array<{ key: string; gzipKb: number; because: string }> = [
  {
    key: 'first-load-js',
    gzipKb: 106,
    because:
      'Everything a first visit must download before anything is interactive. ' +
      'Measured at 100.6kB gzip (342kB raw) on 2026-08-04, which agrees with the ' +
      'figure `next build` prints — a useful check that this script measures the ' +
      'right files. It is NOT a small number, and almost none of it is this app: ' +
      'React 19 and the App Router runtime are ~98kB of it, and every page in the ' +
      'product adds between 142B and 3kB on top. So movement here means a dependency ' +
      'reached the client, not that a screen got bigger. The Sentry SDK is ' +
      'deliberately not in this number — see lib/observability.ts, where a static ' +
      'import cost 75kB and a lazy one costs about 1kB.',
  },
  {
    key: 'first-load-css',
    gzipKb: 4,  // measured 2.0kB gzip
    because:
      'One hand-written stylesheet plus generated tokens. If this triples, a CSS ' +
      'framework arrived, and the tokens stop being the single source of colour.',
  },
  {
    key: 'middleware',
    gzipKb: 94,  // measured 89.3kB gzip
    because:
      'Paid on EVERY request, including ones that 404, and it runs before any cache. ' +
      'This is the number that made instrumentation.ts unacceptable in Phase 0: a ' +
      'static Sentry import took the middleware from 91kB to 176kB raw, on every ' +
      'request, to catch errors in a file that never throws.',
  },
];

function gzipKb(path: string): number {
  return gzipSync(readFileSync(path)).byteLength / 1024;
}

function rawKb(path: string): number {
  return statSync(path).size / 1024;
}

interface Measurement {
  key: string;
  gzipKb: number;
  rawKb: number;
  detail: string;
}

function measure(): Measurement[] {
  const appManifest = JSON.parse(
    readFileSync(join(NEXT, 'app-build-manifest.json'), 'utf8'),
  ) as { pages: Record<string, string[]> };

  // The root layout's asset list is what every route under (app) loads. Using the
  // layout rather than a page, because a page-specific chunk is not "first load for
  // everyone" and would make the budget depend on which route happened to be biggest.
  const rootFiles = appManifest.pages['/layout'] ?? [];
  if (rootFiles.length === 0) {
    throw new Error('No /layout entry in app-build-manifest.json — did the build run?');
  }

  const js = rootFiles.filter((f) => f.endsWith('.js'));
  const css = rootFiles.filter((f) => f.endsWith('.css'));

  const sum = (files: string[], fn: (p: string) => number) =>
    files.reduce((total, f) => total + fn(join(NEXT, f)), 0);

  const middlewareManifest = JSON.parse(
    readFileSync(join(NEXT, 'server', 'middleware-manifest.json'), 'utf8'),
  ) as { middleware: Record<string, { files: string[] }> };
  const mwFiles = middlewareManifest.middleware['/']?.files ?? [];
  if (mwFiles.length === 0) throw new Error('No middleware in the manifest.');

  return [
    {
      key: 'first-load-js',
      gzipKb: sum(js, gzipKb),
      rawKb: sum(js, rawKb),
      detail: `${js.length} chunk(s)`,
    },
    {
      key: 'first-load-css',
      gzipKb: sum(css, gzipKb),
      rawKb: sum(css, rawKb),
      detail: `${css.length} file(s)`,
    },
    {
      key: 'middleware',
      gzipKb: sum(mwFiles, gzipKb),
      rawKb: sum(mwFiles, rawKb),
      detail: `${mwFiles.length} file(s), on every request`,
    },
  ];
}

function main() {
  const measurements = measure();
  let failed = false;

  console.log('');
  console.log('  budget          gzip      raw   limit   ');
  console.log('  ─────────────────────────────────────────');

  for (const m of measurements) {
    const budget = BUDGETS.find((b) => b.key === m.key)!;
    const over = m.gzipKb > budget.gzipKb;
    if (over) failed = true;
    console.log(
      `  ${m.key.padEnd(15)} ${m.gzipKb.toFixed(1).padStart(5)}kB ${m.rawKb
        .toFixed(0)
        .padStart(6)}kB ${String(budget.gzipKb).padStart(4)}kB  ${over ? 'OVER' : 'ok'}   ${m.detail}`,
    );
    if (over) {
      console.log(`\n    ${m.key} is over budget by ${(m.gzipKb - budget.gzipKb).toFixed(1)}kB.`);
      console.log(`    Why the budget exists: ${budget.because}\n`);
    }
  }

  console.log('');
  console.log('  Not measured here: LCP, TTFB, interaction latency. Those need a');
  console.log('  deployment and a real device. The web sign-in round trip is measured');
  console.log('  by the e2e suite; the 100ms mobile budget is unmeasured — no EAS build.');
  console.log('');

  if (failed) {
    console.error('  Over budget. Raise the number deliberately, with a reason, or take it back out.');
    process.exit(1);
  }
  console.log('  Within budget.');
}

main();
