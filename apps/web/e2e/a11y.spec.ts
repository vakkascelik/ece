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
   * The navigation must not eat the first screenful.
   *
   * The first attempt at the fix above turned the rail into a full-width bar, which
   * removed the horizontal problem and created a vertical one: 312px of an 852px
   * viewport, so 37% of the screen was navigation before any content. Both of the
   * assertions in this describe passed throughout — a rail that spans the viewport and
   * does not overflow can still be useless. Hence this one, which is the criterion that
   * actually matters to somebody holding the phone.
   *
   * 160px is about two rows of chrome. Generous, and still less than a fifth of the
   * screen.
   */
  test('navigation does not eat the first screenful', async ({ page }) => {
    await visit(page, '/');
    const m = await page.evaluate(() => ({
      chrome: Math.round(document.querySelector('.side')!.getBoundingClientRect().height),
      contentTop: Math.round(document.querySelector('.main')!.getBoundingClientRect().top),
      vh: window.innerHeight,
    }));
    expect(
      m.contentTop,
      `content starts ${m.contentTop}px down a ${m.vh}px screen (${Math.round(
        (m.contentTop / m.vh) * 100,
      )}% is navigation)`,
    ).toBeLessThanOrEqual(160);

    // And opening the menu must actually reveal the links, or the collapse is just a
    // way of hiding the navigation.
    await page.getByRole('button', { name: /Menu/ }).click();
    await expect(page.getByRole('link', { name: 'Attendance' })).toBeVisible();
  });

  /**
   * The drawer is an overlay, which makes it a modal, which means it owes the reader four
   * behaviours that are easy to ship without and impossible to notice missing in a
   * screenshot. All four are asserted because none of them are visible to axe.
   */
  test('the menu drawer closes the way an overlay has to', async ({ page }) => {
    await visit(page, '/');
    const toggle = page.getByRole('button', { name: /Menu/ });
    const attendance = page.getByRole('link', { name: 'Attendance' });

    // 1. Closed, the drawer is out of the accessibility tree — not merely off-screen. A
    //    translated element is still focusable, so `visibility` is doing real work here.
    await expect(attendance).toBeHidden();

    // 2. Escape closes it, and focus returns to the control that opened it rather than to
    //    the top of the document.
    await toggle.click();
    await expect(attendance).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(attendance).toBeHidden();
    await expect(toggle).toBeFocused();

    // 3. The scrim closes it. It is the large, forgiving target for somebody who opened the
    //    menu by accident and is not hunting for a small ✕.
    //
    //    Clicked in the strip beside the drawer, computed from the drawer's own box rather
    //    than hardcoded. Playwright clicks an element's centre by default, and the scrim's
    //    centre is behind the drawer — which is a fact about the test, not a bug, but it
    //    also means the exposed strip is the only part a person can actually hit. Asserting
    //    it is wide enough to be one.
    await toggle.click();
    await expect(attendance).toBeVisible();

    const panel = await page.locator('#side-nav').boundingBox();
    const viewport = page.viewportSize()!;
    const strip = viewport.width - (panel!.x + panel!.width);
    expect(strip, `only ${Math.round(strip)}px of scrim is reachable beside the drawer`).toBeGreaterThan(80);

    await page.mouse.click(panel!.x + panel!.width + strip / 2, viewport.height / 2);
    await expect(attendance).toBeHidden();

    // 4. Navigating closes it. This layout is not remounted between routes, so without an
    //    explicit close the drawer sits on top of the page it just took you to — which
    //    reads as a tap that did nothing.
    await toggle.click();
    await attendance.click();
    await expect(page).toHaveURL(/\/attendance$/);
    await expect(page.getByRole('link', { name: 'Attendance' })).toBeHidden();
  });

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

  /**
   * A tripwire on the reading order, not a style check.
   *
   * The design pack puts health above the identity metadata "because it is the only
   * block read under time pressure" — names and dates are read by somebody sitting
   * down; an allergy is read by somebody holding a child who has eaten something. That
   * ordering is a safety decision and it is invisible to every other check in this
   * repo: the page renders, axe passes and the tests are green with the sections in any
   * order at all. So it is asserted, the same way the unverified-ratio caveat is.
   */
  test('the child record leads with health, not with identity metadata', async ({ page }) => {
    const t = tenant();
    await visit(page, `/children/${t.childId}`);

    const order = (await page.getByRole('heading', { level: 2 }).allTextContents()).map((h) =>
      h.trim(),
    );
    const at = (name: string) => order.indexOf(name);

    expect(at('Health'), `no Health section — headings were: ${order.join(', ')}`).toBeGreaterThanOrEqual(0);
    expect(
      at('Details'),
      `identity metadata is above health. Order: ${order.join(' → ')}`,
    ).toBeGreaterThan(at('Health'));
    // Consent gates whether a photo may exist, so it sits above the family/enrolment
    // blocks too.
    expect(at('Consent'), `Order: ${order.join(' → ')}`).toBeLessThan(at('Enrolment'));
  });

  /**
   * The wall display's sizes are a calculation, so they get an assertion.
   *
   * The pack sizes this panel so its status line subtends the same angle at 3m as 15px body
   * text does at 40cm — 3 ÷ 0.4 = 7.5, and 15 × 7.5 ≈ 112px. The counts land at 88px. Nothing
   * else in this repo would notice if a refactor collapsed them back to 22px: the page would
   * render, axe would pass, and the panel would silently stop being readable from the door,
   * which is the entire point of it.
   *
   * The unverified-ratio caveat is asserted at size for the same reason. A compliance
   * disclaimer that shrinks while the number it qualifies grows is a disclaimer nobody reads.
   */
  test('the wall display is actually legible from three metres', async ({ page }) => {
    await visit(page, '/attendance?wall=1');

    const px = (selector: string) =>
      page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    expect(await px('.ratio-wall .ratio-counts'), 'counts should be ~88px').toBeGreaterThanOrEqual(80);
    expect(await px('.ratio-wall .ratio-pill'), 'status pill should be ~44px').toBeGreaterThanOrEqual(40);
    expect(await px('.ratio-wall .ratio-detail'), 'detail line should be ~44px').toBeGreaterThanOrEqual(40);

    // The caveat is on screen and scaled, not shrunk into the corner.
    const caveat = page.getByText(/have not been checked against the regulations/i).first();
    await expect(caveat).toBeVisible();
    expect(await px('.ratio-wall .flag'), 'the unverified caveat should scale too').toBeGreaterThanOrEqual(20);

    // The roll is deliberately absent — see the comment in attendance/page.tsx.
    await expect(page.getByRole('region', { name: /Here now/ })).toHaveCount(0);
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

  test('incidents', async ({ page }) => {
    await visit(page, '/incidents');
    await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
    await auditPage(page, '/incidents');
  });

  test('sleep checks, with the register open', async ({ page }) => {
    await visit(page, '/sleep');
    await expect(page.getByRole('heading', { name: 'Sleep checks' })).toBeVisible();
    // Audited with a form expanded, not just the collapsed list. The radio group and
    // its legend are the part most likely to fail, and they do not exist until a row
    // is opened — auditing the closed page would report a pass on markup that is not
    // on screen.
    const open = page.getByRole('button', { name: 'Record a check' }).first();
    if (await open.isVisible().catch(() => false)) await open.click();
    await auditPage(page, '/sleep');
  });

  test('site safety, with a hazard form open', async ({ page }) => {
    await visit(page, '/facilities');
    await expect(page.getByRole('heading', { name: 'Site safety' })).toBeVisible();
    // Audited with a form expanded. The radio group in the safety-check row and the
    // select in the hazard form are the parts most likely to fail, and neither exists
    // until something is opened — auditing the collapsed page reports a pass on
    // markup that is not on screen.
    await page.getByRole('button', { name: 'Record a hazard' }).click();
    await auditPage(page, '/facilities');
  });

  test('visitors — the form is always open, so no expansion step', async ({ page }) => {
    await visit(page, '/visitors');
    await expect(page.getByRole('heading', { name: 'Sign a visitor in' })).toBeVisible();
    await auditPage(page, '/visitors');
  });

  test('excursions, with the planning form open', async ({ page }) => {
    await visit(page, '/excursions');
    await expect(page.getByRole('heading', { name: 'Excursions' })).toBeVisible();
    await page.getByRole('button', { name: 'Plan an outing' }).click();
    await auditPage(page, '/excursions');
  });

  test('staff roster, with the add form open', async ({ page }) => {
    await visit(page, '/staff');
    await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
    await page.getByRole('button', { name: 'Add somebody' }).click();
    await auditPage(page, '/staff');
  });

  test('the roster week, with both forms open', async ({ page }) => {
    await visit(page, '/roster');
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
    // Both forms, because they are the two on the page with a `select` in them and a
    // label association that only fails once it is rendered.
    await page.locator('section.card').first().getByRole('button', { name: 'Roster somebody' }).click();
    await page.getByRole('button', { name: 'Record leave' }).click();
    await auditPage(page, '/roster');
  });

  test('accounts — the first screen in the product that renders money', async ({ page }) => {
    await visit(page, '/billing');
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await auditPage(page, '/billing');
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

  /*
   * Applications, with both lists rendered and the delete armed.
   *
   * The armed state is audited rather than only the resting one, because it is the state that
   * exists for a second and does the dangerous thing — and it is a button whose accessible name
   * changes under the user. A resting-state-only audit would never see it.
   */
  test('applications — an open and a closed one, and the armed delete', async ({ page }) => {
    await visit(page, '/applications');
    await expect(page.getByText(/Āwhina Audit/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Closed \(/ })).toBeVisible();
    await auditPage(page, '/applications');

    await page.getByRole('button', { name: /^Delete the application from Āwhina/ }).click();
    await expect(page.getByRole('button', { name: /^Confirm: permanently delete/ })).toBeVisible();
    await auditPage(page, '/applications (delete armed)');
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

  /*
    Audited in the NOT-STATED state, which is the one every centre starts in.

    The fixture states no licence, so this is the page saying it cannot compute occupancy —
    a paragraph and a table column reading "not stated". The percentage variant is not
    covered here; it would need the fixture to set a licence, and the branch that renders a
    number is the simpler of the two.
  */
  test('reports', async ({ page }) => {
    await visit(page, '/reports');
    await auditPage(page, '/reports');
  });
  /*
    Audited empty, which is the state the audit tenant is in — the fixture files no
    enquiry. The populated table has a select and two buttons per row and is NOT covered
    here; that gap is real and named rather than implied by a green run.
  */
  test('enquiries', async ({ page }) => {
    await visit(page, '/enquiries');
    await auditPage(page, '/enquiries');
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
