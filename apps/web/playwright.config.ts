import { defineConfig, devices } from '@playwright/test';
// Absolute, because Playwright resolves `storageState` against the process working
// directory and not against this file. Relative strings put two live session cookies in
// an unignored directory at the repo root; see e2e/fixtures/paths.ts.
import { OWNER_STATE, PARENT_STATE } from './e2e/fixtures/paths';

/**
 * End-to-end and accessibility audit.
 *
 * WHY A PRODUCTION BUILD AND NOT `next dev`
 *
 * Because the audit is of the artefact people use. `next dev` serves unminified CSS,
 * a different bundle, no route pre-rendering, and a development React that renders
 * extra attributes. A contrast measurement taken against the dev server is a
 * measurement of something nobody is served.
 *
 * WHY ONE BROWSER
 *
 * axe-core's checks that actually vary by engine are the ones this audit is weakest
 * at anyway (screen-reader behaviour, which no automated tool covers). Running the
 * same rule set three times measures Playwright, not the app. Cross-browser matters
 * for layout, and there is no layout here that Firefox and WebKit disagree about —
 * one grid and one flex row. If that changes, add the projects then.
 *
 * A NOTE ON WHAT THIS PROVES
 *
 * axe finds perhaps a third to a half of WCAG failures — it is good at contrast,
 * names, roles, and structure, and it cannot tell whether a focus order makes sense
 * or whether an error message would help anyone. Zero violations here is a floor,
 * not a pass. The manual keyboard and screen-reader pass is a separate, human job
 * and it has not been done. Recorded in the wiki as an open item, not implied to be
 * covered by a green run.
 */
const PORT = Number(process.env.ECE_E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // A run mutates a shared database, so parallel workers would race on the fixture.
  // The fixture is per-run tagged, but the ratio and roll views are per-centre and a
  // second worker signing a child in would change what the first one is measuring.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The audit is of the app as an operator sees it, so a real viewport rather than
    // Playwright's 1280x720 default — a manager is on a laptop.
    viewport: { width: 1440, height: 900 },
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
  },

  projects: [
    {
      name: 'seed',
      testMatch: /seed\.setup\.ts/,
      teardown: 'cleanup',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'cleanup',
      testMatch: /cleanup\.teardown\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'owner',
      dependencies: ['seed'],
      testMatch: /(a11y|journey)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: OWNER_STATE },
    },
    {
      // The whānau-facing screens are the ones a non-technical person uses under
      // pressure, and they render differently — different nav, different consent
      // panel, a single child instead of a roll. Auditing only the staff view would
      // miss every one of those differences.
      name: 'parent',
      dependencies: ['seed'],
      testMatch: /a11y-parent\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: PARENT_STATE },
    },
  ],

  webServer: {
    // `next start`, so this serves the same output as production. Requires a build,
    // which `npm run test:e2e` does first.
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
