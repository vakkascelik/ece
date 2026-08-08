import { expect, test } from '@playwright/test';
import { visit } from './fixtures/audit';

/**
 * The accounts screen, and the one thing no other test could catch.
 *
 * `summariseArrears` is unit-tested to death and `invoice_arrears` is asserted in the
 * RLS suite. Neither would notice a **wiring** mistake on the page — the ageing never
 * reaching the table, the formatter dropping a cent, a figure landing in the wrong
 * column. All of those typecheck, pass every existing test, and put a wrong number in
 * front of a manager about to ring a family.
 *
 * WHAT THIS CANNOT COVER, AND WHY
 *
 * Part payment. The fixture seeds an invoice and **no payment**, because
 * `payments.invoice_id` is `on delete restrict` and DELETE on `payments` is withheld
 * from `service_role` too — so a seeded payment pins its invoice and the teardown
 * cannot clear it. Both halves verified the hard way: a foreign-key violation, then
 * `permission denied for table payments`. That is the append-only guarantee working,
 * not a gap to route around, so the paid/total split is covered in the RLS suite
 * instead, which inserts a payment inside a transaction it rolls back.
 */

test('the accounts screen shows what is owed', async ({ page }) => {
  await visit(page, '/billing');

  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: 'INV-' });
  await expect(row).toBeVisible();
  await expect(row.getByText('$455.00')).toBeVisible();

  // Due 40 days ago, so it is late and says by how much rather than only that it is.
  await expect(row.getByText(/40 days/)).toBeVisible();

  // Nothing paid, so the part-payment line must not appear at all — an empty "of $0.00
  // paid" would read as a payment nobody made.
  await expect(row.getByText(/paid/)).toHaveCount(0);
});

test('the summary counts it as overdue and not as merely owing', async ({ page }) => {
  await visit(page, '/billing');

  // The distinction the whole module exists for: money that is late, separately from
  // money that is owed. A summary that added them would overstate the problem, and a
  // figure a manager knows is wrong is a figure they stop reading.
  await expect(page.getByText('$455.00 overdue')).toBeVisible();
  await expect(page.getByText(/owing but not yet due/)).toHaveCount(0);
});

test('it never says a family is late without saying how late', async ({ page }) => {
  await visit(page, '/billing');

  /*
    The ageing table carries every bucket including the empty ones, so the headings do
    not reflow between two visits — and the seeded invoice lands in 31–60, which is the
    column that proves the arithmetic reached the screen rather than stopping at the
    view.
  */
  const aged = page.getByRole('table').first();
  await expect(aged.getByRole('columnheader', { name: '31–60 days' })).toBeVisible();
  await expect(aged.getByRole('columnheader', { name: 'No due date' })).toBeVisible();
  await expect(aged.getByRole('cell', { name: '$455.00' })).toBeVisible();
});
