import { expect, test, type Browser, type Page } from '@playwright/test';
import { tenant } from './fixtures/audit';

/**
 * Every CSV export, against every role.
 *
 * WHY THIS IS NOT A ROW IN THE ROLES MATRIX
 *
 * That matrix asserts the path a browser *lands* on, and a download never navigates —
 * the response carries `Content-Disposition: attachment`, so `page.goto` aborts and the
 * URL stays where it was. A download route added to that loop would pass while doing
 * nothing, which is the worst kind of coverage.
 *
 * So these use `page.request`, which carries the signed-in cookies and does not follow
 * redirects. A permitted role gets `200 text/csv`; a refused one gets a redirect, which
 * is what `requireCapability` does.
 *
 * WHY IT MATTERS MORE THAN THE PAGE MATRIX
 *
 * A route handler is not inside the `(app)` layout, so nothing checks a capability for
 * it. `/billing` refusing an educator while `/billing/export.csv` hands them every
 * family's debts would be a real hole, and nothing in the CSV layer would hint at it.
 *
 * **Two exports are deliberately STRICTER than their own page.** `/children` is readable
 * by an educator and by a parent — the policy decides how many rows each gets — but a
 * file leaves the product and sits in a downloads folder, so the export is owner and
 * manager only. `/staff` is the same: everyone rostered may read the roster, and a
 * spreadsheet of everybody's hours is the office's.
 */

type Role = 'manager' | 'educator' | 'parent';

const EXPORTS: Array<{ path: string; why: string; allowed: Record<Role, boolean> }> = [
  {
    path: '/billing/export.csv',
    why: 'manageCentre — what families owe',
    allowed: { manager: true, educator: false, parent: false },
  },
  {
    path: '/billing/xero.csv',
    why: 'manageCentre — the same rows as the accounts export, shaped for an accounting system',
    allowed: { manager: true, educator: false, parent: false },
  },
  {
    path: '/funding/export.csv',
    why: 'manageCentre — the RS7 preparation figures',
    allowed: { manager: true, educator: false, parent: false },
  },
  {
    path: '/funding/rs7.csv',
    why: 'manageCentre — the RS7 return itself, per date, with the declaration behind it',
    allowed: { manager: true, educator: false, parent: false },
  },
  {
    path: '/children/export.csv',
    why: 'manageChildren — STRICTER than /children, which a parent may read',
    allowed: { manager: true, educator: false, parent: false },
  },
  {
    path: '/staff/export.csv',
    why: 'manageMembers — STRICTER than /staff, which an educator may read',
    allowed: { manager: true, educator: false, parent: false },
  },
  {
    path: '/attendance/export.csv',
    why: 'recordDailyPractice — the roll, downloaded at the gate',
    allowed: { manager: true, educator: true, parent: false },
  },
];

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

for (const role of ['manager', 'educator', 'parent'] as const) {
  test(`${role} reaches exactly the exports their capabilities allow`, async ({ browser }) => {
    const t = tenant();
    const email = { manager: t.managerEmail, educator: t.educatorEmail, parent: t.parentEmail }[role];
    const page = await signIn(browser, email, t.password);

    for (const row of EXPORTS) {
      const res = await page.request.get(row.path, { maxRedirects: 0 });

      if (row.allowed[role]) {
        expect(res.status(), `${role} → ${row.path} (${row.why})`).toBe(200);
        expect(res.headers()['content-type']).toContain('text/csv');
        expect(res.headers()['content-disposition']).toContain('attachment');
        // Never cached: these hold children's names, family debts and staff hours.
        expect(res.headers()['cache-control']).toContain('no-store');
      } else {
        // `requireCapability` redirects rather than throwing, so a refusal is a 3xx.
        // Asserting "not 200" as well, because a 200 here is the actual breach.
        expect(res.status(), `${role} → ${row.path} (${row.why}) should be refused`).toBeGreaterThanOrEqual(300);
        expect(res.status()).toBeLessThan(400);
      }
    }

    await page.context().close();
  });
}

test('a signed-out request gets nothing', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  for (const row of EXPORTS) {
    const res = await page.request.get(row.path, { maxRedirects: 0 });
    expect(res.status(), `anonymous → ${row.path}`).toBeGreaterThanOrEqual(300);
    expect(res.headers()['content-type'] ?? '').not.toContain('text/csv');
  }

  await ctx.close();
});

test('the roll export names the child and marks who is here', async ({ browser }) => {
  const t = tenant();
  const page = await signIn(browser, t.managerEmail, t.password);

  const res = await page.request.get('/attendance/export.csv');
  const body = await res.text();

  // The BOM, which is what makes Excel render a macron instead of mojibake — and this
  // fixture's child is called Tāne, so the assertion is not academic.
  expect(body.charCodeAt(0)).toBe(0xfeff);
  expect(body).toContain(t.childName);
  expect(body).toContain('Child,Here now,Last event,Under 2,Date of birth');

  // The filename carries the centre, because a manager of two sites downloads both.
  expect(res.headers()['content-disposition']).toMatch(/filename="roll-audit-mt-albert-[\da-f]+-\d{4}-\d{2}-\d{2}\.csv"/);

  await page.context().close();
});

test('the accounts export emits summable numbers, not formatted money', async ({ browser }) => {
  const t = tenant();
  const page = await signIn(browser, t.managerEmail, t.password);

  const body = await (await page.request.get('/billing/export.csv')).text();

  // The screen renders $455.00 for a person; the file has to be summable by a
  // spreadsheet, and `$455.00` is text to Excel.
  expect(body).toContain('455.00');
  expect(body).not.toContain('$455.00');
  expect(body).toContain('Family,Invoice,Due,Invoiced,Paid,Owing,Days overdue,Age');

  await page.context().close();
});

test('the Xero export dates DD/MM/YYYY and guesses nothing about the chart of accounts', async ({
  browser,
}) => {
  const t = tenant();
  const page = await signIn(browser, t.managerEmail, t.password);

  /*
    An explicit window, because the DEFAULT deliberately excludes this invoice.

    The default is the previous whole month — what a bookkeeper reconciles — and the
    fixture issues its invoice today. Passing `from`/`to` covers today and tests the
    parameter at the same time. A version of this test that used the default would pass
    against an empty file and assert nothing, which is the failure mode the roll export
    test avoids by naming a child that is actually there.
  */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const res = await page.request.get(`/billing/xero.csv?from=${today}&to=${today}`);
  const body = await res.text();

  expect(res.headers()['content-type']).toContain('text/csv');

  // The template's header row, generated from the same constant the rows are.
  expect(body).toContain('ContactName,EmailAddress,');
  expect(body).toContain(',InvoiceNumber,Reference,InvoiceDate,DueDate,');
  expect(body).toContain(',Description,Quantity,UnitAmount,Discount,AccountCode,TaxType,');

  // Xero matches an existing customer on an exact name, so the contact is the guardian
  // and nothing decorative.
  expect(body).toContain('Hine Audit-');
  expect(body).toContain('INV-');

  /*
    THE ASSERTION THIS TEST EXISTS FOR.

    Not one ISO date anywhere in the file. Xero wants DD/MM/YYYY, and the way this goes
    wrong is not a rejected import — it is `new Date('2026-01-01')` being midnight UTC,
    formatted on a UTC server, rendering 31/12/2025 and filing a whole invoice in the
    previous financial year. Asserting the absence of `YYYY-MM-DD` catches the format
    slipping back; `xero.test.ts` covers the year boundary itself.
  */
  expect(body).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}/);

  /*
    And the two columns that stay empty on purpose. A future change that helpfully fills
    in `200` and `15% GST on Income` would post a centre's revenue to an account nobody
    chose — silently, because it reconciles perfectly. This is the guard against a
    well-meaning improvement.
  */
  // The BOM as an escape, not the literal character: `toCsv` prepends a BOM so Excel
  // renders macrons, and a bare BOM in source is invisible — ESLint's
  // `no-irregular-whitespace` rejects it, correctly.
  const [header, firstRow] = body.replace(/^\uFEFF/, '').split(/\r?\n/);
  const columns = header!.split(',');
  const values = firstRow!.split(',');
  expect(values[columns.indexOf('AccountCode')]).toBe('');
  expect(values[columns.indexOf('TaxType')]).toBe('');

  // No derived total for Xero to disagree with — it computes them from the lines.
  expect(columns).not.toContain('Total');
  expect(columns).not.toContain('TaxAmount');

  // The period is in the filename, not only the download date: a July file pulled in
  // August must not be named for August.
  expect(res.headers()['content-disposition']).toContain(`xero-invoices-${today.slice(0, 7)}-`);

  await page.context().close();
});

/*
  A CONTENT TEST FOR THE RS7 FILE, and `/funding/export.csv` still does not have one.

  The route×role matrix proves who may download it. It does not prove the file says what it
  must, and this file has two properties the matrix cannot see:

    1. Staff hours are BLANK, not zero, where §9-4's figure cannot be computed. A service
       reporting zero staff hours is making a different and false statement, and an empty cell
       is what an unanswered figure looks like in a spreadsheet.
    2. The assumptions ride in the file. A CSV emailed to an accountant loses every banner it
       came with, and these figures rest on allocations the Handbook does not make.
*/
test('the RS7 file carries its caveats and leaves unknown staff hours blank', async ({
  browser,
}) => {
  const t = await tenant();
  const page = await signIn(browser, t.managerEmail, t.password);

  const response = await page.request.get('/funding/rs7.csv', { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const body = await response.text();

  // The BOM, as every export here carries.
  expect(body.charCodeAt(0)).toBe(0xfeff);

  const lines = body.replace(/^\ufeff/, '').split('\r\n');
  expect(lines[0]).toBe(
    'Date,Subsidy under 2,Subsidy 2 and over,20 Hours ECE,20 Hours ECE Plus 10,Staff hours qualified,Staff hours not qualified',
  );

  // The preparation sentence survives the file leaving the screen.
  expect(body).toContain('Nothing has been submitted and this system cannot submit');

  // §9-4's figures cannot be computed for a centre that records a typed adult total, and the
  // file says so rather than printing a zero.
  expect(body).toContain('Staff hours are not produced');

  const data = lines.slice(1).filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l));
  for (const line of data) {
    const cells = line.split(',');
    // The last two columns are the staff figures. Blank, never `0`.
    expect(cells[cells.length - 2]).toBe('');
    expect(cells[cells.length - 1]).toBe('');
  }

  await page.close();
});
