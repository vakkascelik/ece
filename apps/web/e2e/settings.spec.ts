import { expect, test, type Page } from '@playwright/test';
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
  await practiceSave(page).click();
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
  await practiceSave(page).click();
  // No `save()` here on purpose: the browser blocks the submission, so there is no
  // POST to wait for. Waiting for one would hang until the test timed out.

  await expect(interval).toHaveJSProperty('validity.valid', false);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Minutes between sleep checks')).toHaveValue('');
});

/**
 * The save button on the Daily practice card.
 *
 * Settings became one form per section on 2026-08-11, so there are three buttons named
 * "Save" and an unscoped locator is a strict-mode violation. Every assertion in this file is
 * about a daily-practice field — the sleep interval, the drill interval, the ratio source —
 * so they all press this one. Scoping by the card's heading rather than by position, because
 * the order of the cards is a layout decision and this is not a test about layout.
 */
const practiceSave = (page: Page) =>
  page.locator('form').filter({ hasText: 'Daily practice' }).getByRole('button', { name: 'Save' });

const detailsCard = (page: Page) => page.locator('form').filter({ hasText: 'Centre details' });
const detailsSave = (page: Page) => detailsCard(page).getByRole('button', { name: 'Save' });

/**
 * 0083 — the licence type and service model save, and this test exists for the GRANT.
 *
 * `centres` carries **column-scoped** UPDATE grants, not a table-wide one, and
 * `updateCentre` builds one statement from every changed field. So a column added without
 * being added to that grant does not break its own feature — it breaks the whole card,
 * with `42501 permission denied for table centres`, which names the table and not the
 * column. That is 0047, fixed by 0048; then 0066 did it again on `incidents.room_id` and
 * no incident draft could be corrected for six days until 0082.
 *
 * WHY THE ASSERTION BEFORE THE RELOAD IS THE POINT OF THE TEST.
 *
 * A test that only reloads and reads the value back cannot tell a refusal from a write
 * that never happened — both look like the old value coming back. `expect(error).toHaveCount(0)`
 * BEFORE reloading is the only assertion here that distinguishes them, and its absence from
 * `incidents.spec.ts` is exactly why 0066 survived six days of green runs.
 *
 * The RLS suite also asserts the grant at the catalogue level. Both are wanted: that one
 * proves the privilege exists, this one proves the form that needs it works.
 */
test('the licence type and service model save, which proves the column grant', async ({
  page,
}) => {
  await visit(page, '/settings');

  const licence = page.getByLabel('Licence type');
  const model = page.getByLabel('How this service operates');

  // Not stated is the default and a real answer — nothing guesses a licence, because a
  // guess at the service model would select a ratio schedule.
  await expect(licence).toHaveValue('');
  await expect(model).toHaveValue('');

  await licence.selectOption('education_and_care');
  await model.selectOption('all_day');

  const done = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/settings' && r.request().method() === 'POST',
  );
  await detailsSave(page).click();
  await done;

  // THE ASSERTION THAT MATTERS. A missing column grant surfaces here, before any reload.
  await expect(detailsCard(page).locator('.error')).toHaveCount(0);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Licence type')).toHaveValue('education_and_care');
  await expect(page.getByLabel('How this service operates')).toHaveValue('all_day');

  // And back to not stated, because null has to be reachable from the form — a column
  // whose "not stated" cannot be restored is a column that silently becomes mandatory.
  await page.getByLabel('Licence type').selectOption('');
  await page.getByLabel('How this service operates').selectOption('');
  const undone = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/settings' && r.request().method() === 'POST',
  );
  await detailsSave(page).click();
  await undone;
  await expect(detailsCard(page).locator('.error')).toHaveCount(0);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Licence type')).toHaveValue('');
  await expect(page.getByLabel('How this service operates')).toHaveValue('');
});

/**
 * Service closures — `0088`.
 *
 * The migration shipped with no reader or writer, so this is the first proof the whole path
 * works: form → server action → `caller_has_role` → the GiST exclusion → read back.
 *
 * FIXED DATES IN 2029, not dates relative to today, and for two reasons. The exclusion
 * constraint is per centre and this suite shares a tenant with the other specs, so a closure
 * placed on "today" would collide with anything else that recorded one. And an assertion built
 * on `new Date()` is only true for half the day when the suite runs in UTC and the product
 * judges in the centre's zone — which cost a run earlier the same day this was written.
 */
test('a closure is recorded, an open one blocks the next, and reopening closes it off', async ({
  page,
}) => {
  await visit(page, '/settings');

  const closures = page.locator('section.card').filter({ hasText: 'Closed days' });
  await expect(closures.getByText('No closures recorded.')).toBeVisible();

  await closures.getByRole('button', { name: 'Record a closure' }).click();
  /*
    `exact: true` on the end date, and it is not decoration. Once an open-ended closure exists
    its row carries an input labelled "Last closed day for the closure starting 2029-09-01",
    and accessible-name matching is SUBSTRING by default — so the unqualified locator resolves
    to two elements and the fill fails on strict mode. The same near-miss the schedule panel
    hit with "Day" against "Days attending", and it only bites after the open closure is
    recorded, which is why the first two fills were fine and the fourth was not.
  */
  await closures.getByLabel('First closed day').fill('2029-07-06');
  await closures.getByLabel('Last closed day', { exact: true }).fill('2029-07-17');
  await closures.getByLabel('Reason', { exact: true }).fill('July term break');
  await closures.getByRole('button', { name: 'Record', exact: true }).click();

  // Before any reload: a refused write and one that did not persist look identical after.
  await expect(closures.locator('.error')).toHaveCount(0);
  await expect(closures.getByRole('cell', { name: '2029-07-06' })).toBeVisible();
  await expect(closures.getByText('July term break')).toBeVisible();

  /*
    THE OVERLAP MESSAGE, which is the assertion this screen most needs. A bare `23P01` reads
    "conflicting key value violates exclusion constraint" and sends somebody hunting for a
    duplicate that does not exist. One day of overlap is enough to trigger it.
  */
  await closures.getByRole('button', { name: 'Record a closure' }).click();
  await closures.getByLabel('First closed day').fill('2029-07-17');
  await closures.getByLabel('Last closed day', { exact: true }).fill('2029-07-20');
  await closures.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(closures.getByText(/overlap a closure already recorded/)).toBeVisible();

  /*
    A CLOSURE WITH NO END DATE — the flood case. It is a real answer rather than a missing
    one, and the screen has to say so in a word rather than leaving the cell blank, because
    the next person to record a closure will collide with it and needs to know why.
  */
  await closures.getByLabel('First closed day').fill('2029-09-01');
  await closures.getByLabel('Last closed day', { exact: true }).fill('');
  await closures.getByLabel('Reason', { exact: true }).fill('Flood');
  await closures.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(closures.locator('.error')).toHaveCount(0);
  await expect(closures.locator('span.flag').filter({ hasText: 'no end date' })).toBeVisible();

  // And it covers every later date, so a closure after it collides. This is the infinity
  // semantics of a null end, asserted through the screen rather than only in SQL.
  await closures.getByRole('button', { name: 'Record a closure' }).click();
  await closures.getByLabel('First closed day').fill('2029-11-01');
  await closures.getByLabel('Last closed day', { exact: true }).fill('2029-11-05');
  await closures.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(closures.getByText(/overlap a closure already recorded/)).toBeVisible();

  /*
    Dismiss the form, which also dismisses its error — that is the whole reason the add error
    lives inside it. A merged error slot would keep showing this sentence after the next
    gesture succeeded, which is what the assertion below would then be reporting rather than
    anything about reopening.
  */
  await closures.getByRole('button', { name: 'Cancel' }).click();
  await expect(closures.getByText(/overlap a closure already recorded/)).toHaveCount(0);

  /*
    Reopening closes it off. The gesture this exists for is exactly this: shut with no known
    end, and three weeks later the centre reopens. Deleting and re-entering would lose the
    audit row saying when the original was made.
  */
  await closures.getByLabel(/Last closed day for the closure starting 2029-09-01/).fill('2029-09-20');
  await closures.getByRole('button', { name: 'Reopened' }).click();
  await expect(closures.locator('.error')).toHaveCount(0);
  await expect(closures.locator('span.flag').filter({ hasText: 'no end date' })).toHaveCount(0);
  await expect(closures.getByRole('cell', { name: '2029-09-20' })).toBeVisible();

  // Tidy up after itself: the exclusion constraint is per centre and this suite shares a
  // tenant, so leaving 2029 closed would collide with any later test that records one.
  for (const from of ['2029-09-01', '2029-07-06']) {
    const row = closures.locator('tr').filter({ hasText: from });
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(closures.locator('.error')).toHaveCount(0);
  }
  await expect(closures.getByText('No closures recorded.')).toBeVisible();
});
