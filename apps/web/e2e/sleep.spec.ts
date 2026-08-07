import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * The sleep register, and the sentence it refuses to say.
 *
 * The property under test is not that a check saves — `test:rls` covers the write.
 * It is that **`overdue: null` renders differently from `overdue: false`**. When the
 * centre has stated no interval, an elapsed time carries no verdict; render it as the
 * green tick used for "checked recently enough" and the screen has just told a centre
 * that a gap nobody has measured is fine. That is the failure `sleep_checks` was
 * designed around, and it lives entirely in the view layer, so nothing below the
 * browser can catch it.
 */

async function signInAsOwnerAndCheck(page: import('@playwright/test').Page) {
  const done = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/sleep' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await done;
}

test('with no interval stated, a check shows elapsed time and no verdict', async ({ page }) => {
  const t = tenant();

  // The fixture's child is signed in by `journey.spec.ts`; sign them in here so this
  // spec does not depend on another file's side effects.
  await visit(page, '/attendance');
  const signIn = page.getByRole('button', { name: /Sign in/ }).first();
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click();
  }

  await visit(page, '/sleep');

  // The centre states no interval by default, and the page says so rather than
  // quietly assuming one.
  await expect(page.getByText('No interval set')).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(t.childName.split(' ')[0]!) });
  await expect(row).toBeVisible();
  await expect(row.getByText('No check recorded today')).toBeVisible();

  await row.getByRole('button', { name: 'Record a check' }).click();
  await page.getByRole('radio', { name: 'Yes' }).check();
  await signInAsOwnerAndCheck(page);

  await page.reload({ waitUntil: 'networkidle' });
  const after = page.getByRole('row', { name: new RegExp(t.childName.split(' ')[0]!) });

  // Elapsed time is shown…
  await expect(after.getByText(/min ago/)).toBeVisible();
  // …and it is NOT the "checked recently enough" tick, because nobody has said what
  // recently enough means. `flag-ok` is that tick; its absence is the assertion.
  await expect(after.locator('.flag-ok')).toHaveCount(0);
  await expect(after.getByText(/past your .* interval/)).toHaveCount(0);
});

test('a check cannot be recorded without answering the breathing question', async ({ page }) => {
  await visit(page, '/sleep');

  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Record a check' }) }).first();
  await row.getByRole('button', { name: 'Record a check' }).click();

  // Required with no preselected answer, so the browser refuses. A default of "yes"
  // would mean the most consequential claim on the screen is recorded by nobody
  // answering it.
  const yes = page.getByRole('radio', { name: 'Yes' });
  await expect(yes).not.toBeChecked();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(yes).toHaveJSProperty('validity.valid', false);
});
