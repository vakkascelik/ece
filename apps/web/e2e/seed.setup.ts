import { writeFileSync } from 'node:fs';
import { expect, test as setup } from '@playwright/test';
import { ensureArtifacts, OWNER_STATE, PARENT_STATE, TENANT_FILE } from './fixtures/paths';
import { seedAuditTenant } from './fixtures/tenant';

/**
 * Create the tenant, then sign both roles in *through the real login form*.
 *
 * The sign-in is not a shortcut around auth — it is the first assertion in the suite.
 * Setting a Supabase cookie by hand would be faster and would mean a broken login
 * form produced a green run.
 */
setup('seed the audit tenant and sign both roles in', async ({ browser }) => {
  const tenant = await seedAuditTenant();
  ensureArtifacts();
  writeFileSync(TENANT_FILE, JSON.stringify(tenant, null, 2));

  // --- owner ---------------------------------------------------------------
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();

  await owner.goto('/login');
  await owner.getByLabel('Email').fill(tenant.ownerEmail);
  await owner.getByLabel('Password').fill(tenant.password);
  await owner.getByRole('button', { name: 'Sign in' }).click();

  // Two memberships, so the app must ask which centre rather than guess. Asserting
  // it *does* ask, because auto-selecting is how a notice reaches the wrong site.
  await expect(owner.getByRole('heading', { name: 'Which centre?' })).toBeVisible();
  await owner
    .locator('form', { has: owner.getByText(`Audit Mt Albert ${tenant.tag}`) })
    .getByRole('button', { name: 'Open' })
    .click();

  // Waiting for the URL, not for the centre's name. The name is on /select-centre too,
  // so asserting on it passed instantly against the page we were leaving — and the
  // storage state was then captured before the cookie the action sets had arrived.
  // Every owner test in the suite failed on /select-centre until this changed.
  await owner.waitForURL('/');
  await expect(owner.getByRole('link', { name: 'Compliance' })).toBeVisible();
  await ownerCtx.storageState({ path: OWNER_STATE });
  await ownerCtx.close();

  // --- parent --------------------------------------------------------------
  const parentCtx = await browser.newContext();
  const parent = await parentCtx.newPage();

  await parent.goto('/login');
  await parent.getByLabel('Email').fill(tenant.parentEmail);
  await parent.getByLabel('Password').fill(tenant.password);
  await parent.getByRole('button', { name: 'Sign in' }).click();

  // One membership, so no question is asked and the nav is the whānau one.
  await expect(parent.getByRole('link', { name: 'Your tamariki' })).toBeVisible();
  // A parent must never be offered the staff screens. This is presentation only —
  // the policies are what stop them — but a link that 404s a parent is a support
  // call, and a link that *works* would be a breach.
  await expect(parent.getByRole('link', { name: 'Compliance' })).toHaveCount(0);
  await expect(parent.getByRole('link', { name: 'Funding' })).toHaveCount(0);
  await expect(parent.getByRole('link', { name: 'People' })).toHaveCount(0);

  await parentCtx.storageState({ path: PARENT_STATE });
  await parentCtx.close();
});
