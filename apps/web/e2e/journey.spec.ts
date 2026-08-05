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
  // `listitem`, not `row`: the roll is a list of children with an action each, not
  // tabular data — see the note on `Roll` in attendance/page.tsx. Still scoped to the
  // named region and still located by the child, so this asserts the same thing.
  const row = notHere.getByRole('listitem').filter({ hasText: surname }).first();
  const started = Date.now();
  await row.getByRole('button', { name: 'Sign in' }).click();

  const here = page.getByRole('region', { name: /Here now/ });
  await expect(here.getByText(new RegExp(surname))).toBeVisible();
  record('web sign-in round trip (click → present on the roll)', Date.now() - started);

  // The heading carries the count, so this asserts the derived roll moved rather than
  // just that a row appeared somewhere.
  await expect(page.getByRole('heading', { name: /Here now — 2/ })).toBeVisible();

  // --- sign out -------------------------------------------------------------
  const presentRow = here.getByRole('listitem').filter({ hasText: surname }).first();
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

test('the security headers are actually on the response', async ({ page }) => {
  // Found by the Phase 6 security review: there were none. Asserted here because a header
  // set in middleware cannot be checked any other way — a unit test can prove the string
  // is built correctly and only a real response proves it arrives.
  const response = await page.goto('/attendance');
  const headers = response!.headers();

  const csp = headers['content-security-policy'];
  expect(csp, 'no CSP on the response').toBeTruthy();

  // The three directives that do the work. `script-src` must carry a nonce and must NOT
  // carry 'unsafe-inline', which would make the whole directive decorative.
  expect(csp).toMatch(/script-src [^;]*'nonce-/);
  expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  // connect-src is what stops an injected script posting a child's record elsewhere.
  expect(csp).toMatch(/connect-src [^;]*supabase\.co/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  // `same-origin`, not `no-referrer`. Deliberately asserted as an exact value, because
  // `no-referrer` broke every server action in the app — Next's origin check falls back to
  // the Referer header, which that policy strips. See lib/securityHeaders.ts.
  expect(headers['referrer-policy']).toBe('same-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['strict-transport-security']).toContain('max-age=');

  // The nonce must differ per request, or it is a constant with a misleading name.
  const second = await page.goto('/children');
  const nonceOf = (h: string) => /'nonce-([^']+)'/.exec(h)?.[1];
  expect(nonceOf(second!.headers()['content-security-policy'])).not.toBe(nonceOf(csp));
});

test('the page loads with no CSP violation', async ({ page }) => {
  // The assertion that matters. A CSP that blocks Next's own streaming scripts produces a
  // blank page and a console error, on every route at once — so this listens for the
  // violation rather than trusting that the header looks right.
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });

  await visit(page, '/attendance');
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  // Interact, so the client bundle has definitely hydrated and run.
  await expect(page.getByRole('status').first()).toBeVisible();

  expect(violations, `CSP blocked something:\n${violations.join('\n')}`).toEqual([]);
});
