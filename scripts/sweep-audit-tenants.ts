/**
 * Remove audit tenants the end-to-end suite left behind.
 *
 * WHY THIS IS NEEDED, WHICH IS A FINDING ABOUT THE HARNESS RATHER THAN THE PRODUCT
 *
 * The e2e fixture creates a throwaway centre per run and drops it in a project teardown,
 * which runs even when tests fail. It does not run when the *process* dies — and on this
 * machine the Playwright CLI has exited on a Windows libuv assertion
 * (`!(handle->flags & UV_HANDLE_CLOSING)`) more than once, mid-run. The pre-0020 defect
 * that made a centre undeletable accounted for one more.
 *
 * The result, found while onboarding the first real customer: six orphan centres and
 * **fifty-six orphan accounts** in a shared database. Exactly the accumulation the fixture's
 * own comment warned about — a later run's assertions start measuring somebody else's
 * leftovers, which is how the funding reconciliation once expected 1 and got 4.
 *
 * So cleanup cannot depend only on a graceful exit. This is idempotent, safe to run at any
 * time, and the e2e teardown calls it as well as dropping its own tenant.
 *
 * WHAT IT WILL AND WILL NOT TOUCH
 *
 * Only centres whose slug starts `audit-` AND that are older than the grace period, and
 * only accounts on the `@ece.invalid` domain with an `audit.` prefix. `.invalid` is
 * reserved by RFC 2606 and can never be a real mailbox, which is why the fixture uses it
 * and why matching on it cannot reach a real person.
 *
 * The grace period exists so this cannot delete a tenant belonging to a run that is
 * happening right now — including a CI run on another machine against the same project.
 *
 *   npm run sweep:audit               # anything older than 2 hours
 *   npm run sweep:audit -- --all      # everything, for a machine with no run in flight
 *   npm run sweep:audit -- --dry-run
 *
 * WHY THIS TALKS SQL RATHER THAN USING THE ADMIN API
 *
 * The first version used `auth.admin.listUsers`. It failed with a bare `{}` — which is
 * precisely what the comment in `scripts/onboard.ts` already warned about: on this project
 * that endpoint returns a 500 whose body carries no message, so a script depending on it
 * fails with an empty object and no way to tell why. `onboard.ts` avoids it by using
 * `generateLink` for the user id; this avoids it by reading ids out of `auth.users`.
 *
 * Deleting from `auth.users` directly is a deliberate choice and not a shortcut. The rows
 * that hang off a user — identities, sessions, refresh tokens, and this schema's
 * memberships — all cascade, and there is no other way to enumerate accounts here.
 */
const GRACE_HOURS = 2;

type Run = (sql: string) => Promise<Record<string, unknown>[]>;

/** The same two paths the migration runner and the restore drill use. */
async function runner(): Promise<Run> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return async (sql) => (await client.query(sql)).rows;
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    die('Set SUPABASE_DB_URL, or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.');
  }
  return async (sql) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${body.slice(0, 400)}\n  statement: ${sql.slice(0, 120)}`);
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  };
}

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');

  const run = await runner();
  const cutoff = new Date(Date.now() - GRACE_HOURS * 3_600_000).toISOString();
  const olderThan = all ? '' : `and created_at < '${cutoff}'`;

  console.log(`\n  Sweeping audit tenants${dryRun ? ' (dry run)' : ''}`);
  console.log(all ? '  everything, --all was passed' : `  created before ${cutoff}`);

  // --- centres -------------------------------------------------------------
  const centres = await run(
    `select id, slug from public.centres where slug like 'audit-%' ${olderThan} order by slug`,
  );
  for (const c of centres) {
    if (dryRun) {
      console.log(`  would drop   ${c.slug}`);
      continue;
    }
    // Cascades to children and everything hanging off them, including the append-only
    // tables — a referential action runs as the table owner, so the guarantee is intact and
    // simply is not a guarantee against dropping the tenant. Only possible since 0020;
    // before that this script could not have worked at all.
    await run(`delete from public.centres where id = '${c.id}'`);
    console.log(`  dropped      ${c.slug}`);
  }
  console.log(`  ${centres.length} centre(s)`);

  // --- accounts ------------------------------------------------------------
  //
  // The pattern is narrow twice over: an `audit.` prefix AND the `@ece.invalid` domain.
  // `.invalid` is reserved by RFC 2606 and can never be a real mailbox, so this cannot
  // reach a real person even if the prefix were wrong.
  const accounts = await run(
    `select id, email from auth.users
      where email like 'audit.%@ece.invalid' ${olderThan}
      order by email`,
  );
  if (dryRun) {
    for (const u of accounts) console.log(`  would remove ${u.email}`);
  } else if (accounts.length > 0) {
    await run(`delete from auth.users where email like 'audit.%@ece.invalid' ${olderThan}`);
  }
  console.log(`  ${accounts.length} account(s)${dryRun ? '' : ' removed'}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
