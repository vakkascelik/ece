import { expect, test, type Page } from '@playwright/test';
import { visit } from './fixtures/audit';

/**
 * The planned roster, and the three things about it a browser can prove that the unit
 * tests cannot.
 *
 * `forecastDay` is tested to death in `@ece/core` — the arithmetic needs no browser.
 * What needs one is the wiring:
 *
 * 1. **The overlap refusal reaches the person who caused it as a sentence.** Postgres
 *    says `violates exclusion constraint "shifts_no_overlap"`, which is true and
 *    useless. Rostering the same person twice is an ordinary slip, so it is the error
 *    a manager will actually hit.
 * 2. **Recording leave visibly stops counting a rostered adult.** The shift stays on
 *    the roster — a manager needs to see what needs covering — and the forecast has
 *    already subtracted them. If the badge is missing, the two halves silently
 *    disagree.
 * 3. **Cancelling frees the hours.** The exclusion constraint excludes cancelled rows
 *    precisely so the replacement can be booked, and that is the whole point of
 *    cancelling rather than deleting.
 */

async function post(page: Page, name: string | RegExp, path = '/roster') {
  const done = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith(path),
  );
  await page.getByRole('button', { name }).click();
  await done;
}

/**
 * The first day card, which is today by construction.
 *
 * Scoped to `section.card` deliberately. The page's other cards — the summary at the
 * top and the leave list at the bottom — are `div.card`, so this cannot drift onto one
 * of them the way `getByRole('table').first()` once drifted onto the day log.
 */
const firstDay = (page: Page) => page.locator('section.card').first();

async function addPerson(page: Page, name: string) {
  await visit(page, '/staff');
  await page.getByRole('button', { name: 'Add somebody' }).click();
  await page.getByLabel('Name').fill(name);
  await post(page, 'Add to roster', '/staff');
}

async function rosterOn(page: Page, name: string, from: string, to: string) {
  const day = firstDay(page);
  await day.getByRole('button', { name: 'Roster somebody' }).click();
  await day.getByLabel('Who').selectOption({ label: name });
  await day.getByLabel('From').fill(from);
  await day.getByLabel('To').fill(to);
  await post(page, 'Add shift');
}

test('a double-booked person is refused in words, and cancelling frees the hours', async ({
  page,
}) => {
  await addPerson(page, 'Pat Rostered');
  await visit(page, '/roster');

  await rosterOn(page, 'Pat Rostered', '08:00', '16:00');
  await expect(firstDay(page).getByText('08:00–16:00')).toBeVisible();

  // The refusal, as a sentence rather than a constraint name.
  await rosterOn(page, 'Pat Rostered', '12:00', '18:00');
  await expect(
    firstDay(page).getByText(/already rostered over some of those hours/),
  ).toBeVisible();

  // A shift starting exactly when another ends is a handover, not a clash. The `[)`
  // bound in 0041 and in `forecastDay` agree on this, and the product has to as well.
  await page.reload({ waitUntil: 'networkidle' });
  await rosterOn(page, 'Pat Rostered', '16:00', '18:00');
  await expect(firstDay(page).getByText('16:00–18:00')).toBeVisible();

  // Cancel the 8-till-4, then book the replacement over the same hours. The exclusion
  // constraint excludes cancelled rows exactly so this works.
  const original = firstDay(page).getByRole('listitem').filter({ hasText: '08:00–16:00' });
  const cancelled = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/roster'),
  );
  await original.getByRole('button', { name: 'Cancel' }).click();
  await cancelled;
  await expect(firstDay(page).getByText('Cancelled')).toBeVisible();

  await rosterOn(page, 'Pat Rostered', '09:00', '15:00');
  await expect(firstDay(page).getByText('09:00–15:00')).toBeVisible();
});

test('leave takes a rostered adult out of the forecast, and says so on the shift', async ({
  page,
}) => {
  await addPerson(page, 'Robin Away');
  await visit(page, '/roster');

  await rosterOn(page, 'Robin Away', '08:00', '16:00');
  const shift = firstDay(page).getByRole('listitem').filter({ hasText: 'Robin Away' });
  await expect(shift).toBeVisible();
  await expect(shift.getByText(/On leave/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Record leave' }).click();
  await page.getByLabel('Who').selectOption({ label: 'Robin Away' });
  await post(page, /^Record leave$/);

  // The shift is still on the roster — that is what needs covering — and it is marked
  // as not counted. Both halves, or the page contradicts its own forecast.
  const after = firstDay(page).getByRole('listitem').filter({ hasText: 'Robin Away' });
  await expect(after).toBeVisible();
  await expect(after.getByText(/On leave — not counted/)).toBeVisible();

  await expect(page.getByRole('row', { name: /Robin Away/ })).toBeVisible();
});

test('the forecast never claims the ratio tables have been checked', async ({ page }) => {
  await visit(page, '/roster');

  /*
    A forward-looking figure is the one a manager acts on by NOT calling a reliever,
    which makes it the last surface that should imply Schedule 2 has been verified.
    RATIO_TABLES_VERIFIED is false and this notice is how the screen says so.
  */
  await expect(page.getByText(/have not been checked against the regulation/)).toBeVisible();

  // And it must not quietly become a figure derived from what actually happened.
  await expect(page.getByText(/never from who actually turned up/)).toBeVisible();
});
