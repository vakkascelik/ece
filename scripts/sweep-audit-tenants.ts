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
/*
  Returns the query function AND a closer, which is the whole point of the second half — added
  2026-09-04 after this script cost an hour of misdiagnosis.

  IT DID ITS WORK AND THEN NEVER EXITED. `runner()` opened a `pg` Client and nothing ever closed
  it, so an open socket kept the event loop alive indefinitely. The script printed
  "15 account(s) removed", `main()` returned, and the process sat there.

  That is harmless on its own and was not harmless in context: it had been chained ahead of the
  e2e suite in one shell command — `npm run sweep:audit; npm run test:e2e` — so **the e2e suite
  never started at all**. Zero output and no artefacts for forty minutes, which I read as a hung
  Playwright run and spent an hour investigating: the auth admin API, orphan accounts, Postgres
  locks, an import cycle, a stale build. Every one of those came back healthy, because none of
  them was the problem.

  The `fetch` path never had this bug, which is why it was invisible on any machine without
  `SUPABASE_DB_URL` set.
*/
async function runner(): Promise<{ run: Run; close: () => Promise<void> }> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return {
      run: async (sql) => (await client.query(sql)).rows,
      close: () => client.end(),
    };
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    die('Set SUPABASE_DB_URL, or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.');
  }
  return {
    run: async (sql) => {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`${body.slice(0, 400)}\n  statement: ${sql.slice(0, 120)}`);
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? parsed : [];
    },
    // Nothing to close: `fetch` holds no socket open between calls, which is why this branch
    // never exhibited the bug the Postgres one did.
    close: async () => {},
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

  const { run, close } = await runner();
  const cutoff = new Date(Date.now() - GRACE_HOURS * 3_600_000).toISOString();
  const olderThan = all ? '' : `and created_at < '${cutoff}'`;

  console.log(`\n  Sweeping audit tenants${dryRun ? ' (dry run)' : ''}`);
  console.log(all ? '  everything, --all was passed' : `  created before ${cutoff}`);

  // --- centres -------------------------------------------------------------
  const centres = await run(
    `select id, slug from public.centres where slug like 'audit-%' ${olderThan} order by slug`,
  );
  /*
    PAYMENTS FIRST, AND ONLY THIS SCRIPT MAY DO IT.

    The comment below is right that a CASCADE runs as the table owner and so is not
    stopped by the append-only grant. `payments.invoice_id` is not a cascade — it is
    `on delete restrict` (0019) — so a payment genuinely blocks the delete of its
    tenant, and no amount of owner privilege changes that. The row has to go first.

    This is the one place that may do it. `destroyAuditTenant` and the e2e sweep run as
    `service_role`, which has no DELETE on `payments` at all, and that is the guarantee
    working rather than an obstacle to route around. Here the connection is the table
    owner via the Management API — the cost the fixture's comment names when it says a
    stuck tenant "needs the Management API". Without this the escape hatch does not
    actually escape, which was true until 2026-08-09: three tenants held a payment, the
    e2e sweep could not remove them, and this script would have failed on them too.
  */
  if (!dryRun && centres.length > 0) {
    // Scoped by the ids already selected above, not by re-deriving the age filter. The
    // first version rewrote `olderThan` with a regex to re-qualify its column name, which
    // worked and was one rename away from silently widening to every payment in the
    // project. The ids are exact and cannot drift from the list being swept.
    const ids = centres.map((c) => `'${c.id as string}'`).join(', ');
    await run(`delete from public.payments p
                using public.invoices i
                where i.id = p.invoice_id and i.centre_id in (${ids})`);
  }

  let dropped = 0;
  const stuck: string[] = [];

  for (const c of centres) {
    if (dryRun) {
      console.log(`  would drop   ${c.slug}`);
      continue;
    }
    // Cascades to children and everything hanging off them, including the append-only
    // tables — a referential action runs as the table owner, so the guarantee is intact and
    // simply is not a guarantee against dropping the tenant. Only possible since 0020;
    // before that this script could not have worked at all.
    //
    // Per-tenant and non-fatal for the reason the e2e sweep is: one centre that refuses to
    // go must not stop the others, and must not skip the ACCOUNTS below — which is what
    // an aborting loop did, silently, while orphan logins accumulated.
    try {
      await run(`delete from public.centres where id = '${c.id}'`);
      console.log(`  dropped      ${c.slug}`);
      dropped += 1;
    } catch (e) {
      stuck.push(`${c.slug}: ${(e as Error).message.split('\n')[0]}`);
      console.warn(`  COULD NOT DROP ${c.slug}`);
    }
  }
  console.log(`  ${dryRun ? centres.length : dropped} centre(s)`);
  if (stuck.length > 0) console.warn(`\n  stuck:\n    ${stuck.join('\n    ')}\n`);

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

  /*
    ONLY THE HAPPY PATH NEEDED THIS, and the asymmetry is worth a sentence rather than a
    defensive `finally` that implies otherwise.

    A throw goes to `die()`, which calls `process.exit(1)` — that terminates immediately and does
    not wait for the event loop, so an open socket has never been able to hang the failure path.
    It was the success path that hung: `main()` returned, nothing closed the client, and node sat
    on a live connection forever.

    The failure this prevents is not a leaked socket. It is a process that has finished its work
    and will not exit — which, chained ahead of another command, silently stops that command from
    ever running.
  */
  await close();
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
