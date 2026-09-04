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
  /*
   * `/do not use/` rather than `/Incomplete/`, and the difference is the point.
   *
   * The banner has THREE states since `periodPrecedesRecord` landed (0029-era fix,
   * 2026-08-29): "Records do not cover this period — do not use", "Incomplete — do not
   * use yet", and "Preparation figures". A fresh fixture tenant signs its child in today,
   * so the funding period begins before the attendance record exists and the page shows
   * the FIRST refusal, not the second. This test named only the second and so contradicted
   * the feature it was guarding.
   *
   * It went unnoticed because it could not run: every navigation timed out on
   * `networkidle` from 2026-08-28 until 2026-09-03. Asserting the intent — the page refuses
   * to look final — is what this test was always for, and both refusals satisfy it while
   * "Preparation figures" does not.
   */
  await expect(page.getByText(/do not use/i).first()).toBeVisible();
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

/**
 * 0084 — an enrolment records whether it is permanent, and that reaches the database.
 *
 * WHY THIS IS WORTH A BROWSER. The column exists to answer one question: may this child's
 * booked-but-absent days be claimed? Funding Handbook 6-4 says yes for a permanently
 * enrolled child and no for a casual or conditional one, so the value has to survive the
 * whole round trip — select, server action, CHECK constraint, read back — or absence
 * funding will be computed against something nobody chose.
 *
 * Files its own child rather than reusing the fixture's, because `enrolments_no_overlap`
 * refuses a second open enrolment for the same child and the fixture's may already have
 * one. A self-contained child is cheaper than knowing.
 *
 * ASSERTS THE FLAG, NOT THE SELECT. Reading the select back would prove the form
 * remembered its own state; the flag in the enrolment row is rendered from what the
 * database returned.
 */
test('an enrolment is filed as permanent, and the record says so', async ({ page }) => {
  const t = tenant();
  const surname = `Enrolled-${t.tag}`;

  await visit(page, '/children/new');
  await page.getByLabel('First name').fill('Tama');
  await page.getByLabel('Last name').fill(surname);
  const dob = new Date(Date.now() - 4 * 365 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Date of birth').fill(dob);
  await page.getByRole('button', { name: 'Enrol' }).click();
  await expect(page.getByRole('heading', { name: /Tama/ })).toBeVisible();

  /*
    The enrolment panel lives on the DOCUMENTS tab, not the overview. The record's tabs are
    routes rather than state (see `tabs.ts`), so this is a navigation and not a click on a
    toggle — and the first version of this test looked for the button on the overview and
    timed out for sixty seconds against a page that was working perfectly.

    Scoped to the record's own nav: the tab labels are ordinary words and `Documents` could
    plausibly appear elsewhere on the page later.
  */
  await page
    .getByRole('navigation', { name: /record/i })
    .getByRole('link', { name: 'Documents' })
    .click();

  await page.getByRole('button', { name: 'File an enrolment' }).click();

  // Not stated is the default, and that is the assertion — nothing pre-selects a type,
  // because a pre-selected 'Permanent' would be the product deciding whether absences
  // may be claimed.
  await expect(page.getByLabel('Enrolment type')).toHaveValue('');

  await page.getByLabel('First day').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Funded hours a week').fill('20');
  await page.getByLabel('Enrolment type').selectOption('permanent');
  await page.getByRole('button', { name: 'File enrolment' }).click();

  // The refusal check first. A 23P01 overlap or a CHECK violation surfaces here as a
  // sentence, and asserting the flag without this would report "the flag is missing" for a
  // write that was refused — two different bugs with one symptom.
  await expect(page.locator('.error')).toHaveCount(0);

  /*
    Located by CLASS, not by text, and that matters: `getByText('Permanent')` also matches
    the select's own `<option>Permanent</option>`, so it would pass whether or not anything
    was stored. The flag is rendered from the row the database returned, so this is proof of
    a round trip.

    The child's surname deliberately avoids the word too — it was `Permanent-<tag>` in the
    first version of this test, which is a third way to match the assertion without the
    column working.
  */
  await expect(page.locator('span.flag').filter({ hasText: /^Permanent$/ })).toBeVisible();

  /*
    ---- and then the days and times, which is the agreement itself ----------

    `child_booking_schedule` (0085) shipped with zero readers or writers, so this is the first
    assertion that the whole path works: form → server action → `caller_may_enrol` → the GiST
    overlap constraint → read back.

    Scoped to the panel's own section, because `getByLabel('Day')` would otherwise be ambiguous with
    the enrolment form's "Days attending" a few hundred pixels up the same page — accessible-name
    matching is substring by default, and that is exactly the kind of near-miss that makes a test
    pass against the wrong control.
  */
  /*
    DATES RELATIVE TO TODAY, AND NOT TODAY ITSELF — this test failed on 2026-09-04 for a reason
    that had nothing to do with the code under test.

    `new Date().toISOString()` is a UTC date. The panel decides whether a block is in force
    against the CENTRE'S date, which is NZ. Those two are the same date only from NZ noon
    onward; before noon, UTC is still yesterday. So filling the last day with "today" gave a
    block that ended yesterday in the morning — not in force, assertion passes — and one that
    ends today in the afternoon, which IS still in force, because `coversDate` is inclusive of
    `effectiveTo` and a block ending today covers today.

    The test therefore passed every morning and failed every afternoon, and had been doing so
    since it was written. It went green on the run before this one at NZ 10:50 and red at 12:29.

    Fixed by using dates far enough from the boundary that a one-day zone difference cannot
    change the answer, rather than by weakening the assertion: a block that ran from a week ago
    until two days ago is not in force today in any timezone this product runs in.
  */
  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  const schedule = page.locator('div.section').filter({ hasText: 'Days and times' });

  // Nothing recorded yet, and the empty state says what the enrolment holds instead rather than
  // implying the child attends no days.
  await expect(schedule.getByText('No days and times recorded.')).toBeVisible();

  await schedule.getByLabel('Day').selectOption('2');
  await schedule.getByLabel('From', { exact: true }).fill('08:00');
  await schedule.getByLabel('To', { exact: true }).fill('15:00');
  await schedule.getByLabel('Applies from').fill(isoDaysAgo(7));
  await schedule.getByRole('button', { name: 'Add' }).click();

  // Before any reload. A refused write and a write that did not persist look identical after one,
  // and 0085's write predicate is narrower than its read predicate — so this is the assertion that
  // would catch a policy or grant mistake rather than reporting a missing row.
  await expect(schedule.locator('.error')).toHaveCount(0);

  // Read back from the database, with the ELI wire code beside the day name.
  await expect(schedule.getByRole('cell', { name: /Tue/ })).toBeVisible();
  await expect(schedule.getByText('Tu', { exact: true })).toBeVisible();
  await expect(schedule.getByText('✓ current')).toBeVisible();

  /*
    Changing an agreement is two gestures, not an edit — §6-7 requires the agreement to be changed
    when attendance stops matching it, and the earlier period has to stay answerable because a
    funding claim was calculated against it. Ending the block is the first half.
  */
  await schedule.getByLabel(/Last day for/).fill(isoDaysAgo(2));
  await schedule.getByRole('button', { name: 'End' }).click();
  await expect(schedule.locator('.error')).toHaveCount(0);
  await expect(schedule.getByText('not in force')).toBeVisible();
});

/**
 * §6-1's enrolment record, completed — `0087`.
 *
 * The migration landed with no reader or writer, the same as `0085` and `0086` before it, and
 * this is the assertion that the whole path works: guardian → picker → server action →
 * `caller_may_enrol` → `assert_signatories_are_guardians` → the paired CHECK → read back.
 *
 * IT NEEDS A GUARDIAN, which is why this test does more setup than the others. The signatory is
 * a `guardians` reference and a trigger requires a current guardian of that child, so a child
 * with no whānau linked has nobody who *could* sign — the panel says so rather than showing an
 * empty dropdown, and that state is asserted first because it is the state every existing child
 * is in.
 */
test('an enrolment record is completed against §6-1, and the gaps are named until it is', async ({
  page,
}) => {
  const t = tenant();

  await visit(page, '/children/new');
  await page.getByLabel('First name').fill('Mere');
  await page.getByLabel('Last name').fill(`Recorded-${t.tag}`);
  await page
    .getByLabel('Date of birth')
    .fill(new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Enrol' }).click();
  await expect(page.getByRole('heading', { name: /Mere/ })).toBeVisible();

  // ---- file an enrolment, with nobody able to sign it yet -------------------
  const nav = page.getByRole('navigation', { name: /record/i });
  await nav.getByRole('link', { name: 'Documents' }).click();
  await page.getByRole('button', { name: 'File an enrolment' }).click();
  await page.getByLabel('First day').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Funded hours a week').fill('20');
  /*
    The type and the days are filled here because they are ALSO §6-1 requirements, and the
    first version of this test left them out — so the record stayed incomplete after the
    signature was recorded and the final assertion failed against correct behaviour.

    Worth keeping rather than quietly fixing: it is the gap function working. Two of the four
    things it reported missing were things this test had never supplied, which is exactly what
    a completeness check is for.
  */
  await page.getByLabel('Enrolment type').selectOption('permanent');
  await page.getByRole('checkbox', { name: 'Tue' }).check();
  await page.getByRole('button', { name: 'File enrolment' }).click();
  await expect(page.locator('.error')).toHaveCount(0);

  /*
    The record is incomplete and the panel says which parts are missing. This is the assertion
    that `enrolmentRecordGaps` is wired to the screen at all — a gap function nothing renders is
    a unit test with extra steps.
  */
  const enrolment = page.locator('div.section').filter({ hasText: 'Enrolment' }).first();
  await expect(enrolment.locator('span.flag').filter({ hasText: 'Record incomplete' })).toBeVisible();

  await enrolment.getByRole('button', { name: 'Complete' }).click();
  await expect(enrolment.getByText(/the hours at another service/)).toBeVisible();
  await expect(enrolment.getByText(/a dated parent signature/)).toBeVisible();

  /*
    And with no whānau linked there is nobody who could sign. Named rather than shown as an
    empty picker, because an empty dropdown reads as a broken control rather than as the
    missing prerequisite it is.
  */
  await expect(enrolment.getByText(/No whānau are linked to this child yet/)).toBeVisible();

  // ---- link a guardian -----------------------------------------------------
  await nav.getByRole('link', { name: 'Whānau' }).click();
  await page.getByRole('button', { name: 'Add someone' }).click();
  await page.getByLabel('Name').fill('Hine Recorded');
  await page.getByLabel('Relationship').fill('mother');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Hine Recorded')).toBeVisible();

  // ---- now the record can be completed -------------------------------------
  await nav.getByRole('link', { name: 'Documents' }).click();
  const enrolment2 = page.locator('div.section').filter({ hasText: 'Enrolment' }).first();
  await enrolment2.getByRole('button', { name: 'Complete' }).click();

  /*
    ZERO IS THE ANSWER BEING TESTED, not a placeholder. §6-1 wants the other-service hours
    "including none if appropriate", so 0 and blank are different answers — and `Number('')` is
    0, which is exactly how they get collapsed. If the action ever treats an empty box as zero,
    the gap below stops being reported and this test still passes; what catches that is the
    unit test in `children.test.ts`, and what catches the reverse — 0 being treated as absent —
    is the assertion that the incomplete flag goes away.
  */
  await enrolment2.getByLabel('Hours a week at another service').fill('0');
  await enrolment2
    .getByLabel('Enrolment record signed on')
    .fill(new Date().toISOString().slice(0, 10));
  await enrolment2.getByLabel('Signed by').selectOption({ label: 'Hine Recorded' });
  await enrolment2.getByRole('button', { name: 'Save' }).click();

  // Before any reload: a refusal and a write that did not persist look identical afterwards.
  await expect(page.locator('.error')).toHaveCount(0);

  /*
    The gap flag is gone, which is the read-back. It went through the trigger to get here: the
    guardian id came from a picker built from this child's own whānau, which is the only list
    `assert_signatories_are_guardians` accepts.
  */
  await expect(page.locator('span.flag').filter({ hasText: 'Record incomplete' })).toHaveCount(0);
});

/**
 * Where the child lives — `child_addresses` (0086).
 *
 * Its own test rather than an addition to the one above, even though §6-1 puts the address inside
 * the enrolment record and the child would already exist. A failure here should name the address
 * rather than appear as the fourth surprise in a test called "filed as permanent", and the two
 * paths share nothing but a child.
 *
 * The table shipped with zero readers or writers, one commit after `0085` did the same, so this is
 * the first proof the whole path works: form → server action → `caller_may_enrol` → the trim and
 * `String100` CHECKs → read back.
 */
test('a child gets a residential address, and the second household can be removed', async ({
  page,
}) => {
  const t = tenant();

  await visit(page, '/children/new');
  await page.getByLabel('First name').fill('Aroha');
  await page.getByLabel('Last name').fill(`Addressed-${t.tag}`);
  await page
    .getByLabel('Date of birth')
    .fill(new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Enrol' }).click();
  await expect(page.getByRole('heading', { name: /Aroha/ })).toBeVisible();

  // The panel is on the WHĀNAU tab, beside the people, not on Documents with the enrolment.
  // A tab route, so a navigation rather than a toggle — the mistake that cost two runs on 2A.
  await page
    .getByRole('navigation', { name: /record/i })
    .getByRole('link', { name: 'Whānau' })
    .click();

  const panel = page.locator('div.section').filter({ hasText: /Where .* lives/ });

  /*
    The gap is NAMED, not left blank, and that is an assertion rather than decoration: a missing
    residential address is one of §6-1's required enrolment-record contents and a required element
    on `ChildEnrolment`, so a record without one cannot be submitted even once submission exists.
  */
  await expect(panel.getByText('No home address recorded.')).toBeVisible();
  await expect(panel.locator('span.flag').filter({ hasText: 'Not recorded' })).toBeVisible();

  /*
    Scoped to the `<section>`, not the panel: both forms carry a "Street address" and a "Town or
    city", because there are two addresses in the schema and they take the same five fields.
    Unscoped, `getByLabel('Street address')` matches twice and the test fails for a reason that
    has nothing to do with the code under test.
  */
  const home = panel.locator('section').filter({ hasText: 'Home address' });
  await home.getByLabel('Street address').fill('12 Example Road');
  await home.getByLabel('Suburb or unit (optional)').fill('Mount Albert');
  await home.getByLabel('Town or city').fill('Auckland');
  await home.getByLabel('Postcode (optional)').fill('1025');
  await home.getByRole('button', { name: 'Record' }).click();

  // Before any reload, as everywhere in this suite: a refused write and a write that did not
  // persist look identical afterwards, and `0086`'s write predicate is narrower than its read
  // predicate — so this is the assertion that would catch a policy or grant mistake.
  await expect(panel.locator('.error')).toHaveCount(0);

  // Read back from the database, comma-joined in the order a person says an address.
  await expect(panel.getByText('12 Example Road, Mount Albert, Auckland, 1025')).toBeVisible();
  await expect(panel.locator('span.flag').filter({ hasText: 'Not recorded' })).toHaveCount(0);

  /*
    Country is deliberately NOT defaulted to New Zealand, and this pins it. The element is
    optional and nillable; a value nobody typed would be the product asserting a country the
    service never stated, which is what AGENTS.md §7 forbids. Blank is stored as null, so the
    read-back above has four parts and not five.
  */
  await expect(home.getByLabel('Country (optional)')).toHaveValue('');

  /*
    THE PRIMARY HAS NO REMOVE BUTTON, and that is the screen's policy rather than the database's:
    every field of it is overwritable, so removing it can only leave the enrolment record
    incomplete against §6-1. The API function is not restricted this way.
  */
  await expect(home.getByRole('button', { name: /Remove/ })).toHaveCount(0);

  /*
    ---- the second household, which is the case the schema's optional address exists for ----

    A child who lives in two places. Removal is offered here because "this child no longer has a
    second household" is a real change no edit can express — the two required fields cannot be
    blanked — and it exercises `deleteChildAddress` keyed on `(child_id, kind)` rather than on the
    surrogate id, which is the identity decision `childAddresses.ts` makes and nothing else checks.
  */
  const second = panel.locator('section').filter({ hasText: 'Second household' });
  await second.getByLabel('Street address').fill('9 Other Street');
  await second.getByLabel('Town or city').fill('Auckland');
  await second.getByRole('button', { name: 'Record' }).click();
  await expect(panel.locator('.error')).toHaveCount(0);
  await expect(panel.getByText('9 Other Street, Auckland')).toBeVisible();

  await second.getByRole('button', { name: 'Remove the second household' }).click();
  await expect(panel.locator('.error')).toHaveCount(0);
  await expect(panel.getByText('No second household recorded.')).toBeVisible();

  /*
    And the FORM emptied with it. The inputs are uncontrolled, so without a key tied to the row
    they keep what was last typed — a panel reading "No second household recorded" above a form
    still holding the address just deleted, which looks like the removal failed. Asserting the
    empty field is the only thing that catches that, because every other assertion here passes
    either way.
  */
  await expect(second.getByLabel('Street address')).toHaveValue('');

  // And removing the second did not take the first with it. The delete is keyed on the pair, so a
  // predicate that dropped `kind` would empty both rows and pass every assertion above.
  await expect(panel.getByText('12 Example Road, Mount Albert, Auckland, 1025')).toBeVisible();
});
