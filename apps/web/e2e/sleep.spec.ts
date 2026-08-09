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

  /*
    Sign THIS child in, and prove it landed before anything downstream relies on it.

    What this replaces claimed to remove a dependency on other files and did the
    opposite. It clicked the *first* "Sign in" button on the roll, which is whichever
    child happens to be away — the roll is ordered by surname and the suite has three by
    the time this runs, including the one `journey.spec.ts` enrols fresh each time. So
    the step signed in an arbitrary child and never checked, and this spec passed for
    eight runs only because an earlier file had left Tāne signed in for its own reasons.

    When that stopped being true the failure surfaced here, two steps later, as an empty
    sleep register — a symptom that points at the sleep page rather than at the roll. In
    the reproduction the register listed "Aroha Journey-…", signed in by this very block.

    Named locator, and an assertion that the app took it. A setup step that cannot fail
    is a setup step that has stopped running.
  */
  await visit(page, '/attendance');
  const here = page.getByRole('region', { name: /Here now/ });
  const arrived = here.getByText(t.childName).first();

  if (!(await arrived.isVisible().catch(() => false))) {
    /*
      Wait for the WRITE, not for the row to move.

      The roll is optimistic by design: `toggle` enqueues to the outbox, the row moves in
      the same tick, and the send is `void send()` — deliberately not awaited, because a
      spinner on a foyer tablet with no signal is theatre. So "the child is in Here now"
      proves the local queue took it and proves nothing about the server, and `/sleep` is
      server-rendered.

      The old code navigated straight after the click and the trace shows the cost: a
      `POST /rest/v1/attendance_events` with status -1, aborted mid-flight by the
      navigation. Nothing was lost — the entry stays queued and the next visit to the
      roll retries it, which is what the outbox is for — but the server did not have it
      in time for the next assertion. Standalone the POST won that race; behind a longer
      suite it lost.
    */
    const landed = page.waitForResponse(
      (r) => r.url().includes('/rest/v1/attendance_events') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: new RegExp(`^Sign in ${t.childName}`) }).click();
    await expect(arrived).toBeVisible();
    expect((await landed).ok(), 'the sign-in was rejected by the server').toBe(true);
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
