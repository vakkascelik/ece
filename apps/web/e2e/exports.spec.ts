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
    path: '/funding/export.csv',
    why: 'manageCentre — the RS7 preparation figures',
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
