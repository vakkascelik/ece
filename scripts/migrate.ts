/**
 * Applies pending migrations, in order, once each.
 *
 * This existed as "paste the file into the SQL editor" for longer than it should
 * have. That works until it doesn't: nothing records what ran, nothing notices a
 * migration applied twice or skipped, and nothing catches a file being edited after
 * it was already applied — which happened in this repo, deliberately, while 0001
 * and 0002 were being corrected before anything depended on them.
 *
 *   npm run migrate            apply anything pending
 *   npm run migrate -- --status  show state without changing anything
 *
 * Same two transports as `test:rls`, for the same reasons — see scripts/test-rls.ts.
 *
 * Deliberately not `supabase db push`: that wants the Supabase CLI, Docker, and a
 * linked project. This needs a connection string.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../supabase/migrations');

interface Applied {
  filename: string;
  checksum: string;
  applied_at: string;
}

const checksumOf = (sql: string) =>
  // Newlines normalised so a Windows checkout and a Linux CI runner agree. Without
  // it every migration looks edited on the other platform.
  createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

type Run = (sql: string) => Promise<unknown[]>;

async function postgresRunner(url: string): Promise<{ run: Run; close: () => Promise<void> }> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return {
    run: async (sql) => {
      const res = await client.query(sql);
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      return last?.rows ?? [];
    },
    close: () => client.end(),
  };
}

function managementRunner(token: string, ref: string): { run: Run; close: () => Promise<void> } {
  return {
    run: async (sql) => {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      const body = await res.text();
      if (!res.ok) {
        let message = body.slice(0, 600);
        try {
          message = (JSON.parse(body) as { message?: string }).message ?? message;
        } catch {
          /* raw body is more useful than a parse error */
        }
        throw new Error(message);
      }
      try {
        const parsed = JSON.parse(body);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const statusOnly = process.argv.includes('--status');
  /**
   * Record every migration as applied without running any of it.
   *
   * For adopting this runner on a database whose schema is already current — which
   * is how it was introduced here, after a session of applying files by hand. The
   * alternative is replaying migrations against a populated database, which is fine
   * when they are replayable and destructive when they are not.
   */
  const baseline = process.argv.includes('--baseline');

  const url = process.env.SUPABASE_DB_URL;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;

  let transport: { run: Run; close: () => Promise<void> };
  if (url) {
    transport = await postgresRunner(url);
    console.log('\nMigrations — direct Postgres connection');
  } else if (token && ref) {
    transport = managementRunner(token, ref);
    console.log(`\nMigrations — Management API, project ${ref}`);
  } else {
    die(
      'No database connection configured.\n\n' +
        '  SUPABASE_DB_URL, or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.\n' +
        '  See .env.example.',
    );
  }

  const { run, close } = transport;

  try {
    // The ledger has to exist before it can be consulted, and it lives outside the
    // migrations it tracks — a migration that creates its own bookkeeping table
    // cannot record having done so.
    await run(`
      create table if not exists public.schema_migrations (
        filename   text primary key,
        checksum   text        not null,
        applied_at timestamptz not null default now()
      );
      revoke all on public.schema_migrations from anon, authenticated;
    `);

    const applied = (await run(
      'select filename, checksum, applied_at::text from public.schema_migrations order by filename',
    )) as Applied[];
    const byName = new Map(applied.map((a) => [a.filename, a]));

    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    if (files.length === 0) die(`No .sql files in ${DIR}`);

    const pending: string[] = [];
    const drifted: string[] = [];

    for (const f of files) {
      const sum = checksumOf(readFileSync(path.join(DIR, f), 'utf8'));
      const prior = byName.get(f);
      if (!prior) {
        pending.push(f);
      } else if (prior.checksum !== sum) {
        drifted.push(f);
      }
    }

    for (const f of files) {
      const prior = byName.get(f);
      const state = !prior
        ? 'PENDING'
        : drifted.includes(f)
          ? 'EDITED SINCE APPLIED'
          : `applied ${prior.applied_at.slice(0, 10)}`;
      console.log(`  ${f.padEnd(28)} ${state}`);
    }

    if (drifted.length > 0) {
      // Not fixed automatically, and not ignored. A file that changed after being
      // applied means this database and this repo disagree about the schema, and
      // only a person knows which is right.
      console.error(
        `\n  ${drifted.length} migration(s) changed after being applied:\n` +
          drifted.map((d) => `    ${d}`).join('\n') +
          '\n\n  This database and this repo now disagree about the schema. Either\n' +
          '  re-apply by hand and update the checksum, or add a new migration that\n' +
          '  makes the change. Refusing to guess.\n',
      );
      process.exitCode = 1;
      if (!statusOnly) return;
    }

    if (statusOnly) {
      console.log(`\n  ${pending.length} pending, ${applied.length} applied.\n`);
      return;
    }

    if (baseline) {
      for (const f of pending) {
        const sum = checksumOf(readFileSync(path.join(DIR, f), 'utf8'));
        await run(
          `insert into public.schema_migrations (filename, checksum)
           values ('${f.replace(/'/g, "''")}', '${sum}')
           on conflict (filename) do update set checksum = excluded.checksum`,
        );
      }
      console.log(
        `\n  Recorded ${pending.length} migration(s) as applied WITHOUT running them.\n` +
          `  Only correct if this database's schema already matches them.\n`,
      );
      return;
    }

    if (pending.length === 0) {
      console.log('\n  Nothing to apply.\n');
      return;
    }

    for (const f of pending) {
      const sql = readFileSync(path.join(DIR, f), 'utf8');
      process.stdout.write(`\n  applying ${f} … `);
      try {
        await run(sql);
      } catch (err) {
        console.log('FAILED');
        die(`${f} failed and was NOT recorded:\n\n  ${(err as Error).message}`);
      }
      // Recorded only after the migration itself succeeded, so a failure leaves it
      // pending rather than silently marked done.
      await run(
        `insert into public.schema_migrations (filename, checksum)
         values ('${f.replace(/'/g, "''")}', '${checksumOf(sql)}')`,
      );
      console.log('ok');
    }

    console.log(`\n  ${pending.length} migration(s) applied.\n`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
