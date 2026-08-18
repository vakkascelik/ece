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
 * because the plan states a budget and an unmeasured budget is a wish.
 *
 * WHAT THESE NUMBERS ARE, CORRECTED 2026-08-18
 *
 * This header used to say the measured figure was "the *web* round trip: click a
 * labelled button, server action, RLS, insert, revalidate, repaint", and warned that
 * conflating it with the plan's 100ms mobile optimistic budget "would let a fast web
 * action stand in for an untested tablet".
 *
 * That warning came true against this very file. `751837a` moved the roll to the client
 * and gave the web app the outbox, so a tap now enqueues locally and repaints from local
 * state while the flush goes out behind it. The recorded figure fell from a tight
 * 894–971ms band to 68–130ms in one commit — and stopped being a round trip at the same
 * moment, because the assertion it ends on is satisfied by the optimistic paint. Nobody
 * noticed for twelve days; the number got faster, which is not the direction that makes
 * people look.
 *
 * So there are two measurements now, named for what they actually contain:
 *
 *   `web sign-in paint` — click to the child appearing on the roll. No network in it.
 *     This is the web analogue of the plan's mobile 100ms budget, and comparable to it.
 *   `web sign-in confirmed` — click until the "Waiting to send" badge clears, which is
 *     the flush landing in Postgres. THIS is the round trip: server action, RLS, insert.
 *
 * The mobile figure still cannot be measured without a device build. Two different
 * numbers, and now three, each labelled so the fast one cannot be quoted as the slow one.
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
  record('web sign-in paint (click → present on the roll, no network)', Date.now() - started);

  /*
    And now the part the old label was claiming. The row is present from the local queue;
    "Waiting to send" is up until the flush lands, so waiting for it to clear measures the
    server action, RLS and the insert — the round trip the previous single number was
    mistaken for. Scoped to this child's row: another child's badge clearing would satisfy
    an unscoped locator and turn this into a measurement of somebody else's write.
  */
  const signedInRow = here.getByRole('listitem').filter({ hasText: surname }).first();
  await expect(signedInRow.getByText(/Waiting to send/)).toHaveCount(0);
  record('web sign-in confirmed (click → flushed to Postgres)', Date.now() - started);

  // The heading carries the count, so this asserts the derived roll moved rather than
  // just that a row appeared somewhere.
  await expect(page.getByRole('heading', { name: /Here now — 2/ })).toBeVisible();

  // --- sign out -------------------------------------------------------------
  const presentRow = here.getByRole('listitem').filter({ hasText: surname }).first();
  const outAt = Date.now();
  await presentRow.getByRole('button', { name: 'Sign out' }).click();
  await expect(here.getByText(new RegExp(surname))).toHaveCount(0);
  // Same correction as above: the row leaves "Here now" on the local write, so this is a
  // paint figure and is labelled as one. The sign-out has no badge left to watch once the
  // row has gone, so there is no confirmed counterpart — a gap named rather than papered
  // over with the paint number under a round-trip label.
  record('web sign-out paint (click → gone from the roll, no network)', Date.now() - outAt);
});

test('the ratio is on screen without going to find it', async ({ page }) => {
  // The plan's commitment is that the ratio is "a persistent glanceable state, never a
  // report you go and find". On web that means it is above the roll, not behind a tab.
  await visit(page, '/attendance');
  const banner = page.getByRole('status').first();
  await expect(banner).toBeVisible();

  // THE TRIPWIRE FIRED, AS DESIGNED. This asserted the "not been checked against the
  // regulations" caveat while RATIO_TABLES_VERIFIED was false, and said in as many words
  // that flipping the flag was supposed to break it — so that the caveat could not be
  // removed from the code and left in the UI, or the reverse. On 2026-08-18 the bands were
  // checked against Schedule 2 and the flag flipped; this assertion moved with it.
  //
  // What it now guards is the caveat that does NOT go away: the tables are right and the
  // inputs are still incomplete, because Schedule 2 counts every person present aged under
  // 6 and this product only knows who was signed in.
  //
  // Still scoped to the ratio block. Unscoped with `.first()` it silently started matching
  // the in-product help note instead, which quotes the same caveat inside a closed
  // `<details>` — a tripwire satisfiable by prose about itself is not a tripwire.
  await expect(
    page.locator('.ratio').getByText(/counts children signed in today/i),
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

/**
 * The same assertion on the routes nobody is signed in for — and this is the test that was
 * missing rather than an extra one.
 *
 * The test above visits `/attendance`, which is rendered per request and has always received a
 * nonce, so it could not fail. `/login`, `/no-access` and the 404 were **prerendered**, and a
 * prerendered page cannot carry a per-request nonce: no render, nothing to stamp it onto. With
 * `'strict-dynamic'` in `script-src`, CSP3 requires the browser to ignore `'self'`, so every
 * script on the first screen every user meets was refused in production.
 *
 * It stayed invisible for two compounding reasons. Sign-in survives as a full-page POST, because
 * React leaves progressive-enhancement markup in the HTML — so the seed step and every login in
 * this suite kept working. And `docs/deploy-railway.md` told whoever deployed it to look for
 * exactly this on `/login`, then reassured them the e2e suite already covered it. It did not.
 *
 * A fresh context, because `storageState` on this project is a signed-in owner and `/login`
 * redirects them away.
 */
test('no CSP violation on the routes that are reached without a session', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) {
      violations.push(`${page.url()}: ${msg.text()}`);
    }
  });

  for (const path of ['/login', '/no-access', '/this-route-does-not-exist']) {
    await page.goto(path);
    // Wait for hydration rather than for load: a blocked bundle still fires load, so asserting
    // on the network would pass against the broken build. React only removes its
    // progressive-enhancement attribute once the client bundle has actually run.
    await page.waitForLoadState('networkidle');
  }

  // /login is the one that has to hydrate: its useEffect moves focus to the error on a failed
  // sign-in, which is the accessibility behaviour the handoff asked for and the first thing lost
  // when scripts are blocked.
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  await page.getByLabel(/email/i).fill('nobody@ece.invalid');
  await page.getByLabel(/password/i).fill('wrong-password-on-purpose');
  await page.getByRole('button', { name: /sign in/i }).click();
  // `p[role=alert]`, not `getByRole('alert')` — Next injects its own
  // `<div role="alert" id="__next-route-announcer__">`, so the bare role matches two elements and
  // trips strict mode. Scoped to the login form's own alert.
  const alert = page.locator('p[role="alert"]');
  await expect(alert).toBeVisible();
  // Proof that the client bundle ran: focus is on the alert, which only the useEffect does.
  await expect(alert).toBeFocused();

  expect(violations, `CSP blocked something:\n${violations.join('\n')}`).toEqual([]);
  await context.close();
});
