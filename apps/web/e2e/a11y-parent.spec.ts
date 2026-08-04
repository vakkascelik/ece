import { expect, test } from '@playwright/test';
import { auditPage, tenant, visit } from './fixtures/audit';

/**
 * The whānau view, audited separately because it is a different page.
 *
 * Same routes, different render: the nav is shorter, `/children` is one record rather
 * than a roll, and the consent panel is the read-only version. A parent is also the
 * user most likely to be on an old phone, in a hurry, with one hand — the population
 * an accessibility failure hurts most.
 *
 * The capability redirects are asserted here rather than assumed. `requireCapability`
 * sends a parent to `/`, so these are checks that the redirect happens — the policies
 * in Postgres are what make it safe, but a parent who lands on a staff screen and sees
 * an empty table has still been shown a screen that is not theirs.
 */

test('overview', async ({ page }) => {
  await visit(page, '/');
  await auditPage(page, '/ (parent)');
});

test('their own tamariki, and only their own', async ({ page }) => {
  const t = tenant();
  await visit(page, '/children');
  await expect(page.getByText(/Tāne/).first()).toBeVisible();
  // The roll for staff, one record for a parent — same route, same policy, different
  // number of rows. Asserted so a policy change that widened it would fail here.
  await expect(page.getByText(`Audit-${t.tag}`).first()).toBeVisible();
  await auditPage(page, '/children (parent)');
});

test('their child record', async ({ page }) => {
  const t = tenant();
  await visit(page, `/children/${t.childId}`);
  await auditPage(page, '/children/[id] (parent)');
});

test('pānui', async ({ page }) => {
  await visit(page, '/posts');
  await expect(page.getByText('Audit pānui')).toBeVisible();
  await auditPage(page, '/posts (parent)');
});

test('messages', async ({ page }) => {
  await visit(page, '/messages');
  await expect(page.getByText(/afternoon sleep/)).toBeVisible();
  await auditPage(page, '/messages (parent)');
});

test('staff screens redirect rather than render', async ({ page }) => {
  for (const path of ['/compliance', '/funding', '/settings', '/members', '/attendance']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname, `${path} should have bounced a parent`).toBe('/');
  }
});
