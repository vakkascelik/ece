/**
 * The restore drill.
 *
 * WHAT A BACKUP IS WORTH BEFORE IT HAS BEEN RESTORED: NOTHING
 *
 * Supabase takes a daily logical backup of this project. That fact lives in a
 * dashboard, and a fact in a dashboard is not a capability. Until somebody has taken
 * the data out, put it back, and compared the two, "we have backups" is a belief. This
 * is the cheapest thing that turns the belief into a measurement, and it runs in CI.
 *
 * WHAT IT DOES
 *
 *   1. Enumerates every table in `public` **from the catalogue**, not from a list in
 *      this file — so a table added by a future migration is covered without anybody
 *      remembering to come back here. A drill with a hand-maintained table list quietly
 *      stops covering the newest thing, which is the thing most likely to be wrong.
 *   2. Extracts every row as JSON, over the wire, to a file on disk.
 *   3. Sends that file back and reloads it into a shadow schema whose tables are
 *      `create table … (like public.… including all)`.
 *   4. Compares row counts and a content fingerprint, per table.
 *   5. Drops the shadow schema and deletes the extract.
 *
 * WHAT IT PROVES
 *
 * That the data survives a genuine round trip: database → HTTP → disk → HTTP →
 * database. That is not obvious. This schema uses timestamptz, jsonb, text[],
 * smallint[], seven enum types, a daterange exclusion constraint and bigserial keys,
 * and every one of those is a chance for a round trip to change a value silently. It
 * also proves the **constraints still accept the restored data**, because the shadow
 * tables carry the checks, the uniques and the exclusion constraint.
 *
 * That last sentence is the one that found the worst defect this drill has found, on
 * 2026-08-30: six CHECK constraints reading `at > now() - interval '14 days'` refused
 * the restore of rows that were merely old, which meant no backup of the roll, sleep,
 * medication or staff attendance older than a fortnight could be loaded — here or by
 * `pg_restore`. Fixed in 0078 by moving the six to triggers, which a dump creates after
 * the data rather than before it. Step 5 asserts that shape, because `like … including
 * all` does not copy triggers and would otherwise make this drill green whether the
 * guard was moved or simply deleted.
 *
 * WHY `jsonb_populate_record` RATHER THAN TYPE-BY-TYPE QUOTING IN JAVASCRIPT
 *
 * Because reloading through per-type SQL literals means writing a quoting rule for
 * timestamptz, for text[], for jsonb, for each enum, for daterange — and getting one
 * of them subtly wrong is how a restore appears to succeed. Handing Postgres its own
 * JSON back and letting it do the coercion means there is exactly one escaping rule in
 * this file (double the single quotes), and the type conversion is done by the same
 * code that would do it in a real restore.
 *
 * WHAT IT DOES NOT PROVE, STATED PLAINLY
 *
 *   • Not point-in-time recovery. PITR is a paid Supabase feature and is not enabled,
 *     so the recovery point is up to 24 hours old — for a centre, up to a day of
 *     attendance, messages and consent decisions. That is a decision to take, not a
 *     bug to fix, and docs/backup-and-restore.md states the cost.
 *   • Not Supabase's own backup files. This extracts through the same connection the
 *     app uses. If their backup process were broken, this drill would not notice.
 *     Verifying that needs `pg_restore` and a second database — a morning's work,
 *     documented in the runbook, and not something CI can do.
 *   • Not `auth.users`, and not Storage objects. A restore that brings back children
 *     but not the accounts allowed to read them is a restore into a locked building.
 *     The runbook says so, and says what to do about it.
 *   • Not the schema itself. `like … including all` copies columns, defaults, checks
 *     and indexes — not policies, grants, triggers or functions. Those come back from
 *     `npm run migrate`, which is replayable and checksum-guarded. That is a *better*
 *     guarantee than a dump, and it is why the migrations were made replayable.
 *
 * Usage:
 *   npm run drill:restore                  # extract to a temp dir, verify, clean up
 *   npm run drill:restore -- --keep        # leave the extract for inspection
 *   npm run drill:restore -- --out DIR     # somewhere specific
 *
 * WHERE THE EXTRACT GOES: a system temp directory, never inside the repo, and it is
 * deleted at the end. An extract of this database is every child's name, date of birth,
 * allergies and medication in one file. `--out` into a folder that a cloud client is
 * syncing is how a backup becomes a disclosure; the runbook makes that a rule.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SHADOW = 'restore_drill';
/** Rows per INSERT. Small enough that one bad row is findable, large enough to finish. */
const BATCH = 100;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Two ways to reach the database, the same two the migration runner uses.
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
  /**
   * Retried, because this drill makes a few hundred calls to a public HTTP API and a
   * transient failure part way through would look like a failed restore. Three attempts
   * with a widening gap; a real error (a bad statement) still fails on the first
   * response, because only a *network* failure is retried.
   */
  const post = async (sql: string): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        });
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, attempt * 750));
      }
    }
    throw new Error(
      `network failure after 3 attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }
  statement: ${sql.slice(0, 160)}…`,
    );
  };

  return {
    run: async (sql) => {
      const res = await post(sql);
      const body = await res.text();
      if (!res.ok) {
        let message = body.slice(0, 600);
        try {
          message = (JSON.parse(body) as { message?: string }).message ?? message;
        } catch {
          /* the raw body is more useful than a parse error */
        }
        throw new Error(`${message}
  statement: ${sql.slice(0, 200)}…`);
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

/** The only escaping rule in this file. */
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------

let checks = 0;
let failures = 0;

function check(ok: boolean, label: string, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * A stable fingerprint of a table's contents.
 *
 * Sorted by the serialised row rather than by a primary key, because some tables are
 * keyed by bigserial and some by uuid, and the point is to compare *contents* without
 * assuming an ordering exists. Keys within each row are sorted too, so a difference in
 * column order between the two schemas cannot register as a difference in data.
 */
function fingerprint(rows: Record<string, unknown>[]): string {
  const lines = rows
    .map((row) =>
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((k) => [k, row[k] ?? null]),
      ),
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const outArg = args.indexOf('--out');
  const explicitOut = outArg >= 0 ? args[outArg + 1] : undefined;

  const dbUrl = process.env.SUPABASE_DB_URL;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;

  const { run, close } = dbUrl
    ? await postgresRunner(dbUrl)
    : token && ref
      ? managementRunner(token, ref)
      : die(
          'No way to reach the database. Set either SUPABASE_DB_URL, or ' +
            'SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.',
        );

  const outDir = explicitOut ?? mkdtempSync(join(tmpdir(), 'ece-restore-drill-'));
  mkdirSync(outDir, { recursive: true });

  console.log('\n  Restore drill');
  console.log(`  via     ${dbUrl ? 'direct Postgres' : 'the Supabase management API'}`);
  console.log(`  extract ${outDir}\n`);

  try {
    // --- 1. what is there ---------------------------------------------------
    const tableRows = (await run(
      `select table_name
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    )) as { table_name: string }[];
    const tables = tableRows.map((r) => r.table_name);
    check(tables.length > 0, `enumerated ${tables.length} tables from the catalogue`);

    // --- 2. extract ---------------------------------------------------------
    // `to_jsonb(t)` rather than selecting columns, so the extract is whatever the
    // table actually holds today and not what this script remembers about it.
    const extracted: Record<string, Record<string, unknown>[]> = {};
    let totalRows = 0;
    let bytes = 0;
    for (const t of tables) {
      const rows = (await run(
        `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as rows from public.${t} x`,
      )) as { rows: Record<string, unknown>[] }[];
      const data = rows[0]?.rows ?? [];
      extracted[t] = data;
      totalRows += data.length;
      const file = join(outDir, `${t}.json`);
      writeFileSync(file, JSON.stringify(data));
      bytes += statSync(file).size;
    }
    check(true, `extracted ${totalRows} rows to disk`, `${(bytes / 1024).toFixed(0)}kB`);

    // --- 3. rebuild and reload from the files on disk ------------------------
    await run(`drop schema if exists ${SHADOW} cascade`);
    await run(`create schema ${SHADOW}`);

    let restored = 0;
    for (const t of tables) {
      // No foreign keys are copied by `like`, which is why load order does not matter.
      // A restore that has to work out a topological order is a restore that fails at
      // 3am on a cycle nobody knew was there.
      await run(`create table ${SHADOW}.${t} (like public.${t} including all)`);

      const rows = JSON.parse(readFileSync(join(outDir, `${t}.json`), 'utf8')) as Record<
        string,
        unknown
      >[];

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        // Postgres coerces its own JSON back into the row type. One escaping rule, and
        // the conversion is done by the database rather than by this file.
        await run(
          `insert into ${SHADOW}.${t}
             select * from jsonb_populate_recordset(null::${SHADOW}.${t}, ${sqlString(
               JSON.stringify(batch),
             )}::jsonb)`,
        );
        restored += batch.length;
      }
    }
    check(
      restored === totalRows,
      'every extracted row was accepted by the restored schema',
      `${restored}/${totalRows}`,
    );

    // --- 4. compare ---------------------------------------------------------
    let identical = 0;
    for (const t of tables) {
      const before = extracted[t];
      const rows = (await run(
        `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as rows from ${SHADOW}.${t} x`,
      )) as { rows: Record<string, unknown>[] }[];
      const after = rows[0]?.rows ?? [];

      const sameCount = before.length === after.length;
      const sameContent = fingerprint(before) === fingerprint(after);
      if (sameCount && sameContent) {
        identical += 1;
      } else {
        check(
          false,
          `${t} survived the round trip`,
          sameCount
            ? 'row count matches, contents differ'
            : `${before.length} rows out, ${after.length} back`,
        );
      }
    }
    check(
      identical === tables.length,
      'every table is identical after the round trip',
      `${identical}/${tables.length}`,
    );

    // --- 5. the guard that made this drill red for eleven days ---------------
    /**
     * This block exists because the fix for that failure makes the load succeed for a
     * reason that is not entirely the right one, and a green that means less than the
     * red it replaced is worse than the red.
     *
     * 0078 moved six `_not_ancient` rules from CHECK constraints to BEFORE INSERT
     * triggers. `like … including all` copies checks and does **not** copy triggers, so
     * the shadow tables above now carry no guard at all and step 3 cannot fail on one
     * however wrong the schema is. Deleting all six outright would look identical.
     *
     * So the shape of the schema is asserted directly: the trigger is present on each of
     * the six, and no `_not_ancient` CHECK has come back. The second half is the one that
     * matters most — a CHECK re-added by a later migration would be enforced during the
     * COPY of a real `pg_restore` and would make the operational core unloadable again,
     * silently, until the next time somebody ran this.
     *
     * The list is hard-coded here, which is the opposite of step 1's rule about reading
     * the catalogue. That is deliberate and is the point: the catalogue would tell us
     * about the tables that HAVE the trigger, and what needs guarding is a table that has
     * lost it.
     */
    const GUARDED = [
      'attendance_events',
      'staff_count_events',
      'medication_administrations',
      'sleep_checks',
      'safety_checks',
      'staff_attendance_events',
    ];
    const triggered = (await run(
      `select c.relname as tbl
         from pg_trigger g
         join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and g.tgname like '%\\_not\\_ancient'
          and not g.tgisinternal`,
    )) as { tbl: string }[];
    const have = new Set(triggered.map((r) => r.tbl));
    const lost = GUARDED.filter((t) => !have.has(t));
    check(
      lost.length === 0,
      'every table that had a 14-day rule still has one, as a trigger',
      lost.length === 0 ? `${GUARDED.length}/${GUARDED.length}` : `unguarded: ${lost.join(', ')}`,
    );

    const revived = (await run(
      `select conname from pg_constraint
        where contype = 'c' and conname like '%\\_not\\_ancient'`,
    )) as { conname: string }[];
    check(
      revived.length === 0,
      'no time-relative CHECK has come back to break the next restore',
      revived.length === 0 ? 'none' : revived.map((r) => r.conname).join(', '),
    );

    // --- 6. the part that is not covered ------------------------------------
    const users = (await run('select count(*)::int as n from auth.users')) as { n: number }[];
    console.log('');
    console.log(`  Outside this drill: ${users[0]?.n ?? '?'} accounts in auth.users, every Storage`);
    console.log('  object, and point-in-time recovery. See docs/backup-and-restore.md.');
  } finally {
    await run(`drop schema if exists ${SHADOW} cascade`).catch(() => {});
    await close();
    if (!keep && !explicitOut) {
      rmSync(outDir, { recursive: true, force: true });
      console.log('  Extract deleted.');
    } else {
      console.log(`  Extract left at ${outDir}. It holds personal information — remove it.`);
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`  ${failures} of ${checks} checks failed.\n`);
    process.exit(1);
  }
  console.log(`  ${checks}/${checks} checks passed.\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
