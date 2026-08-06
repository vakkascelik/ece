import { expect, test } from '@playwright/test';
import { tenant, visit } from './fixtures/audit';

/**
 * The offline path on the web, which is screens 4 and 5 of the design pack.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COUPLE OF ASSERTIONS BOLTED ONTO THE JOURNEY
 *
 * Because the failure mode is a sign-in that *looks* recorded and never lands, and that is
 * invisible until a funding return comes up short. `drill:offline` covers the outbox contract
 * against the real database and the unit tests cover the queue's own rules; what neither can do
 * is drive a real browser with the network cut, which is the only place the whole path meets.
 *
 * `context.setOffline(true)` is the closest thing to pulling the wifi out of a wall-mounted
 * tablet. It does not fire the browser's `offline` event on its own in every engine, so the
 * tests that depend on the strip's wording dispatch it explicitly — that is a limitation of the
 * harness, not a hole in the app, and it is called out where it happens.
 */

test.describe('the roll with no connection', () => {
  test('a sign-in made offline survives, is marked unsent, and counts toward the ratio', async ({
    page,
    context,
  }) => {
    await visit(page, '/attendance');

    const away = page.getByRole('region', { name: /Not here/ });
    const row = away.getByRole('listitem').first();
    const name = ((await row.locator('.roll-name').textContent()) ?? '').trim();
    expect(name.length).toBeGreaterThan(0);

    // The ratio's child count before, read from the block itself rather than assumed.
    const countsBefore = (await page.locator('.ratio-counts').textContent()) ?? '';

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await row.getByRole('button', { name: new RegExp(`Sign in ${escapeForRegex(name)}`) }).click();

    // 1. The child moved, on a device with no network at all.
    const here = page.getByRole('region', { name: /Here now/ });
    await expect(here.getByText(name)).toBeVisible();

    // 2. The row says so. A real text node — "Waiting to send" — not a dot and not a greyed row.
    await expect(here.getByText('Waiting to send')).toBeVisible();

    // 3. The strip names the count and does not call it an error.
    await expect(page.getByText(/1 sign-in.*saved on this device/)).toBeVisible();

    // 4. The ratio counted them. This is the assertion that matters most: a queued sign-in the
    //    ratio cannot see means an educator is told they have more headroom than the room has.
    const countsAfter = (await page.locator('.ratio-counts').textContent()) ?? '';
    expect(countsAfter).not.toBe(countsBefore);

    /*
      5. The write is in durable storage, so it survives the tab being closed.

      Asserted by reading localStorage rather than by reloading, and the distinction is a real
      limitation of this surface: **the web app cannot re-render while offline.** It is
      server-rendered with no service worker, so `page.reload()` here fails with
      ERR_INTERNET_DISCONNECTED — which is exactly what a wall tablet would show. The queue
      survives; the page does not. The mobile app is a binary and does survive a restart.
      Recorded in the wiki rather than papered over, because somebody will eventually ask why
      the tablet shows a browser error after a power cut.
    */
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('ece.outbox.attendance') ?? '[]'),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'in' });
    // The key exists up front, which is what makes the retry a no-op rather than a second
    // sign-in.
    expect(stored[0].clientUuid).toMatch(/[0-9a-f-]{36}/);

    // 6. And it lands once the connection is back.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Waiting to send')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: /Here now/ }).getByText(name)).toBeVisible();

    // Now that there is a connection, a reload reads it back from the server rather than from
    // the queue — which is what proves it actually landed rather than merely stopped showing.
    await page.reload();
    await expect(page.getByRole('region', { name: /Here now/ }).getByText(name)).toBeVisible();
    await expect(page.getByText('Waiting to send')).toHaveCount(0);
    const drained = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('ece.outbox.attendance') ?? '[]'),
    );
    expect(drained).toHaveLength(0);
  });

  /*
    A context of its own, signed in as the educator.

    Completing a sign-out revokes the refresh token **server-side**, so doing it with the shared
    `OWNER_STATE` storage state invalidates that fixture for every test that runs afterwards —
    which is exactly what happened on the first run here, surfacing three tests later as "owner
    → / expected /, landed /login". A test that signs somebody out has to own its session.
  */
  test('sign-out refuses while work is unsent, and names it', async ({ browser }) => {
    const t = tenant();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(t.educatorEmail);
    await page.getByLabel('Password').fill(t.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');
    await page.goto('/attendance', { waitUntil: 'networkidle' });

    /*
      Any row, from either section, and whichever action it offers.

      Not "the first child in Not here": the test above signs a child in for real against the
      shared audit tenant, so by the time this runs that section can be empty. Tests that share
      mutable state should not also depend on each other's ordering — this one only needs *some*
      queued work, and it does not care whether that is an arrival or a departure.
    */
    const row = page.locator('.roll > li').first();
    await expect(row).toBeVisible();
    const action = row.getByRole('button', { name: /^Sign (in|out) / });

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await action.click();
    await expect(page.getByText('Waiting to send')).toBeVisible();

    // The refusal. Not a confirm-and-proceed: there is no way through it that discards the work.
    // `exact`, because every present child's action is also called "Sign out {name}" and the
    // default name match is a substring.
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /can.t sign out yet/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/1 sign-in or sign-out/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Sign out anyway/i })).toHaveCount(0);

    // Initial focus is the primary, per the pack.
    await expect(dialog.getByRole('button', { name: 'Try sending now' })).toBeFocused();

    // Escape resolves to staying signed in, and stays on the page.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/attendance/);

    // With the connection back, "Try sending now" empties the queue and lets the sign-out
    // through — the person is not made to press the same button twice.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Waiting to send')).toBeHidden({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await context.close();
  });
});

/** A child's name can contain brackets — "Ana (Anahera) Demo-Seed" — which a RegExp reads. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
