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
    //
    // Scoped to `#side-nav`, and it has to be: the launcher on `/` names every screen the
    // rail names, so an unscoped `getByRole('link', { name: 'Attendance' })` resolves to
    // two elements and fails on strict mode rather than on the behaviour. The subject
    // here is the drawer, so the drawer is what the locator should say.
    await page.getByRole('button', { name: /Menu/ }).click();
    await expect(page.locator('#side-nav').getByRole('link', { name: 'Attendance' })).toBeVisible();
  });

  /**
   * The drawer is an overlay, which makes it a modal, which means it owes the reader four
   * behaviours that are easy to ship without and impossible to notice missing in a
   * screenshot. All four are asserted because none of them are visible to axe.
   */
  test('the menu drawer closes the way an overlay has to', async ({ page }) => {
    await visit(page, '/');
    const toggle = page.getByRole('button', { name: /Menu/ });
    // Scoped to the rail — the launcher on `/` offers the same labels, so an unscoped
    // locator matches twice. See the note in the test above.
    const attendance = page.locator('#side-nav').getByRole('link', { name: 'Attendance' });

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
    await expect(page.locator('#side-nav').getByRole('link', { name: 'Attendance' })).toBeHidden();
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

  /**
   * A collapsed nav group stays collapsed after navigating.
   *
   * This is the whole feature. Collapsing itself is native `<details>` and cannot really
   * break; what breaks is the memory of it, because the state lives in a cookie written by
   * one small client component and read by the server on the next request. If that link
   * fails, the groups silently spring open on every page load and the disclosure becomes an
   * irritation rather than a preference — which is worse than not having built it.
   *
   * Nothing else would notice. Every existing assertion opens a page fresh, where the
   * default is open and a broken cookie looks exactly like a working one.
   */
  test('a collapsed nav group is still collapsed after navigating', async ({ page }) => {
    await visit(page, '/');

    const money = page.locator('details[data-group="money"]');
    // Scoped to the rail: this test is about whether the GROUP is collapsed, and the
    // launcher on `/` lists Funding too — so an unscoped locator would be asserting the
    // visibility of a link the collapse has nothing to do with.
    const funding = page.locator('#side-nav').getByRole('link', { name: 'Funding', exact: true });

    // Default is open, and deliberately so: shipping the rail collapsed would put a tap in
    // front of the most-used screen in the product for everybody.
    await expect(money).toHaveAttribute('open', '');
    await expect(funding).toBeVisible();

    await money.locator('summary').click();
    await expect(funding).toBeHidden();

    // The part that needs the cookie. A full navigation, not a client-side re-render.
    await page.goto('/children', { waitUntil: 'networkidle' });
    await expect(
      page.locator('details[data-group="money"]'),
      'the group sprang back open on navigation — the cookie is not being written or not being read',
    ).not.toHaveAttribute('open', '');
    await expect(page.getByRole('link', { name: 'Funding', exact: true })).toBeHidden();

    // And the groups nobody touched are untouched.
    await expect(page.locator('details[data-group="today"]')).toHaveAttribute('open', '');
  });

  test('child record — the densest screen in the product', async ({ page }) => {
    const t = tenant();
    await visit(page, `/children/${t.childId}`);
    await expect(page.getByRole('heading', { name: /Tāne/ })).toBeVisible();
    await auditPage(page, `/children/[id]`);
  });

  /*
    Every tab, not just the overview.

    The overview is the least dense of the five and auditing only it would report a pass on
    four screens nobody looked at — the health tab alone carries a table, a radio group, a
    medication form and the dose log. Cheap to cover and the exact place a contrast or
    labelling failure would otherwise ship.
  */
  for (const tab of ['whanau', 'health', 'attendance', 'documents']) {
    test(`child record — the ${tab} tab`, async ({ page }) => {
      const t = tenant();
      await visit(page, `/children/${t.childId}/${tab}`);
      await expect(page.getByRole('heading', { name: /Tāne/ })).toBeVisible();
      await auditPage(page, `/children/[id]/${tab}`);
    });
  }

  /**
   * A tripwire on the reading order, not a style check.
   *
   * The design pack puts health above the identity metadata "because it is the only
   * block read under time pressure" — names and dates are read by somebody sitting
   * down; an allergy is read by somebody holding a child who has eaten something. That
   * ordering is a safety decision and it is invisible to every other check in this
   * repo: the page renders, axe passes and the tests are green with the sections in any
   * order at all. So it is asserted, the same way the unverified-ratio caveat is.
   *
   * REWRITTEN WHEN THE RECORD BECAME TABS, AND IT ASSERTS MORE THAN IT USED TO
   *
   * It read the `<h2>` order on one long page: Health above Details, Consent above
   * Enrolment. Tabs make that meaningless — each tab has its own headings — and tabs
   * could easily have destroyed the property outright, by putting the allergy one tap
   * away from every screen that is not the health tab.
   *
   * So the flags moved into the record's header, and this asserts the stronger thing:
   * the critical condition is above the reference metadata **and it is on every tab**,
   * including the paperwork ones. If somebody later moves the flag row back inside a
   * tab, this fails on the tab they did not think about.
   */
  test('the child record leads with health on every tab, not with identity metadata', async ({
    page,
  }) => {
    const t = tenant();

    for (const tab of ['', '/whanau', '/health', '/attendance', '/documents']) {
      await visit(page, `/children/${t.childId}${tab}`);

      const flag = page.locator('.record-flags .flag-critical').first();
      await expect(flag, `no critical health flag on /children/[id]${tab}`).toBeVisible();

      // Above the reference text — age, date of birth, enrolment — not merely present.
      // Measured, because "above" is the whole claim and a flag row that renders below
      // the metadata would satisfy a presence check.
      const flagBox = await flag.boundingBox();
      const metaBox = await page.locator('.record-meta').boundingBox();
      expect(
        flagBox!.y,
        `the health flag sits below the identity metadata on /children/[id]${tab}`,
      ).toBeLessThan(metaBox!.y);
    }
  });

  /**
   * A tab is a route, which is the entire point of them being routes.
   *
   * Asserted because the failure mode is invisible: tabs held in `useState` look and
   * behave identically until somebody pastes the URL into a message, and by then the
   * person receiving it is on the overview wondering what they were meant to look at.
   */
  test('every tab of the child record is linkable, and a made-up one is not', async ({ page }) => {
    const t = tenant();

    await visit(page, `/children/${t.childId}/health`);
    await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
    // The tab bar agrees with the URL, and says so in the accessibility tree rather than
    // only in colour.
    await expect(page.getByRole('link', { name: 'Health' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    /*
      An undefined tab shows the not-found page, not the overview.

      Asserted on content rather than on `response.status()`, and the reason is worth
      recording: the status is **200**. The record's layout does async work and streams, so
      by the time the page calls `notFound()` the response has begun and the status can no
      longer be changed. That is a Next constraint rather than a fault here, and it means a
      status-code assertion would be asserting something this app cannot deliver.

      What matters to the person who mistyped the URL is what they are shown, and that is
      what this checks.
    */
    await page.goto(`/children/${t.childId}/finance`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
    await expect(page.locator('.record-tabs')).toHaveCount(0);
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
    const caveat = page.getByText(/counts children signed in today/i).first();
    await expect(caveat).toBeVisible();
    expect(await px('.ratio-wall .ratio-caveat'), 'the input caveat should scale too').toBeGreaterThanOrEqual(20);

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
    The densest form in the product — sixteen fields per person, five of them disabled
    with a reason, three of them three-state selects standing in for checkboxes that
    could not express "not recorded".

    Audited because that density is where a name goes missing. This screen has already
    had one such fault caught by hand before axe ever saw it: the actions column header
    was an empty `<th>`, which reads to a screen reader as a column with no name, and
    the fix is the `visually-hidden` span that is there now. The disabled selects are the
    other thing worth a pass — a disabled control still needs its label, and "no Ministry
    code list loaded" is the only explanation a person gets for why they cannot type.
  */
  test('ECE Return staffing', async ({ page }) => {
    await visit(page, '/census');
    await auditPage(page, '/census');
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

  /*
    THE ACCOUNT PAGE HAD NO COVERAGE AT ALL, WHICH WAS FOUND THE HARD WAY.

    Added 2026-09-03. Nothing in this suite visited `/account` — a grep for it across every
    spec returned nothing — so the 118-test green run said nothing about it. That mattered
    the moment `NextIntlClientProvider` moved out of the root layout and into
    `(app)/account/layout.tsx`: `useTranslations()` throws at render without a provider
    above it, and this is the only page in the product that calls it. A change whose whole
    point was to stop every other page paying for that provider could have broken the one
    page that needs it, and the suite would have stayed green.

    It is also the page with the locale switcher, so it is the only screen where axe sees
    the i18n machinery at all.
  */
  test('account, the only page with the i18n client runtime', async ({ page }) => {
    await visit(page, '/account');
    await auditPage(page, '/account');
  });

  /*
    Help, twice: collapsed and with a question mark open.

    The open state is the one worth auditing. Collapsed, a `<details>` is a button and
    axe has almost nothing to look at; expanded, it is the panel somebody reads — and a
    help affordance that fails an audit is a special kind of wrong, because the person
    most likely to open it is the person having the most difficulty.
  */
  test('help — the documentation page', async ({ page }) => {
    await visit(page, '/help');
    await auditPage(page, '/help');
  });
  test('help, with a question mark opened', async ({ page }) => {
    await visit(page, '/attendance');
    await page.locator('summary.help-mark').first().click();
    await expect(page.locator('.help-body').first()).toBeVisible();
    await auditPage(page, '/attendance (help note open)');
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
