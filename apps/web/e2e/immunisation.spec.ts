import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * Immunisation on the child record.
 *
 * Two properties worth a browser, and neither is "the write works" — `test:rls`
 * covers that.
 *
 * The first is **supersession**: recording an update must not overwrite the earlier
 * record, because "were they up to date at enrolment" is a different question from
 * "are they now" and only the history answers both.
 *
 * The second is **sighting as a separate claim**. "The family told us" and "somebody
 * looked at the certificate" are different, and the screen has to keep them apart or
 * the distinction the schema went to the trouble of storing is lost on the way out.
 */

async function save(page: import('@playwright/test').Page) {
  const done = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/children'),
  );
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await done;
}

test('an update supersedes rather than overwrites, and sighting is its own claim', async ({
  page,
}) => {
  const t = tenant();
  await visit(page, `/children/${t.childId}`);

  const panel = page.locator('section.card').filter({ hasText: 'Immunisation' });
  await expect(panel).toBeVisible();

  // --- first record, unsighted: told, not seen --------------------------------
  await panel.getByRole('button', { name: 'Record what we were shown' }).click();
  await panel.getByLabel('What you were shown').selectOption('not_up_to_date');
  await save(page);

  // Scoped to the status chip with an anchored regex: getByText does substring
  // matching, so 'Up to date' also matches 'Not up to date' and the select option.
  await expect(panel.locator('.flag', { hasText: /^Not up to date$/ })).toBeVisible();
  // The distinction the schema stores must survive to the screen.
  await expect(panel.getByText(/Not sighted/)).toBeVisible();

  // --- an update, this time with the document in hand -------------------------
  await panel.getByRole('button', { name: 'Record an update' }).click();
  await panel.getByLabel('What you were shown').selectOption('up_to_date');
  await panel.getByLabel('I looked at the document myself').check();
  await panel.getByLabel('What you saw (optional)').fill('Well Child book');
  await save(page);

  await expect(panel.locator('.flag', { hasText: /^Up to date$/ })).toBeVisible();
  await expect(panel.getByText(/Document seen/)).toBeVisible();
  await expect(panel.getByText('Well Child book')).toBeVisible();

  // --- the earlier record is still there ---------------------------------------
  // Superseded, not overwritten: the enrolment-time position is still answerable.
  await expect(panel.getByRole('heading', { name: 'Earlier records' })).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Not up to date' })).toHaveCount(1);
});

test('a parent reads their child’s record and is offered no way to write it', async ({
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

  await page.goto(`/children/${t.childId}`, { waitUntil: 'networkidle' });
  const panel = page.locator('section.card').filter({ hasText: 'Immunisation' });

  // Readable: a family is entitled to see what the centre recorded about their child.
  await expect(panel).toBeVisible();
  // Not writable: the centre records what it saw, and letting a parent write it would
  // make `sighted_by` meaningless.
  await expect(panel.getByRole('button', { name: /Record/ })).toHaveCount(0);

  await ctx.close();
});
