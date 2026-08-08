import { expect, test, type Browser, type Page } from '@playwright/test';
import { auditPage, tenant, visit } from './fixtures/audit';

/**
 * The door tablet, end to end: the office issues a PIN, and the entrance uses it.
 *
 * This is the only test that crosses the boundary 0044 built. The RLS suite proves the
 * function refuses a wrong PIN; `roles.spec.ts` proves a device lands on `/kiosk` and
 * nowhere else. Neither proves that a PIN set on one screen works on the other, and
 * that is the whole feature — a PIN nobody can issue is a lock with no key.
 *
 * It also pins the two properties most likely to be lost in a later refactor, both of
 * which are about what is NOT on screen: a PIN is never echoed back, and the tablet
 * offers no way to sign itself out.
 */

const PIN = '4821';

async function signInAsKiosk(browser: Browser): Promise<Page> {
  const t = tenant();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(t.kioskEmail);
  await page.getByLabel('Password').fill(t.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/kiosk');
  return page;
}

/** Issue a PIN from the office, as the owner. */
async function issuePin(page: Page, pin: string) {
  const t = tenant();
  await visit(page, `/children/${t.childId}`);

  const setButton = page.getByRole('button', { name: /Set PIN|Replace PIN/ });
  await setButton.first().click();

  await page.getByLabel(/New PIN for/).fill(pin);
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/children'),
  );
  await page.getByRole('button', { name: 'Save PIN', exact: true }).click();
  await saved;
}

test('a PIN issued in the office signs a child in at the door', async ({ page, browser }) => {
  const t = tenant();

  await issuePin(page, PIN);
  // The office sees that one exists and never what it is.
  await expect(page.getByText('door PIN set').first()).toBeVisible();
  await expect(page.getByText(PIN)).toHaveCount(0);

  const kiosk = await signInAsKiosk(browser);

  // Child, then adult, then PIN — three steps, so a PIN field never appears before
  // anybody has said who they are.
  await kiosk.getByRole('button', { name: new RegExp(t.childName) }).click();
  await kiosk.getByRole('button', { name: /Hine Audit-/ }).click();

  for (const digit of PIN) {
    await kiosk.getByRole('button', { name: digit, exact: true }).click();
  }
  // The count, not the digits. A PIN echoed on an entrance screen is a PIN the person
  // behind you can read.
  await expect(kiosk.getByText('••••')).toBeVisible();
  await expect(kiosk.getByText(PIN)).toHaveCount(0);

  /*
    Direction is read from the button, not assumed.

    The first version asserted "Sign in" and hung for sixty seconds, because the fixture
    has already signed this child in and the tablet correctly offered "Sign out". The
    test was asserting the state of the world rather than the behaviour under test —
    and it would have passed or failed depending on which specs ran before it.
  */
  const submit = kiosk.getByRole('button', { name: /^Sign (in|out)$/ });
  const direction = (await submit.textContent())?.includes('out') ? 'out' : 'in';
  await submit.click();

  await expect(
    kiosk.getByText(new RegExp(`${t.childName} is signed ${direction}`)),
  ).toBeVisible();

  await kiosk.context().close();
});

test('a wrong PIN is refused in words, and the child is not signed in', async ({
  page,
  browser,
}) => {
  const t = tenant();
  await issuePin(page, PIN);

  const kiosk = await signInAsKiosk(browser);
  await kiosk.getByRole('button', { name: new RegExp(t.childName) }).click();
  await kiosk.getByRole('button', { name: /Hine Audit-/ }).click();

  for (const digit of '0000') {
    await kiosk.getByRole('button', { name: digit, exact: true }).click();
  }
  await kiosk.getByRole('button', { name: /^Sign (in|out)$/ }).click();

  /*
    The refusal arrives as a RESOLVED action, not an exception — 0044 returns a status
    so the failed-attempt counter survives, and a caller treating "the promise
    resolved" as success would sign the child in on a wrong PIN. This asserts the
    screen understood that.
  */
  await expect(kiosk.getByText(/That PIN was not right/)).toBeVisible();
  await expect(kiosk.getByText(new RegExp(`${t.childName} is signed`))).toHaveCount(0);

  await kiosk.context().close();
});

test('the tablet offers no way to sign itself out, and no office screens', async ({ browser }) => {
  const kiosk = await signInAsKiosk(browser);

  // The reason /kiosk is a sibling of (app) rather than a route inside it. Anybody
  // walking past an entrance could otherwise log the tablet out, and the centre would
  // find out at the end of the day with no roll.
  await expect(kiosk.getByRole('button', { name: /sign out/i })).toHaveCount(0);
  await expect(kiosk.locator('aside.side')).toHaveCount(0);

  // And it shows no ratio: kiosk_roll() returns no date of birth, so the bands cannot
  // be computed at all. A tablet that showed one would have to know every child's age.
  await expect(kiosk.getByText(/within ratio|ratio/i)).toHaveCount(0);

  await kiosk.context().close();
});

/**
 * The axe audit, on the one screen in this product used by people who did not choose
 * to use it and cannot ask anybody for help.
 *
 * Audited at all three steps, because they are three different pages wearing one URL —
 * a grid, a list, and a keypad — and the keypad is the one with a live region and a
 * control whose accessible name is a single digit.
 */
test('the door tablet passes an accessibility audit at every step', async ({ browser }) => {
  const t = tenant();
  const kiosk = await signInAsKiosk(browser);

  await auditPage(kiosk, '/kiosk (roll)');

  await kiosk.getByRole('button', { name: new RegExp(t.childName) }).click();
  await expect(kiosk.getByText('Who are you?')).toBeVisible();
  await auditPage(kiosk, '/kiosk (who)');

  await kiosk.getByRole('button', { name: /Hine Audit-/ }).click();
  await expect(kiosk.getByText('Enter your PIN.')).toBeVisible();
  await auditPage(kiosk, '/kiosk (pin)');

  await kiosk.context().close();
});
