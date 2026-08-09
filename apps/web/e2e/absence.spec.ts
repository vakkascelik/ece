import { expect, test, type Browser, type Page } from '@playwright/test';
import { auditPage, tenant, visit } from './fixtures/audit';

/**
 * A parent tells the centre their child is not coming.
 *
 * The first write a family may make to the centre's own records, so the test covers both
 * halves of that claim: the parent can do the one thing, and cannot do anything else on
 * the same row.
 *
 * The RLS suite already asserts the function's outcomes against live Postgres. What only
 * a browser can show is that the control appears for a parent and **not** for staff on
 * the same screen, and that the wording never tells a family they have changed a charge.
 */

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
  return page;
}

test('a parent reports an absence, and the wording never claims the fee changed', async ({
  browser,
}) => {
  const t = tenant();
  const page = await signIn(browser, t.parentEmail, t.password);

  await visit(page, `/children/${t.childId}`);

  const panel = page
    .locator('.card')
    .filter({ has: page.getByRole('table') })
    .filter({ hasText: t.bookedDate });

  await expect(page.getByRole('heading', { name: 'Booked days' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: t.bookedDate });
  await expect(row).toContainText('Booked');

  /*
    THE WORDING, ASSERTED BEFORE THE BEHAVIOUR.

    "Cancel" is the word people reach for and it is a different status with different
    consequences — 0018: absent is still charged, cancelled is withdrawn in time. A button
    labelled Cancel would have a family believing they had stopped a charge. This is not a
    copy preference; it is the difference between a notification and a financial promise.
  */
  const button = row.getByRole('button', { name: 'Tell the centre' });
  await expect(button).toBeVisible();
  await expect(panel).not.toContainText('Cancel booking');
  await expect(panel).toContainText('does not change what you are charged');

  await button.click();

  await expect(page.getByRole('status')).toContainText('the centre knows your child is away');

  // And the row now says so, which is what the family will look for when they come back.
  await expect(page.getByRole('row').filter({ hasText: t.bookedDate })).toContainText(
    'Told you they are away',
  );

  // Audited, and the page is still accessible in the state a parent leaves it in.
  await auditPage(page, `/children/[id] (parent, absence reported)`);

  await page.context().close();
});

test('a parent confirms their details, and a manager is not offered the button', async ({
  browser,
}) => {
  const t = tenant();

  const parent = await signIn(browser, t.parentEmail, t.password);
  await visit(parent, `/children/${t.childId}`);

  // Before: nobody has confirmed. Said plainly rather than shown as a date of zero.
  await expect(parent.getByText('No parent or caregiver has confirmed these details.')).toBeVisible();

  await parent.getByRole('button', { name: 'These details are correct' }).click();
  await expect(parent.getByRole('status').filter({ hasText: 'recorded that today' })).toBeVisible();

  /*
    THE SENTENCE THIS FEATURE EXISTS TO BE HONEST ABOUT.

    The panel records WHEN a family said the details were right, and 0055 deliberately
    stores no snapshot — so the product cannot claim nothing has changed since. A confident
    "confirmed" over a phone number edited last week would be worse than no claim at all,
    and this asserts the caveat is on the screen rather than only in the migration.
  */
  await expect(parent.getByText('It does not mean nothing has changed since')).toBeVisible();

  await parent.reload({ waitUntil: 'networkidle' });
  await expect(parent.getByText('Last confirmed by a parent or caregiver on')).toBeVisible();
  await parent.context().close();

  /*
    A manager sees the date and is offered no button.

    Not because they are less trusted, but because a confirmation is a record of a FAMILY's
    assurance — a manager pressing it would record something the family never said. 0055's
    insert policy refuses it in the database; this asserts the screen does not invite it.
  */
  const manager = await signIn(browser, t.managerEmail, t.password);
  await visit(manager, `/children/${t.childId}`);

  await expect(manager.getByText('Last confirmed by a parent or caregiver on')).toBeVisible();
  await expect(manager.getByRole('button', { name: 'These details are correct' })).toHaveCount(0);

  await manager.context().close();
});

test('a second report is honest rather than silent, and staff get no such button', async ({
  browser,
}) => {
  const t = tenant();

  // The parent again: the day is already marked, so the control is gone rather than
  // present-and-failing. An enabled button that answers "you cannot do that" teaches
  // people to distrust every button on the page.
  const parent = await signIn(browser, t.parentEmail, t.password);
  await visit(parent, `/children/${t.childId}`);

  const row = parent.getByRole('row').filter({ hasText: t.bookedDate });
  await expect(row).toContainText('Told you they are away');
  await expect(row.getByRole('button', { name: 'Tell the centre' })).toHaveCount(0);
  await parent.context().close();

  /*
    A manager sees the same booking and is NOT offered the parent's control.

    Not because they are less trusted — they have `bookings_write` and the office screens
    — but because this button means "a family told us", and a manager pressing it would
    record that a family said something they did not.
  */
  const manager = await signIn(browser, t.managerEmail, t.password);
  await visit(manager, `/children/${t.childId}`);

  await expect(manager.getByRole('heading', { name: 'Booked days' })).toBeVisible();
  await expect(manager.getByRole('row').filter({ hasText: t.bookedDate })).toContainText(
    'Told you they are away',
  );
  await expect(manager.getByRole('button', { name: 'Tell the centre' })).toHaveCount(0);

  // The whole column is absent for staff, not just the button — an empty cell headed
  // "Not coming?" would read as a control that is broken rather than one that is not
  // theirs.
  await expect(manager.getByRole('columnheader', { name: 'Not coming?' })).toHaveCount(0);

  /*
    Not asserted here, deliberately: that the office's `note` on the booking survived the
    parent's write. The panel does not render it, so a browser cannot see it, and an
    assertion phrased as if it could would be the kind of coverage that reads as proof and
    is not. The RLS suite checks it directly against the row — which is the right layer,
    because the guarantee is a property of the definer function rather than of this page.
  */

  await manager.context().close();
});
