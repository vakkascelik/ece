import { expect, test, type Browser, type Page } from '@playwright/test';
import { tenant } from './fixtures/audit';

/**
 * Every route, every role, asserted against the capability matrix.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE RLS SUITE
 *
 * The RLS suite proves what the *database* will return. This proves what the *application*
 * does with it, and the two can disagree in both directions:
 *
 *   • A page can render for somebody the policies would refuse, and show them an empty
 *     table. Nothing leaks, and they have still been shown a screen that is not theirs and
 *     told, by its existence, that it exists. An empty "Custody and court orders" heading
 *     tells an educator a court order exists, which is most of what the restriction
 *     protects.
 *   • A page can *fail* for somebody who is entitled, which is not a breach and is a
 *     support call — and the capability matrix is the only place that distinguishes them.
 *
 * WHY ALL FOUR ROLES AND NOT THE TWO INTERESTING ONES
 *
 * Because a four-row matrix tested at two rows is a matrix nobody has checked. `educator`
 * is the row where a mistake is least visible: it is the only role that writes daily
 * practice, so it needs real access, and it must not reach a single office screen. `manager`
 * is nearly `owner`, which is exactly why nobody would notice it drifting.
 *
 * WHAT "REDIRECT" MEANS HERE
 *
 * `requireCapability` sends an unauthorised caller to `/`. So the assertion is on the path
 * the browser ends on — and it has to be, because Next renders a redirect server-side and a
 * test that only checked for an error message would pass on a page that rendered fine.
 */

type Role = 'owner' | 'manager' | 'educator' | 'parent';

/** `true` = the page renders. `false` = the caller is sent back to `/`. */
const MATRIX: Array<{ path: string; guard: string; allowed: Record<Role, boolean> }> = [
  {
    path: '/',
    guard: 'requireCtx — signed in, that is all',
    allowed: { owner: true, manager: true, educator: true, parent: true },
  },
  {
    path: '/children',
    guard: 'requireCtx — the policy decides how many rows, not whether the page exists',
    allowed: { owner: true, manager: true, educator: true, parent: true },
  },
  {
    // Everybody, deliberately. The page documents only the screens the reader's role can
    // open — it calls the same `can()` the sidebar does — so a parent reaching it gets the
    // four screens they have and no description of the accounts screen they do not.
    path: '/help',
    guard: 'requireCtx — documentation for whatever the caller can already reach',
    allowed: { owner: true, manager: true, educator: true, parent: true },
  },
  {
    path: '/children/new',
    guard: 'manageChildren',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    path: '/attendance',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // Educators included, unlike the office screens: they are the people who witness an
    // injury and the report has to be written by whoever saw it. A parent is shut out of
    // the register and still reads their own child's FINAL reports through the child
    // record — 0030's policy draws that line, and this covers the redirect, which RLS
    // cannot.
    path: '/incidents',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // Same audience as the roll and for the same reason: the person checking a cot is
    // the person holding the tablet. A parent reads that their child slept through the
    // child record, not here.
    path: '/sleep',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // The building, not the children. Educators included: the person who spots a loose
    // paving stone is the person walking on it, and a hazard register only the office
    // can write to is a hazard register nobody writes to.
    path: '/facilities',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // A parent is shut out even though some visitors come to see them: the book is a
    // record of adults around other people's children, which is centre business.
    path: '/visitors',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // Staff plan and run outings. A family's window into one is their own child's
    // consent, which they give through the child record or on paper — the outing
    // page itself shows every child on the trip, which is not theirs to see.
    path: '/excursions',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // Distinct from /members, which is who has a LOGIN. This is who WORKS here, and a
    // reliever appears on one list and not the other — the whole point of 0038.
    // Educators can read and sign colleagues in; adding and ending employment are
    // owner/manager, enforced by the policy rather than by this route.
    path: '/staff',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    // Educators read the roster and cannot write it, which is 0041's policy split and
    // not this route's job — somebody who cannot see next week cannot plan around it.
    // A parent sees no roster at all.
    path: '/roster',
    guard: 'recordDailyPractice',
    allowed: { owner: true, manager: true, educator: true, parent: false },
  },
  {
    path: '/posts',
    guard: 'requireCtx',
    allowed: { owner: true, manager: true, educator: true, parent: true },
  },
  {
    path: '/messages',
    guard: 'requireCtx',
    allowed: { owner: true, manager: true, educator: true, parent: true },
  },
  {
    path: '/members',
    guard: 'manageMembers',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    // An application holds a stranger's details AND the hiring process, so an educator is shut out
    // even though they are a member of the centre. Asserted in `rls_isolation.sql` at the database
    // too — this covers the redirect, which RLS cannot.
    path: '/applications',
    guard: 'manageRecruitment',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    path: '/compliance',
    guard: 'manageCentre',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    path: '/compliance/binder',
    guard: 'manageCentre',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    path: '/funding',
    guard: 'manageCentre',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    // What families owe. `manageCentre`, not `manageMembers` — an educator has no
    // business in a family's debts, and a parent's own balance belongs on their own
    // invoice rather than on a screen listing every family at the centre.
    path: '/billing',
    guard: 'manageCentre',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    // Derived from attendance and the licence, so the same office-only guard as the
    // money screens. An educator has no reason to read a thirty-day occupancy trend.
    path: '/reports',
    guard: 'manageCentre',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
  {
    path: '/settings',
    guard: 'manageCentre',
    allowed: { owner: true, manager: true, educator: false, parent: false },
  },
];

/** Nav links each role should be offered. Presentation, but a wrong link is a wrong promise. */
const NAV: Record<Role, { shown: string[]; hidden: string[] }> = {
  owner: {
    shown: ['Overview', 'Children', 'Posts', 'Messages', 'Attendance', 'Incidents', 'Sleep checks', 'Site safety', 'Visitors', 'Excursions', 'Staff', 'Roster', 'People', 'Compliance', 'Funding', 'Accounts', 'Reports', 'Enquiries', 'Settings', 'Help'],
    hidden: [],
  },
  manager: {
    shown: ['Overview', 'Children', 'Posts', 'Messages', 'Attendance', 'Incidents', 'Sleep checks', 'Site safety', 'Visitors', 'Excursions', 'Staff', 'Roster', 'People', 'Compliance', 'Funding', 'Accounts', 'Reports', 'Enquiries', 'Settings', 'Help'],
    hidden: [],
  },
  educator: {
    // Roster is shown and Accounts is not: an educator plans around next week and has no
    // business in what families owe.
    shown: ['Overview', 'Children', 'Posts', 'Messages', 'Attendance', 'Incidents', 'Sleep checks', 'Site safety', 'Visitors', 'Excursions', 'Staff', 'Roster', 'Help'],
    hidden: ['People', 'Compliance', 'Funding', 'Accounts', 'Reports', 'Enquiries', 'Settings'],
  },
  parent: {
    // "Your tamariki" and "Pānui", not "Children" and "Posts" — the same routes, named for
    // the person reading them.
    // Help included: a parent gets the four screens they have, and nothing about the rest.
    shown: ['Overview', 'Your tamariki', 'Pānui', 'Messages', 'Help'],
    hidden: ['Attendance', 'Incidents', 'Sleep checks', 'Site safety', 'Visitors', 'Excursions', 'Staff', 'Roster', 'People', 'Compliance', 'Funding', 'Accounts', 'Reports', 'Enquiries', 'Settings', 'Children', 'Posts'],
  },
};

/**
 * The group headings each role should be offered, and the ones that must not exist.
 *
 * A heading is a disclosure. "Money" rendered over an empty list tells an educator that money
 * screens exist, which is the presentation half of the argument this file already makes about
 * an empty custody panel — and it is the failure mode `NavGroup` returning `null` prevents.
 * Nothing else would catch it: the links are correctly absent either way, so every assertion
 * above passes with six empty headings on an educator's screen.
 *
 * The counts are what the capability matrix actually produces, not what the design handover
 * predicted (three for an educator, none for a parent). Overview, Children, Posts and Messages
 * carry no `can()` guard, so Today and Tamariki survive for everybody; Staff and Roster ride on
 * `recordDailyPractice`, so People survives for an educator. Recorded in the wiki.
 */
const NAV_GROUPS: Record<Role, { shown: string[]; hidden: string[] }> = {
  owner: {
    shown: ['Today', 'Tamariki', 'Records', 'People', 'Money', 'Centre'],
    hidden: [],
  },
  manager: {
    shown: ['Today', 'Tamariki', 'Records', 'People', 'Money', 'Centre'],
    hidden: [],
  },
  educator: {
    shown: ['Today', 'Tamariki', 'Records', 'People'],
    hidden: ['Money', 'Centre'],
  },
  parent: {
    shown: ['Today', 'Tamariki'],
    hidden: ['Records', 'People', 'Money', 'Centre'],
  },
};

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Single membership for these three, so no centre question is asked.
  await page.waitForURL('/');
  return page;
}

function emailFor(role: Role): string {
  const t = tenant();
  return {
    owner: t.ownerEmail,
    manager: t.managerEmail,
    educator: t.educatorEmail,
    parent: t.parentEmail,
  }[role];
}

// The owner belongs to two centres, so their session needs the centre cookie the setup
// project already established. The other three belong to one and land straight on `/`.
const NEEDS_CENTRE_CHOICE: Role[] = ['owner'];

for (const role of ['manager', 'educator', 'parent'] as const) {
  test.describe(`${role}`, () => {
    test(`can reach exactly the routes the matrix allows`, async ({ browser }) => {
      const t = tenant();
      const page = await signIn(browser, emailFor(role), t.password);

      for (const row of MATRIX) {
        await page.goto(row.path, { waitUntil: 'networkidle' });
        const landed = new URL(page.url()).pathname;
        const expected = row.allowed[role] ? row.path : '/';
        expect(
          landed,
          `${role} → ${row.path} (${row.guard}): expected ${expected}, landed ${landed}`,
        ).toBe(expected);
      }

      await page.context().close();
    });

    test(`is offered exactly the navigation the matrix allows`, async ({ browser }) => {
      const t = tenant();
      const page = await signIn(browser, emailFor(role), t.password);
      const nav = page.locator('aside.side nav');

      for (const label of NAV[role].shown) {
        await expect(nav.getByRole('link', { name: label, exact: true }), `${role} should see "${label}"`).toBeVisible();
      }
      for (const label of NAV[role].hidden) {
        await expect(nav.getByRole('link', { name: label, exact: true }), `${role} should NOT see "${label}"`).toHaveCount(0);
      }

      for (const label of NAV_GROUPS[role].shown) {
        await expect(
          nav.getByRole('heading', { name: label, exact: true }),
          `${role} should see the "${label}" group`,
        ).toBeVisible();
      }
      for (const label of NAV_GROUPS[role].hidden) {
        await expect(
          nav.getByRole('heading', { name: label, exact: true }),
          `${role} should NOT see a "${label}" heading — an empty group is still a disclosure`,
        ).toHaveCount(0);
      }

      await page.context().close();
    });
  });
}

/**
 * The door tablet, which is not a role in the matrix above because it is not a person.
 *
 * This exists because of a defect the matrix could never have caught. 0043 narrowed
 * `memberships_select` to the four human roles — correct, and it meant a kiosk reads *zero*
 * membership rows while still reading its one centre. `requireCtx` therefore found a session
 * with a centre and no role and sent it to `/select-centre`, which rendered, offered its single
 * centre under the heading "You have access to more than one", and bounced straight back on
 * every press. A loop, not a refusal, and invisible to the RLS suite: every policy was correct.
 *
 * So the assertion is about *landing*, and it is the only kind of test that can see this.
 */
test.describe('kiosk', () => {
  async function signInAsKiosk(browser: Browser): Promise<Page> {
    const t = tenant();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(t.kioskEmail);
    await page.getByLabel('Password').fill(t.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The assertion, really: a kiosk lands on its own screen rather than looping.
    await page.waitForURL('/kiosk');
    return page;
  }

  test('lands on /kiosk and is sent back there from every other route', async ({ browser }) => {
    const page = await signInAsKiosk(browser);

    for (const row of MATRIX) {
      await page.goto(row.path, { waitUntil: 'networkidle' });
      expect(
        new URL(page.url()).pathname,
        `kiosk → ${row.path}: a device belongs on /kiosk and nowhere else`,
      ).toBe('/kiosk');
    }

    // The page that used to trap it. Redirecting rather than rendering is the fix.
    await page.goto('/select-centre', { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe('/kiosk');

    await page.context().close();
  });

  test('gets no navigation and no way to sign itself out', async ({ browser }) => {
    const page = await signInAsKiosk(browser);

    // Outside the (app) group entirely, so there is no rail to filter — the strongest
    // version of "a kiosk sees no office screens".
    await expect(page.locator('aside.side')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Compliance' })).toHaveCount(0);

    // It does show the roll it is allowed: the fixture's child, by preferred name.
    await expect(page.getByRole('heading', { name: 'Sign in and out' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(tenant().childName) })).toBeVisible();

    await page.context().close();
  });

  test('cannot be reached by a person', async ({ browser }) => {
    const t = tenant();
    const page = await signIn(browser, t.parentEmail, t.password);
    await page.goto('/kiosk', { waitUntil: 'networkidle' });
    // `requireKiosk` is the mirror of `requireCtx`, and each sends the other's caller away.
    expect(new URL(page.url()).pathname).toBe('/');
    await page.context().close();
  });
});

test('owner reaches every route, having chosen a centre', async ({ page }) => {
  // Uses the stored owner session, which already has the centre cookie. Separate from the
  // loop above because a two-centre user is redirected to /select-centre until they pick,
  // and that is correct behaviour rather than a failure.
  expect(NEEDS_CENTRE_CHOICE).toContain('owner');
  for (const row of MATRIX) {
    await page.goto(row.path, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname, `owner → ${row.path}`).toBe(row.path);
  }
});

test.describe('the boundary inside a centre', () => {
  test('a parent cannot open a child who is not theirs, even by URL', async ({ browser }) => {
    const t = tenant();
    const page = await signIn(browser, t.parentEmail, t.password);

    // Not in the list.
    await page.goto('/children', { waitUntil: 'networkidle' });
    await expect(page.getByText(new RegExp(`NotYours-${t.tag}`))).toHaveCount(0);
    await expect(page.getByText(new RegExp(`Audit-${t.tag}`)).first()).toBeVisible();

    // And not by typing the URL. The policy returns no row, so the page must not render a
    // record — an empty child record would still confirm the child exists.
    await page.goto(`/children/${t.otherChildId}`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Mereana')).toHaveCount(0);

    await page.context().close();
  });

  test('an educator sees the roll but not the office, and not custody', async ({ browser }) => {
    const t = tenant();
    const page = await signIn(browser, t.educatorEmail, t.password);

    // Educators must reach a child's health record — an allergy disclosed at the door at
    // 8am has to be readable by the person who was told.
    //
    // The overview, not the health tab, and that is the assertion: the allergy is in the
    // record's header on every tab, so an educator meets it without choosing one. It used
    // to be a block at the top of a single long page and `.first()` was needed because it
    // appeared twice; now the header is the only copy outside the health tab.
    await page.goto(`/children/${t.childId}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.record-flags').getByText('Peanuts')).toBeVisible();

    // And must not reach custody. On the whānau tab, where custody now lives — visiting the
    // overview would pass trivially and assert nothing, which is worse than not asserting.
    // On the *heading*, not the detail: an empty panel tells an educator that a court order
    // exists, which is most of what the restriction protects.
    await page.goto(`/children/${t.childId}/whanau`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Custody/ })).toHaveCount(0);
    await expect(page.getByText(new RegExp(`FAM-${t.tag}`))).toHaveCount(0);

    await page.context().close();
  });

  test('a manager sees custody; an owner does too', async ({ browser }) => {
    const t = tenant();
    for (const email of [t.managerEmail, t.ownerEmail]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(t.password);
      await page.getByRole('button', { name: 'Sign in' }).click();

      // The owner has two memberships and is asked which centre; the manager has one.
      if (new URL(page.url()).pathname === '/select-centre') {
        await page
          .locator('form', { has: page.getByText(`Audit Mt Albert ${t.tag}`) })
          .getByRole('button', { name: 'Open' })
          .click();
        await page.waitForURL('/');
      }

      await page.goto(`/children/${t.childId}/whanau`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: /Custody/ })).toBeVisible();
      await expect(page.getByText(new RegExp(`FAM-${t.tag}`))).toBeVisible();
      await ctx.close();
    }
  });

  test('a parent cannot open the other centre, which they are not a member of', async ({
    browser,
  }) => {
    const t = tenant();
    const page = await signIn(browser, t.parentEmail, t.password);

    // The cookie is client-controlled, so this is the check that it is a *preference* and
    // never a grant. Setting it to a centre the caller has no membership in must not open
    // that centre — requireCtx discards an unrecognised value rather than trusting it.
    await page.context().addCookies([
      { name: 'ece_centre', value: t.otherCentreId, url: page.url() },
    ]);
    await page.goto('/', { waitUntil: 'networkidle' });

    // Falls back to their only real membership rather than honouring the forged cookie.
    await expect(page.getByText(`Audit Mt Albert ${t.tag}`).first()).toBeVisible();
    await expect(page.getByText(`Audit Mt Roskill ${t.tag}`)).toHaveCount(0);

    await page.context().close();
  });
});

test('a revoked membership ends access immediately', async ({ browser }) => {
  // Every predicate in every policy joins a *live* membership, and offboarding relies on
  // that: revoking is supposed to be sufficient on its own, with no policy change and no
  // account deletion. Asserted here because it is the step a runbook would do first in an
  // incident, and nothing else tests it end to end.
  const t = tenant();
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const page = await signIn(browser, t.educatorEmail, t.password);
  await page.goto('/attendance', { waitUntil: 'networkidle' });
  expect(new URL(page.url()).pathname).toBe('/attendance');

  const revoked = await admin
    .from('memberships')
    .update({ revoked_at: new Date().toISOString() })
    .eq('centre_id', t.centreId)
    .eq('user_id', t.educatorId);
  expect(revoked.error, revoked.error?.message).toBeNull();

  try {
    // Same session, same cookie, still a valid JWT — and no memberships. `requireCtx`
    // sends them to /no-access rather than rendering an empty centre.
    await page.goto('/attendance', { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe('/no-access');
  } finally {
    // Put it back, so the ordering of this file cannot affect anything else.
    await admin
      .from('memberships')
      .update({ revoked_at: null })
      .eq('centre_id', t.centreId)
      .eq('user_id', t.educatorId);
    await page.context().close();
  }
});
