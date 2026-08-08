import { expect, test } from '@playwright/test';
import { visit } from './fixtures/audit';

/**
 * The visitor book: in at the door, out when they leave.
 *
 * The property worth a browser is the middle state. Between those two clicks the
 * visitor must be on the "in the building" list — that list is what gets read at the
 * assembly point during an evacuation, and a book that loses people between sign-in
 * and sign-out is a spiral notebook with better fonts.
 */

async function submitAndWait(page: import('@playwright/test').Page, name: string) {
  const done = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/visitors' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name }).click();
  await done;
}

test('a visitor is in the building from sign-in until signed out, then in the day log', async ({
  page,
}) => {
  await visit(page, '/visitors');

  await page.getByLabel('Name').fill('Pat Sparky');
  await page.getByLabel('Organisation (optional)').fill('Volt Electrical');
  await page.getByLabel('Why they are here (optional)').fill('Rewiring the office');
  await submitAndWait(page, 'Sign in');

  /*
    Scoped by the heading, never by table index. When the in-building list empties,
    its card renders an empty-state paragraph instead of a table — so
    `getByRole('table').first()` silently becomes the DAY LOG, and "Pat Sparky is off
    the first table" fails against the table that is *supposed* to contain them. The
    first version of this test did exactly that and read as a product bug.

    The heading is a sibling of the card, not inside it, hence the `+` combinator.
  */
  const inBuilding = page.locator('h2:has-text("In the building") + div.card');
  const todayLog = page.locator('h2:has-text("Earlier today") + div.card');
  const row = inBuilding.getByRole('row', { name: /Pat Sparky/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Volt Electrical')).toBeVisible();
  await expect(row.getByText(/Rewiring the office/)).toBeVisible();

  // The form cleared for the next person at the door.
  await expect(page.getByLabel('Name')).toHaveValue('');

  // Waiting on the POST, not just the click — click() returns when the event is
  // dispatched, and asserting against the un-revalidated page is the race that cost
  // an afternoon on the settings spec.
  const signedOut = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/visitors' && r.request().method() === 'POST',
  );
  await row.getByRole('button', { name: 'Sign out' }).click();
  await signedOut;

  // Off the live list, into today's log — not gone. A visit that happened is
  // evidence, and 0035 withholds DELETE from everybody.
  await expect(inBuilding.getByRole('row', { name: /Pat Sparky/ })).toHaveCount(0);
  await expect(todayLog.getByRole('row', { name: /Pat Sparky/ })).toBeVisible();
});

test('a visitor with only a name is accepted — the door is not a form review', async ({
  page,
}) => {
  await visit(page, '/visitors');
  await page.getByLabel('Name').fill('Nana Rose');
  await submitAndWait(page, 'Sign in');

  await expect(
    page
      .locator('h2:has-text("In the building") + div.card')
      .getByRole('row', { name: /Nana Rose/ }),
  ).toBeVisible();
});
