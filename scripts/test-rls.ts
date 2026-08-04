/**
 * Runs the RLS isolation suite against a Postgres connection.
 *
 * Needs SUPABASE_DB_URL — the direct connection string from Supabase Settings →
 * Database. Deliberately not a personal access token: a PAT is account-wide and
 * can reach every project on the account, and this only needs to talk to one
 * database.
 *
 * The suite ends in ROLLBACK, so running it against a live project leaves
 * nothing behind. It still fails loudly rather than skipping if the connection
 * is missing — a green run that silently tested nothing is worse than a red one.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const SUITE = path.resolve(import.meta.dirname, '../supabase/tests/rls_isolation.sql');

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      '\nSUPABASE_DB_URL is not set.\n\n' +
        'Supabase dashboard → Settings → Database → Connection string (URI).\n' +
        'Put it in .env.local as SUPABASE_DB_URL, then re-run.\n\n' +
        'This suite is the only thing proving one centre cannot read another\n' +
        'centre\'s data. Skipping it is not a neutral act.\n',
    );
    process.exit(1);
  }

  const sql = readFileSync(SUITE, 'utf8');
  const client = new Client({
    connectionString: url,
    // Supabase terminates TLS at the pooler with a cert this client does not
    // have a chain for. The connection is still encrypted.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // NOTICE is how each assertion reports PASS, so it has to be surfaced.
  client.on('notice', (n) => {
    const text = (n.message ?? '').trim();
    if (text) console.log(text.startsWith('PASS') ? `  ${text}` : `  ${text}`);
  });

  try {
    await client.query(sql);
    console.log('\nRLS isolation: all checks passed.\n');
  } catch (err) {
    const message = (err as Error).message;
    console.error(`\nRLS ISOLATION FAILED\n\n  ${message}\n`);
    console.error('A failure here means one centre can reach another centre\'s data.\n');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
