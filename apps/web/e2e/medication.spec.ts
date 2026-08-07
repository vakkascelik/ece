import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * Recording that a medicine was given — and the one bug in it worth a browser.
 *
 * WHY THIS IS NOT COVERED BY `test:rls`
 *
 * The suite proves the *database* contract: an insert inside the authorised window
 * is accepted, one outside is refused, and a replayed `client_uuid` is silently
 * treated as already-landed. All correct, and none of it exercises the half that
 * decides which `client_uuid` the browser sends.
 *
 * That is where the dangerous bug lives. `ON CONFLICT DO NOTHING` means a repeated
 * key is discarded *and reported as success*, so a component that mints the key once
 * at mount would discard the 2pm dose as a duplicate of the 10am one and tell the
 * person it worked. A silently dropped medication record is far worse than a
 * duplicated one, which is visible and correctable — and it is invisible to every
 * other check in this repo, because at the database both statements look identical.
 *
 * So this gives the same medicine twice and asserts two entries appear. Assert one
 * and the test passes with the bug present.
 */
test('a second dose of the same medicine is recorded, not swallowed as a duplicate', async ({
  page,
}) => {
  const t = tenant();
  await visit(page, `/children/${t.childId}`);

  const row = page.getByRole('row', { name: /Adrenaline auto-injector/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('none today')).toBeVisible();

  /*
    Counted as list items, not by matching the dose text. The authority's own "Dose"
    column reads "150 mcg" too, so `getByText(/150 mcg/)` matches the permission as
    well as the administration — which is precisely the conflation this whole table
    exists to undo, and it made the first version of this test ambiguous.
  */
  const given = row.getByRole('listitem');

  await row.getByRole('button', { name: 'Record a dose' }).click();
  // Prefilled from the authority and editable: half a dose because the child spat it
  // out is the entry a reviewer most wants to find.
  await expect(page.getByLabel('Dose actually given')).toHaveValue('150 mcg');
  await page.getByRole('button', { name: 'Record dose' }).click();

  await expect(given).toHaveCount(1);

  // Again. Same medicine, same authority, same page — a new key must be minted.
  await row.getByRole('button', { name: 'Record a dose' }).click();
  await page.getByLabel('Dose actually given').fill('75 mcg');
  await page.getByRole('button', { name: 'Record dose' }).click();

  // Two, not one. One is what a component that minted its key at mount would show.
  await expect(given).toHaveCount(2);
  await expect(given.filter({ hasText: '150 mcg' })).toHaveCount(1);
  await expect(given.filter({ hasText: '75 mcg' })).toHaveCount(1);
});

/**
 * A parent reads the register and cannot write to it.
 *
 * The policy is what enforces this — `medication_admin_write_insert` requires staff
 * for the child — so the assertion is that the control is not *offered*, which is the
 * part RLS cannot check. A button that fails on submit is a support call.
 */
test('a parent sees what was given and is offered no way to record it', async ({ browser }) => {
  const t = tenant();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/login');
  await page.getByLabel('Email').fill(t.parentEmail);
  await page.getByLabel('Password').fill(t.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');

  await page.goto(`/children/${t.childId}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Adrenaline auto-injector')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record a dose' })).toHaveCount(0);

  await ctx.close();
});
