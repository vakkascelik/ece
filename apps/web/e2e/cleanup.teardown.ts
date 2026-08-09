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
  /*
    First, anything a previous run left behind. Before this existed, a run killed
    mid-flight left its tenant forever — six centres and fifty-six accounts had piled up
    by the time the first real customer was onboarded, which is how it was noticed at all.

    HOUSEKEEPING FOR OTHER RUNS MUST NEVER BLOCK CLEANUP OF THIS ONE.

    Because it happened again, by a different route. On 2026-08-09 the sweep ran bare and
    three unremovable tenants from an earlier session made it throw — so this teardown
    died before the `destroyAuditTenant` below, and every run after that stranded its own
    tenant too. Twelve centres and sixty accounts, and the only symptom the whole time was
    one red teardown at the end of an otherwise green run.

    The sweep is now per-tenant and does not throw for an unremovable centre, so this
    catch is the second line rather than the fix. It stays because the ordering is the
    real hazard: anything that runs before your own cleanup and can throw will, one day,
    take your own cleanup with it.
  */
  try {
    const swept = await sweepStaleAuditTenants();
    if (swept > 0) console.log(`  swept ${swept} stale audit tenant(s) from earlier runs`);
  } catch (e) {
    console.warn(`  sweep failed, continuing to drop this run's tenant: ${(e as Error).message}`);
  }

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
