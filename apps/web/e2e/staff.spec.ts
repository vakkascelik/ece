import { expect, test } from '@playwright/test';
import { visit } from './fixtures/audit';

/**
 * The staff roster, per-person sign-in, and the link the schema refuses to guess.
 *
 * Two properties worth a browser.
 *
 * A person with **no login** can be added and signed in. That is not an edge case —
 * it is the reliever, the contractor and the cook, and it is the reason 0038 exists
 * as a table separate from `memberships`. A roster that required an account would
 * push exactly the adults whose presence the ratio most needs back onto paper.
 *
 * And the **certificated count reports what it cannot see**. 0038 leaves every
 * `staff_records` link null on purpose, so an unlinked centre reads as zero
 * certificated staff while holding a folder of certificates. If the screen shows the
 * count without the unlinked warning, the count is a lie by omission.
 */

async function post(page: import('@playwright/test').Page, name: string | RegExp) {
  const done = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/staff'),
  );
  await page.getByRole('button', { name }).click();
  await done;
}

test('somebody with no login is added, signed in, and signed out again', async ({ page }) => {
  await visit(page, '/staff');

  await page.getByRole('button', { name: 'Add somebody' }).click();
  await page.getByLabel('Name').fill('Sam Reliever');
  await page.getByLabel('Role (optional)').fill('Reliever, Tuesdays');
  await post(page, 'Add to roster');

  const row = page.getByRole('row', { name: /Sam Reliever/ });
  await expect(row).toBeVisible();
  // Said plainly rather than left blank — a row with nothing in it reads as broken.
  await expect(row.getByText('No app account')).toBeVisible();
  await expect(row.getByText(/Not signed in/)).toBeVisible();

  await row.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('row', { name: /Sam Reliever/ }).getByText(/Signed in/)).toBeVisible();

  await page
    .getByRole('row', { name: /Sam Reliever/ })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(
    page.getByRole('row', { name: /Sam Reliever/ }).getByText(/Not signed in/),
  ).toBeVisible();
});

test('the certificated count says what it cannot see', async ({ page }) => {
  const centre = 'Audit';
  await visit(page, '/staff');

  /*
    The audit tenant seeds a practising certificate through `staff_records` and no
    `staff_members` row is linked to it, which is exactly the state every centre
    starts in. The count must therefore read zero AND say why — a bare "0 of N" would
    have a manager chasing certificates that are sitting in the folder.
  */
  await expect(page.getByText(/hold a current practising certificate/)).toBeVisible();
  await expect(page.getByText(/not linked to anybody/)).toBeVisible();

  // And it must not draw a conclusion from the number. No percentage, no funding
  // band: this repo has not read the funding handbook.
  await expect(page.getByText(/%/)).toHaveCount(0);
  await expect(page.getByText(/funding band/i)).toHaveCount(0);
  void centre;
});

test('a record is linked to a person by hand, and can be unlinked again', async ({ page }) => {
  // Add somebody to link to first — the roster starts empty.
  await visit(page, '/staff');
  await page.getByRole('button', { name: 'Add somebody' }).click();
  await page.getByLabel('Name').fill('Alex Kaiako');
  await post(page, 'Add to roster');

  await visit(page, '/compliance');
  const row = page.getByRole('row').filter({ has: page.getByRole('combobox') }).first();
  await expect(row).toBeVisible();

  // Nothing is preselected. A default of "the closest name" is the same guess 0038
  // refuses to make, wearing a different hat.
  const select = row.getByRole('combobox');
  await expect(select).toHaveValue('');

  await select.selectOption({ label: 'Alex Kaiako' });
  const linked = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/compliance'),
  );
  await row.getByRole('button', { name: 'Link' }).click();
  await linked;

  await page.reload({ waitUntil: 'networkidle' });
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('combobox') }).first().getByRole('combobox'),
  ).not.toHaveValue('');
});
