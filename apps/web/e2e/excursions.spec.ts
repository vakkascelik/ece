import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * The outing loop: plan, chase consent, depart, count, return.
 *
 * The property worth a browser is the refusal's WORDING. `test:rls` proves the
 * trigger blocks departure; what it cannot prove is that the person at the gate is
 * told which of two very different problems they have — families who have not
 * answered (a phone call) versus a family who said no (a child who stays behind).
 * The trigger reports a count on purpose; the screen owes them the split.
 */

async function post(page: import('@playwright/test').Page, name: string | RegExp) {
  const done = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/excursions'),
  );
  await page.getByRole('button', { name }).click();
  await done;
}

test('an outing cannot leave until every family has answered yes, and the refusal says why', async ({
  page,
}) => {
  const t = tenant();

  // --- plan ------------------------------------------------------------------
  await visit(page, '/excursions');
  await page.getByRole('button', { name: 'Plan an outing' }).click();
  await page.getByLabel('Where to').fill('Western Springs playground');
  await post(page, 'Plan outing');

  await page.getByRole('link', { name: 'Western Springs playground' }).click();
  await page.waitForURL(/\/excursions\/[0-9a-f-]+/);

  // --- add a child; their consent state is "not answered", which is a chase ----
  const addSelect = page.getByLabel('Add a child');
  const value = await addSelect
    .locator('option', { hasText: t.childName })
    .first()
    .getAttribute('value');
  await addSelect.selectOption(value!);
  await post(page, 'Add');

  const row = page.getByRole('row', { name: new RegExp(t.childName) });
  await expect(row.getByText(/Not answered — chase/)).toBeVisible();

  // --- departing now is refused, and the sentence names the phone call ---------
  await post(page, 'Depart');
  await expect(page.getByText(/cannot leave/)).toBeVisible();
  await expect(page.getByText(/not answered — that is a phone call/)).toBeVisible();

  // --- record the guardian's yes, then depart ---------------------------------
  await row.getByRole('button', { name: 'Record their answer' }).click();
  // Only this child's guardians are offered — never the centre-wide list.
  await row.getByLabel('Whose decision').selectOption({ index: 1 });
  await row.getByRole('radio', { name: 'Yes' }).check();
  await post(page, 'Record');
  await expect(row.getByText(/Consent given/)).toBeVisible();

  await post(page, 'Depart');
  await expect(page.getByText(/Off site|Back at the centre/).first()).toBeVisible();

  // --- a short count is recorded and shouted, not refused ----------------------
  await page.getByLabel('Counted', { exact: true }).fill('0');
  await post(page, 'Record count');
  await expect(page.getByText(/Last count SHORT/)).toBeVisible();

  // A recount clears it: the latest count is the state.
  await page.getByLabel('Counted', { exact: true }).fill('1');
  await post(page, 'Record count');
  await expect(page.getByText(/Last count 1 of 1/)).toBeVisible();
  // Both counts stay in the log — the short one is the record that matters.
  await expect(page.getByText(/0 of 1/)).toBeVisible();

  // --- home ---------------------------------------------------------------------
  await post(page, 'Back at the centre');
  await expect(page.getByText('Returned')).toBeVisible();
});
