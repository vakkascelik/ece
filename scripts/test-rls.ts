/**
 * Runs the RLS isolation suite — the only thing proving one centre cannot reach
 * another centre's data.
 *
 * The suite ends in ROLLBACK, so running it against a live project leaves nothing
 * behind. It fails loudly rather than skipping when no connection is configured:
 * a green run that silently tested nothing is worse than a red one.
 *
 * TWO TRANSPORTS
 *
 * `SUPABASE_DB_URL` — direct Postgres. Preferred, and what CI uses. Scoped to one
 * database, so a leaked value reaches one project.
 *
 * `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` — the Management API, for when
 * you have a personal access token but not the database password (which is the
 * normal state of affairs on a project you did not create locally). Convenient,
 * and worth being clear-eyed about: a PAT is account-wide and can reach every
 * project on the account, including production ones this repo has nothing to do
 * with. Fine on a laptop, wrong in CI.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SUITE = path.resolve(import.meta.dirname, '../supabase/tests/rls_isolation.sql');

type Row = { seq: number; result: string; label: string };

/** Prints the result table and returns true if everything passed. */
function report(rows: Row[]): boolean {
  for (const r of rows) console.log(`  ${r.result}  ${r.label}`);
  const passed = rows.filter((r) => r.result === 'PASS').length;
  console.log(`\n  ${passed}/${rows.length} assertions passed`);
  return rows.length > 0 && passed === rows.length;
}

function fail(message: string): never {
  console.error(`\nRLS ISOLATION FAILED\n\n  ${message}\n`);
  console.error("A failure here means one centre can reach another centre's data.\n");
  process.exit(1);
}

async function viaPostgres(url: string, sql: string) {
  // Imported lazily so the Management API path does not require `pg` to resolve.
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: url,
    // Supabase terminates TLS at the pooler with a cert this client has no chain
    // for. The connection is still encrypted.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    // Multi-statement, so node-postgres returns one result per statement. The
    // suite's own result table is the one carrying a `label` column.
    const results = await client.query(sql);
    const all = Array.isArray(results) ? results : [results];
    const table = all.find((r) => r.fields?.some((f: { name: string }) => f.name === 'label'));
    if (!table) fail('The suite ran but returned no result table. Did the final SELECT survive an edit?');
    if (!report(table.rows as Row[])) process.exit(1);
  } catch (err) {
    fail((err as Error).message);
  } finally {
    await client.end();
  }
}

async function viaManagementApi(token: string, ref: string, sql: string) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    // A failed assertion raises, which aborts the transaction, so the API returns
    // the exception rather than the table. The message names the assertion.
    let message = body.slice(0, 800);
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? message;
    } catch {
      /* not JSON — the raw body is more useful than a parse error */
    }
    fail(message);
  }
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    fail(`Unexpected response: ${body.slice(0, 300)}`);
  }
  if (!Array.isArray(rows) || rows.length === 0 || !(rows[0] as Row).label) {
    fail('The suite ran but returned no result table. Did the final SELECT survive an edit?');
  }
  if (!report(rows as Row[])) process.exit(1);
}

async function main() {
  const sql = readFileSync(SUITE, 'utf8');
  const url = process.env.SUPABASE_DB_URL;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;

  if (url) {
    console.log('\nRLS isolation — direct Postgres connection\n');
    await viaPostgres(url, sql);
  } else if (token && ref) {
    console.log(`\nRLS isolation — Management API, project ${ref}\n`);
    await viaManagementApi(token, ref, sql);
  } else {
    console.error(
      '\nNo database connection configured.\n\n' +
        'Either (preferred, and what CI uses):\n' +
        '  SUPABASE_DB_URL   — dashboard → Settings → Database → Connection string (URI)\n\n' +
        'Or, if you have a personal access token but not the database password:\n' +
        '  SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF\n\n' +
        'Put either in .env.local and re-run.\n\n' +
        'This suite is the only thing proving one centre cannot read another\n' +
        "centre's data. Skipping it is not a neutral act.\n",
    );
    process.exit(1);
  }

  console.log('\nRLS isolation: all checks passed.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
