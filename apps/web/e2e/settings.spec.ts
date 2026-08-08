import { expect, test } from '@playwright/test';
import { visit } from './fixtures/audit';

/**
 * Click Save and wait for the server action to actually finish.
 *
 * `click()` returns as soon as the event is dispatched. A reload straight after it
 * races the POST, and the race is not even close to fair: the page comes back with
 * the OLD value and the failure reads as 'nothing was saved'. Two tests here chased
 * that for a while before the next test in the file read back the value the previous
 * one had in fact written.
 */
async function save(page: import('@playwright/test').Page) {
  const done = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/settings' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await done;
}

/**
 * The two practice settings, and the distinction the whole sleep register rests on.
 *
 * Blank is **null**, not zero. Null means the centre has stated no interval, and the
 * register then shows elapsed time without judging it; zero would make every child
 * permanently overdue and is refused by the CHECK in 0033. Those are three different
 * states — a number, none stated, and invalid — and a form that collapsed the middle
 * one into `0` would turn "we have not decided" into "everything is late".
 *
 * Worth a browser because the round trip is where the collapse would happen: the
 * database keeps null and zero apart perfectly well, and an empty `<input>` submits
 * `''`, which `Number('')` turns into `0` without complaint.
 */
test('a sleep-check interval saves, and clearing it stores nothing rather than zero', async ({
  page,
}) => {
  await visit(page, '/settings');

  const interval = page.getByLabel('Minutes between sleep checks');
  const witness = page.getByLabel('Require a second person to witness every dose of medicine');

  // Starts unset — no default is assumed anywhere, which is the product decision.
  await expect(interval).toHaveValue('');
  await expect(witness).not.toBeChecked();

  await interval.fill('10');
  await witness.check();
  await save(page);

  // Before reloading: nothing was refused. Without this the reload wipes any error
  // message and the failure below reads as "the value did not persist" when the real
  // answer was "the save was refused and said so".
  await expect(page.locator('.error')).toHaveCount(0);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Minutes between sleep checks')).toHaveValue('10');
  await expect(
    page.getByLabel('Require a second person to witness every dose of medicine'),
  ).toBeChecked();

  // Clearing it must return the centre to "has stated none". Rendered blank, not "0".
  await page.getByLabel('Minutes between sleep checks').fill('');
  await page.getByLabel('Require a second person to witness every dose of medicine').uncheck();
  await save(page);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Minutes between sleep checks')).toHaveValue('');
  await expect(
    page.getByLabel('Require a second person to witness every dose of medicine'),
  ).not.toBeChecked();
});

test('the ratio source can be switched, and the change is stated as consequential', async ({
  page,
}) => {
  await visit(page, '/settings');

  const source = page.getByLabel('Where the adult count comes from');
  // Defaults to declared so no existing centre's history changes meaning on deploy.
  await expect(source).toHaveValue('declared');
  // The one setting here that changes what an existing record MEANS, and the screen
  // has to say so — including the part that looks like a bug and is not.
  await expect(page.getByText(/reads zero adults and shows a breach/)).toBeVisible();

  await source.selectOption('derived');
  await save(page);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Where the adult count comes from')).toHaveValue('derived');

  await page.getByLabel('Where the adult count comes from').selectOption('declared');
  await save(page);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Where the adult count comes from')).toHaveValue('declared');
});

test('a nonsensical interval never reaches the database', async ({ page }) => {
  await visit(page, '/settings');

  /*
    THREE GUARDS, AND THIS ONE ONLY REACHES THE FIRST.

    `min={1} max={120}` on a `type="number"` input, whose implicit `step` is 1, means
    the browser refuses to submit `0`, `121` or `1.5` at all. So the server-side
    "whole number between 1 and 120" branch and the `centres_sleep_interval_sane`
    CHECK behind it are both unreachable *through this form* — they are there for a
    caller that is not this form, which is the right place for them and the wrong
    thing to write a UI test against.

    Two earlier versions of this test asserted the server's sentence, once with `0`
    and once with `1.5`, and both failed for the same reason: the submission never
    happened. A test that names a guard it cannot reach is worse than no test — it
    reports the guard as covered.

    So this asserts what is actually true at this layer: the value does not save, and
    the field says why.
  */
  const interval = page.getByLabel('Minutes between sleep checks');
  await interval.fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  // No `save()` here on purpose: the browser blocks the submission, so there is no
  // POST to wait for. Waiting for one would hang until the test timed out.

  await expect(interval).toHaveJSProperty('validity.valid', false);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Minutes between sleep checks')).toHaveValue('');
});
