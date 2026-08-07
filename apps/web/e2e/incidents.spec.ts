import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * Amending a finalised report — the only way to change one.
 *
 * 0030's trigger refuses an edit once a report is final, and `test:rls` proves that.
 * What it cannot prove is that the product offers a way through: a freeze with no
 * amendment path is not a safety property, it is a dead end that gets worked around
 * with a second report nobody links to the first.
 *
 * The property that matters here is what happens to the ORIGINAL. It stays on the
 * register, marked, and stops being chased. Deleting it or hiding it would undo the
 * point of having frozen it — the version a family was actually sent is the one a
 * review asks about.
 */

async function submit(page: import('@playwright/test').Page, name: string | RegExp) {
  const done = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/incidents' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name }).click();
  await done;
}

test('a finalised report is amended by a new one, and the original stays and stops being chased', async ({
  page,
}) => {
  const t = tenant();
  await visit(page, '/incidents');

  // --- an original, taken all the way to final ---------------------------------
  await page.getByRole('button', { name: 'Record an incident' }).click();

  /*
    Selected by the option's value, not by its label. `t.childName` is the first name
    alone ('Tāne') and the option reads 'Tāne Audit-<tag>', so `{ label }` — which is
    an exact match — silently waits until the test times out. Indexing would work
    today and break the moment `journey.spec.ts` enrols its child before this runs.
  */
  const childSelect = page.getByLabel('Child');
  const value = await childSelect
    .locator('option', { hasText: t.childName })
    .first()
    .getAttribute('value');
  await childSelect.selectOption(value!);
  await page.getByLabel('What happened').fill('Grazed knee on the path.');
  await submit(page, 'Save as draft');

  const original = page.getByRole('row', { name: /Grazed knee/ });
  await expect(original).toBeVisible();
  await expect(original.getByText(/whānau cannot see this/)).toBeVisible();

  await submit(page, 'Finalise');
  await expect(page.getByRole('row', { name: /Grazed knee/ }).getByText(/not told yet/)).toBeVisible();

  // --- amend it ----------------------------------------------------------------
  await page.getByRole('row', { name: /Grazed knee/ }).getByRole('link', { name: 'Amend' }).click();
  await page.waitForURL(/[?&]amend=/);

  // The form opens already filled from the original — an amendment is a whole report,
  // not a patch, because the family reads it on its own.
  await expect(page.getByRole('heading', { name: 'Amend a report' })).toBeVisible();
  await expect(page.getByLabel('What happened')).toHaveValue('Grazed knee on the path.');

  await page.getByLabel('What happened').fill('Bruised knee, not a graze. Ice applied.');
  await submit(page, 'Save amendment as draft');

  // --- both rows exist, and only one of them is anybody's problem ---------------
  const amendment = page.getByRole('row', { name: /Bruised knee/ });
  await expect(amendment).toBeVisible();
  await expect(amendment.getByText('Replaces an earlier report')).toBeVisible();

  const stillThere = page.getByRole('row', { name: /Grazed knee/ });
  await expect(stillThere).toBeVisible();
  await expect(stillThere.getByText('Replaced by a later report')).toBeVisible();

  /*
    The original was final and never sent. Before `summariseIncidents` learned about
    supersession it stayed in "whānau not told" forever — chasing a document that had
    been replaced. The count now reflects the amendment only, which is the draft.
  */
  await expect(page.getByText(/whānau not told/)).toHaveCount(0);
  await expect(page.getByText(/1 draft/)).toBeVisible();

  // And a replaced report cannot be amended again: two live corrections of one
  // original leaves nobody able to say which the family holds.
  await expect(stillThere.getByRole('link', { name: 'Amend' })).toHaveCount(0);
});

test('a draft is corrected in place, without becoming a replaced report', async ({ page }) => {
  const t = tenant();
  await visit(page, '/incidents');

  await page.getByRole('button', { name: 'Record an incident' }).click();
  const childSelect = page.getByLabel('Child');
  const value = await childSelect
    .locator('option', { hasText: t.childName })
    .first()
    .getAttribute('value');
  await childSelect.selectOption(value!);
  await page.getByLabel('What happened').fill('Tripped on teh mat.');
  await submit(page, 'Save as draft');

  await page.getByRole('row', { name: /Tripped on teh mat/ }).getByRole('link', { name: 'Edit' }).click();
  await page.waitForURL(/[?&]edit=/);

  await expect(page.getByRole('heading', { name: 'Correct this draft' })).toBeVisible();
  await page.getByLabel('What happened').fill('Tripped on the mat.');
  await submit(page, 'Save correction');

  /*
    One row, corrected. The point of having an edit path at all: without it a typo in
    an unsent draft could only be fixed by finalising and amending, which marks the
    original as replaced forever for something nobody outside the centre ever read.
  */
  const corrected = page.getByRole('row', { name: /Tripped on the mat/ });
  await expect(corrected).toBeVisible();
  await expect(page.getByRole('row', { name: /Tripped on teh mat/ })).toHaveCount(0);
  // Scoped to this row, not the page: the amendment test above deliberately leaves a
  // superseded report behind, and these tests share one tenant.
  await expect(corrected.getByText('Replaced by a later report')).toHaveCount(0);
  await expect(corrected.getByText('Replaces an earlier report')).toHaveCount(0);

  // Still a draft. Correcting is not finalising, and the family still cannot see it.
  await expect(
    page.getByRole('row', { name: /Tripped on the mat/ }).getByText(/whānau cannot see this/),
  ).toBeVisible();
});

test('a final report offers no Edit, and a draft offers no Amend', async ({ page }) => {
  const t = tenant();
  await visit(page, '/incidents');

  await page.getByRole('button', { name: 'Record an incident' }).click();
  const childSelect = page.getByLabel('Child');
  const value = await childSelect
    .locator('option', { hasText: t.childName })
    .first()
    .getAttribute('value');
  await childSelect.selectOption(value!);
  await page.getByLabel('What happened').fill('Bumped elbow on the door.');
  await submit(page, 'Save as draft');

  const row = () => page.getByRole('row', { name: /Bumped elbow/ });
  // A draft: editable, not amendable.
  await expect(row().getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(row().getByRole('link', { name: 'Amend' })).toHaveCount(0);

  await page.getByRole('row', { name: /Bumped elbow/ }).getByRole('button', { name: 'Finalise' }).click();
  await expect(row().getByRole('link', { name: 'Amend' })).toBeVisible();
  // Final: amendable, not editable. 0030's trigger refuses an edit, so offering the
  // control would be offering a button that fails.
  await expect(row().getByRole('link', { name: 'Edit' })).toHaveCount(0);
});

test('an amend link naming an unknown report opens an ordinary new one', async ({ page }) => {
  // The safe direction, and it means the query parameter cannot be used to confirm
  // that an incident exists somewhere this caller cannot see.
  await visit(page, '/incidents?amend=00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Amend a report' })).toHaveCount(0);
});
