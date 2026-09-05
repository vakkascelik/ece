import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * Identity documents on the child record — `0097`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS SPEC EXISTS BECAUSE ITS ABSENCE IS WHAT WENT WRONG
 *
 * `0097` shipped on 2026-09-05 with four verb-split policies, a grant, an audit trigger and ninety
 * assertions in `rls_isolation.sql`. Nothing could write to it. The commit touched the migration,
 * the RLS suite and two documents, and the application answer for `AST28` was updated the same day
 * to say the identity path was built.
 *
 * **The RLS suite passing is not the same as the feature existing**, and it cannot be: the suite
 * writes its own rows with the service role, precisely so it can test a policy without an
 * application in the way. So it was green against a table with no reader, no writer and no screen.
 *
 * A browser is the only thing that can tell those two states apart, which is why this file is the
 * deliverable rather than an extra.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS WORTH A BROWSER HERE, AND IT IS NOT "THE INSERT WORKS"
 *
 * 1. **Sighted and unsighted are different claims**, as in `immunisation.spec.ts`. "We hold a note
 *    that a birth certificate exists" is not "somebody looked at it", and the schema stores the
 *    difference — so the screen has to keep it.
 * 2. **It is a list, not a slot.** Re-checking next year must add a row, not replace one. The
 *    address panel beside it is the opposite by design, and confusing the two is the bug this
 *    property catches.
 * 3. **The date is the centre's, not the server's.** `sighted_at` is a UTC instant and New Zealand
 *    is twelve or thirteen hours ahead, so a naive render shows yesterday all morning. The first
 *    draft of the panel did exactly that.
 * 4. **A guardian may read and may not write**, and is not shown a colleague's email address.
 */

/** Wait for the server action's POST rather than for a timeout. */
async function record(page: import('@playwright/test').Page) {
  const done = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/children'),
  );
  await page.getByRole('button', { name: 'Record document' }).click();
  await done;
}

test('a sighting records who and when, an unsighted entry stays distinguishable, and both survive', async ({
  page,
}) => {
  const t = tenant();
  await visit(page, `/children/${t.childId}/documents`);

  const panel = page.locator('section').filter({ hasText: 'Identity documents' }).last();
  await expect(panel.getByRole('heading', { name: 'Identity documents' })).toBeVisible();

  // Nothing yet. Asserted rather than assumed, because every later count depends on it and a
  // leftover row from an earlier run would make "two rows" mean nothing.
  await expect(panel.getByText('No identity document has been logged')).toBeVisible();

  // --- an entry that asserts nothing is refused --------------------------------
  // Not a database rule: 0097 permits every column to be null on purpose. This is the action's own
  // judgement, and it is asserted here so that "the form accepts anything" cannot creep back in.
  await record(page);
  await expect(panel.getByRole('alert')).toContainText('Record something');

  // --- sighted: somebody looked -------------------------------------------------
  await panel.getByLabel('Document type').fill('PASSPORT');
  await panel.getByLabel('I have seen this document').check();
  await record(page);

  const sighted = panel.getByRole('row').filter({ hasText: 'PASSPORT' });
  await expect(sighted).toHaveCount(1);
  // The person is the signed-in one and nobody else — the form cannot nominate a colleague.
  await expect(sighted).toContainText(t.ownerEmail);

  /*
    THE DATE IS THE CENTRE'S CALENDAR DAY, AND THIS IS ASSERTED TWO WAYS ON PURPOSE.

    Computed here the same way the page does — `Intl` in `Pacific/Auckland` — rather than from
    `new Date().toISOString()`, which is the very mistake being guarded against: for most of the
    New Zealand working day those two disagree by one day, and a test written the wrong way would
    have passed against the wrong render and failed against the right one.

    **The honest limit of the first assertion, stated because it would otherwise be overclaimed:**
    it kills a naive `sightedAt.slice(0, 10)` at any hour, but it does so on the *format* —
    "5 Sep 2026" against "2026-09-05". The *timezone* half only bites between New Zealand midnight
    and noon, when UTC is still on the previous date. A run at four in the afternoon cannot tell a
    correctly-zoned formatter from a UTC one that happens to agree today.

    So the second assertion is structural and holds at every hour: **no cell in this table may look
    like an ISO date.** Anything that does is a raw instant reaching the screen, which is the shape
    of the bug rather than one of its instances. Verified by mutation — reverting the page to the
    slice fails this test, and the run that first proved it was at 16:41 NZ, when the date halves
    agreed and only the shape did not.
  */
  const nzToday = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
  await expect(sighted).toContainText(nzToday);
  await expect(sighted).not.toContainText(/\d{4}-\d{2}-\d{2}/);

  // --- unsighted: recorded, and nobody has looked -------------------------------
  await panel.getByLabel('Document type').fill('BIRTHCE');
  await panel.getByLabel('Note').fill('Parent says it is at home');
  await record(page);

  const unsighted = panel.getByRole('row').filter({ hasText: 'BIRTHCE' });
  await expect(unsighted).toHaveCount(1);
  await expect(unsighted).toContainText('not sighted');
  await expect(unsighted).toContainText('Parent says it is at home');
  // And it carries no name, because nobody looked. The distinction the schema stores has to
  // survive to the screen or storing it was pointless.
  await expect(unsighted).not.toContainText(t.ownerEmail);

  // --- a list, not a slot --------------------------------------------------------
  // The second entry did not replace the first. This is the property that separates this table
  // from `child_addresses` next to it, where `(child_id, kind)` is the identity and a save
  // upserts.
  await expect(sighted).toHaveCount(1);
  await expect(panel.getByRole('row').filter({ hasText: /PASSPORT|BIRTHCE/ })).toHaveCount(2);

  // --- removable, and only the one asked for -------------------------------------
  await unsighted.getByRole('button', { name: 'Remove' }).click();
  await expect(panel.getByRole('row').filter({ hasText: 'BIRTHCE' })).toHaveCount(0);
  await expect(sighted).toHaveCount(1);
});

test('a guardian reads the sightings, cannot write one, and is not shown a colleague’s address', async ({
  browser,
}) => {
  const t = tenant();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/login');
  await page.getByLabel('Email').fill(t.parentEmail);
  await page.getByLabel('Password').fill(t.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');

  await page.goto(`/children/${t.childId}/documents`, { waitUntil: 'networkidle' });
  const panel = page.locator('section').filter({ hasText: 'Identity documents' }).last();

  // Readable. `0097`'s select policy is `caller_may_see_child`, and "the centre has seen my child's
  // passport" is a fact about their own record.
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('row').filter({ hasText: 'PASSPORT' })).toHaveCount(1);

  // Not writable — the insert policy is `caller_may_enrol`. A form here would invite a refusal.
  await expect(panel.getByRole('button', { name: 'Record document' })).toHaveCount(0);
  await expect(panel.getByLabel('Document type')).toHaveCount(0);

  /*
    AND NO STAFF EMAIL. The member list is loaded only for somebody who may record a sighting —
    the same decision the health tab makes about the witness picker, in its own words: "a guardian
    has no business enumerating the staff list". A parent sees that a document was sighted and when,
    without being handed an employee's address.
  */
  await expect(panel).not.toContainText(t.ownerEmail);
  await expect(panel.getByRole('row').filter({ hasText: 'PASSPORT' })).toContainText('not shown');

  await ctx.close();
});
