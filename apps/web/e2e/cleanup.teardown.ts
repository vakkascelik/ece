import { readFileSync, rmSync } from 'node:fs';
import { test as teardown } from '@playwright/test';
import { TENANT_FILE } from './fixtures/paths';
import {
  destroyAuditTenant,
  sweepStaleAuditTenants,
  type AuditTenant,
} from './fixtures/tenant';

/**
 * Drop the tenant.
 *
 * Runs as a project teardown, so it runs after a *failing* run too. A fixture that
 * only cleans up on success accumulates half-built centres in a shared database, and
 * the next run's assertions then measure somebody else's leftovers — which is exactly
 * how the funding reconciliation's first assertion came to expect 1 and get 4.
 */
teardown('drop the audit tenant', async () => {
  // First, anything a previous run left behind. Before this, a run killed mid-flight left
  // its tenant forever — six centres and fifty-six accounts had piled up by the time the
  // first real customer was onboarded, which is how the accumulation was noticed at all.
  const swept = await sweepStaleAuditTenants();
  if (swept > 0) console.log(`  swept ${swept} stale audit tenant(s) from earlier runs`);

  let tenant: AuditTenant;
  try {
    tenant = JSON.parse(readFileSync(TENANT_FILE, 'utf8')) as AuditTenant;
  } catch {
    // Setup never got far enough to write the file, so there is nothing of ours to remove.
    return;
  }

  await destroyAuditTenant(tenant);
  rmSync(TENANT_FILE, { force: true });
});
