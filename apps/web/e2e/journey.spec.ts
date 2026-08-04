import { appendFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';
import { ensureArtifacts, TIMINGS_FILE } from './fixtures/paths';

/**
 * The journey the plan asks for: sign in, switch centre, enrol, sign a child in.
 *
 * Sign-in and centre switching happen in `seed.setup.ts` — they have to, to produce a
 * session — so this picks up at enrolment.
 *
 * It also measures. Not because a number in a log is a performance culture, but
 * because the plan states a budget and an unmeasured budget is a wish. What is
 * measured here is the *web* round trip: click a labelled button, server action, RLS,
 * insert, revalidate, repaint. The plan's 100ms figure is about the **mobile**
 * optimistic write, which paints before the network is involved at all, and that
 * cannot be measured without a device build. Two different numbers; conflating them
 * would let a fast web action stand in for an untested tablet.
 */

function record(label: string, ms: number) {
  ensureArtifacts();
  appendFileSync(TIMINGS_FILE, `${label}\t${Math.round(ms)}ms\n`);
  console.log(`  ⏱ ${label}: ${Math.round(ms)}ms`);
}

test('enrol a child, then sign them in and out', async ({ page }) => {
  const t = tenant();
  const surname = `Journey-${t.tag}`;

  // --- enrol ---------------------------------------------------------------
  await visit(page, '/children/new');
  await page.getByLabel('First name').fill('Aroha');
  await page.getByLabel('Last name').fill(surname);
  await page.getByLabel('Preferred name').fill('Ro');
  // Three years old, so this child lands in the over-two band and the ratio
  // assessment has both bands to combine.
  const dob = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Date of birth').fill(dob);
  await page.getByLabel('Ethnicities').fill('Māori');
  await page.getByRole('button', { name: 'Enrol' }).click();

  // Landing on the child's own record is the confirmation. Asserting on the heading
  // rather than a toast, because a toast can appear without the row existing.
  await expect(page.getByRole('heading', { name: /Aroha|Ro/ })).toBeVisible();

  // --- appears on the roll --------------------------------------------------
  await visit(page, '/attendance');
  const notHere = page.getByRole('region', { name: /Not here/ });
  await expect(notHere.getByText(new RegExp(surname))).toBeVisible();

  // --- sign in, measured ----------------------------------------------------
  const row = notHere.getByRole('row', { name: new RegExp(surname) }).first();
  const started = Date.now();
  await row.getByRole('button', { name: 'Sign in' }).click();

  const here = page.getByRole('region', { name: /Here now/ });
  await expect(here.getByText(new RegExp(surname))).toBeVisible();
  record('web sign-in round trip (click → present on the roll)', Date.now() - started);

  // The heading carries the count, so this asserts the derived roll moved rather than
  // just that a row appeared somewhere.
  await expect(page.getByRole('heading', { name: /Here now — 2/ })).toBeVisible();

  // --- sign out -------------------------------------------------------------
  const presentRow = here.getByRole('row', { name: new RegExp(surname) }).first();
  const outAt = Date.now();
  await presentRow.getByRole('button', { name: 'Sign out' }).click();
  await expect(here.getByText(new RegExp(surname))).toHaveCount(0);
  record('web sign-out round trip', Date.now() - outAt);
});

test('the ratio is on screen without going to find it', async ({ page }) => {
  // The plan's commitment is that the ratio is "a persistent glanceable state, never a
  // report you go and find". On web that means it is above the roll, not behind a tab.
  await visit(page, '/attendance');
  const banner = page.getByRole('status').first();
  await expect(banner).toBeVisible();

  // And it says it is unverified, because `RATIO_TABLES_VERIFIED` is false. When that
  // flag flips this assertion is supposed to fail — it is the tripwire that stops the
  // caveat being removed from the code and left in the UI, or vice versa.
  await expect(
    page.getByText(/have not been checked against the regulations/i).first(),
  ).toBeVisible();
});

test('the funding page refuses to look final while a day is broken', async ({ page }) => {
  const t = tenant();
  // The fixture signs a child in and never out, so today is unresolved by
  // construction. The banner must say so — a summary that looks final while a day is
  // missing is a summary that gets keyed into ELI Web.
  await visit(page, '/funding');
  await expect(page.getByText(/Incomplete/).first()).toBeVisible();
  await expect(page.getByText(/cannot submit/i).first()).toBeVisible();
  expect(t.childName).toBe('Tāne');
});

test('the binder prints as a document, not as the app', async ({ page }) => {
  // print CSS is the whole PDF strategy, so it is worth one assertion that the
  // navigation is not in the printed output.
  await visit(page, '/compliance/binder');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('aside.side')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Licensing evidence' })).toBeVisible();
});
