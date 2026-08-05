import { expect, test } from '@playwright/test';
import { auditPage, tenant, visit } from './fixtures/audit';

/**
 * WCAG 2.2 AA audit of every screen a staff member can reach.
 *
 * Each page is loaded with data in it — see the note in `fixtures/tenant.ts` about why
 * an audit of an empty state is worthless.
 */

/**
 * The shell at phone width.
 *
 * This exists because the audit above runs at 1440x900 and nothing ever looked at a
 * narrow viewport, so a real defect shipped: the 224px rail never collapsed — 57% of a
 * 390px screen — and `/attendance` scrolled 327px sideways. A horizontal page scroll
 * hides the right-hand column of every row at once, which on the roll is the column
 * with the sign-in button in it.
 *
 * Asserting on `scrollWidth` rather than on a screenshot, because the failure is
 * measurable and a pixel diff would need a baseline to argue with. 1px of tolerance:
 * sub-pixel layout rounding is not a defect.
 *
 * Note what this does NOT claim — that the web app is designed for a phone. It is not;
 * that is the Expo app's job. It claims only that it does not break on one.
 */
test.describe('the shell on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  for (const route of ['/', '/attendance', '/children']) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await visit(page, route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${route} overflows horizontally by ${overflow}px at 390px`).toBeLessThanOrEqual(1);
    });
  }

  /**
   * The other half of the same defect, and the half a scroll-width check misses
   * entirely: `/` never overflowed, it just had 166px of usable width because the rail
   * took the other 224. So this asserts the content column actually gets the screen.
   */
  test('the rail becomes a bar and gives the content its width', async ({ page }) => {
    await visit(page, '/attendance');

    const box = await page.evaluate(() => {
      const rail = document.querySelector('.side')!.getBoundingClientRect();
      const main = document.querySelector('.main')!.getBoundingClientRect();
      return { rail: Math.round(rail.width), main: Math.round(main.width), vw: window.innerWidth };
    });

    // Stacked, not beside: the rail spans the viewport rather than carving a column out
    // of it. Both halves asserted, because either one alone has a passing degenerate case.
    expect(box.rail, `rail is ${box.rail}px of a ${box.vw}px viewport`).toBeGreaterThan(box.vw * 0.9);
    expect(box.main, `content column is only ${box.main}px wide`).toBeGreaterThan(box.vw * 0.9);
  });
});

test.describe('staff screens', () => {
  test('overview', async ({ page }) => {
    await visit(page, '/');
    await auditPage(page, '/');
  });

  test('children list', async ({ page }) => {
    await visit(page, '/children');
    // The allergy flag is the thing most likely to fail contrast, so assert it is
    // actually on the page being measured.
    await expect(page.getByText('Peanuts').first()).toBeVisible();
    await auditPage(page, '/children');
  });

  test('child record — the densest screen in the product', async ({ page }) => {
    const t = tenant();
    await visit(page, `/children/${t.childId}`);
    await expect(page.getByRole('heading', { name: /Tāne/ })).toBeVisible();
    await auditPage(page, `/children/[id]`);
  });

  test('new child form', async ({ page }) => {
    await visit(page, '/children/new');
    await auditPage(page, '/children/new');
  });

  test('new child form, showing its validation errors', async ({ page }) => {
    await visit(page, '/children/new');
    // An empty submit. Error states are where labelling and announcement usually
    // break, and they are never audited if the audit only ever sees a pristine form.
    await page.getByRole('button', { name: 'Enrol' }).click();
    await page.waitForTimeout(500);
    await auditPage(page, '/children/new (invalid)');
  });

  test('attendance', async ({ page }) => {
    await visit(page, '/attendance');
    await expect(page.getByText(/Tāne/).first()).toBeVisible();
    await auditPage(page, '/attendance');
  });

  test('posts', async ({ page }) => {
    await visit(page, '/posts');
    await expect(page.getByText('Audit pānui')).toBeVisible();
    await auditPage(page, '/posts');
  });

  test('messages', async ({ page }) => {
    await visit(page, '/messages');
    await expect(page.getByText(/afternoon sleep/)).toBeVisible();
    await auditPage(page, '/messages');
  });

  test('people', async ({ page }) => {
    await visit(page, '/members');
    await auditPage(page, '/members');
  });

  test('compliance — all three expiry states rendered', async ({ page }) => {
    await visit(page, '/compliance');
    await expect(page.getByText(/Expired/).first()).toBeVisible();
    await auditPage(page, '/compliance');
  });

  test('evidence binder', async ({ page }) => {
    await visit(page, '/compliance/binder');
    await auditPage(page, '/compliance/binder');
  });

  test('funding preparation', async ({ page }) => {
    await visit(page, '/funding');
    await auditPage(page, '/funding');
  });

  test('settings', async ({ page }) => {
    await visit(page, '/settings');
    await auditPage(page, '/settings');
  });

  test('centre selection', async ({ page }) => {
    await visit(page, '/select-centre');
    await auditPage(page, '/select-centre');
  });
});

test.describe('unauthenticated screens', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await auditPage(page, '/login');
  });

  test('login, showing its error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@ece.invalid');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Those details are not right.')).toBeVisible();
    await auditPage(page, '/login (error)');
  });

  test('a live invitation', async ({ page }) => {
    const t = tenant();
    await page.goto(`/invite/${t.inviteToken}`);
    await auditPage(page, '/invite/[token] (valid)');
  });

  test('an invitation that is no good', async ({ page }) => {
    await page.goto('/invite/not-a-real-token');
    await auditPage(page, '/invite/[token] (invalid)');
  });
});
