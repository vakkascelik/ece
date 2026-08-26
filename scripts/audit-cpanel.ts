/**
 * Read-only inventory of the InMotion cPanel account behind littlepearls.org.nz.
 *
 * Stage 0 of docs/dns-cutover-littlepearls.md. The runbook's record list was assembled from
 * outside, by resolving names somebody thought to guess — which cannot find a record whose name
 * nobody guessed, and certificate-transparency enumeration returned 502 when tried as a second
 * angle. This script replaces that guesswork with the zone the server actually serves.
 *
 * READ-ONLY BY CONSTRUCTION, NOT BY INTENTION
 *
 * `CALLS` is an allowlist of UAPI functions and every one of them is a getter. There is no code
 * path here that writes. That matters more than usual: a cPanel *user* API token cannot be scoped
 * to individual functions the way a WHM token can be restricted by ACL, so the token this runs
 * with carries the full privileges of the account — mailboxes, files, DNS, passwords. The
 * restraint has to live in the client, because the credential does not enforce any.
 *
 * WHY THE OUTPUT IS SPLIT
 *
 * The zone file is infrastructure and belongs in the repo as the diffable baseline the cutover
 * checks against. The mailbox and forwarder inventory is a list of real people's email addresses
 * — personal data, the same category as `.backups/`, which .gitignore already refuses for exactly
 * this reason. So everything lands in `.audit/` (gitignored) and the zone alone is promoted into
 * `docs/` by hand, after somebody has looked at it.
 *
 * FAILURE IS PER-CALL, NOT FATAL
 *
 * Shared hosts disable UAPI modules selectively and cPanel renames functions between major
 * versions. One 404 should not lose the other eleven results, so each call records its own error
 * and the run continues. A summary at the end says what did not answer — an audit that silently
 * returns eleven of twelve findings is worse than one that returns eleven and says so.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = process.env.CPANEL_HOST;
const USER = process.env.CPANEL_USER;
const TOKEN = process.env.CPANEL_TOKEN;
const ZONE = process.env.CPANEL_ZONE ?? 'littlepearls.org.nz';

if (!HOST || !USER || !TOKEN) {
  console.error(
    'Missing credentials. Expected CPANEL_HOST, CPANEL_USER and CPANEL_TOKEN in .env.migration.\n' +
      '\n' +
      '  CPANEL_HOST=biz251.inmotionhosting.com\n' +
      '  CPANEL_USER=<the cPanel username, from File Manager: /home/<username>>\n' +
      '  CPANEL_TOKEN=<Security -> Manage API Tokens -> Create>\n' +
      '\n' +
      'Note CPANEL_USER is the account username, not the token name.',
  );
  process.exit(1);
}

/** Every call is a getter. Adding a setter here defeats the point of the file. */
const CALLS: ReadonlyArray<{ label: string; module: string; fn: string; params?: Record<string, string> }> = [
  { label: 'domains', module: 'DomainInfo', fn: 'list_domains' },
  { label: 'domain-data', module: 'DomainInfo', fn: 'domains_data' },
  { label: 'zone', module: 'DNS', fn: 'parse_zone', params: { zone: ZONE } },
  { label: 'subdomains', module: 'SubDomain', fn: 'list_subdomains' },
  { label: 'mailboxes', module: 'Email', fn: 'list_pops_with_disk' },
  { label: 'forwarders', module: 'Email', fn: 'list_forwarders' },
  { label: 'autoresponders', module: 'Email', fn: 'list_auto_responders' },
  { label: 'ftp-accounts', module: 'Ftp', fn: 'list_ftp' },
  { label: 'cron', module: 'Cron', fn: 'list_lines' },
  { label: 'databases', module: 'Mysql', fn: 'list_databases' },
  { label: 'ssl-hosts', module: 'SSL', fn: 'installed_hosts' },
  { label: 'php-versions', module: 'LangPHP', fn: 'php_get_vhost_versions' },
  { label: 'quota', module: 'Quota', fn: 'get_quota_info' },
];

/**
 * cPanel returns several fields base64-encoded with a `_b64` suffix — `dname_b64`, `txtdata_b64`
 * and friends — because a zone file may hold bytes that are not valid JSON strings. Decoding them
 * in place is what makes the saved output readable rather than a wall of base64, and the raw key
 * is kept so nothing is lost if a decode is ever wrong.
 */
function decodeB64Fields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeB64Fields);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeB64Fields(v);
      if (k.endsWith('_b64') && typeof v === 'string') {
        try {
          out[k.slice(0, -4)] = Buffer.from(v, 'base64').toString('utf8');
        } catch {
          /* leave the raw value; a field that will not decode is a finding, not a crash */
        }
      }
    }
    return out;
  }
  return value;
}

type Result = { label: string; ok: boolean; note?: string };

async function call(c: (typeof CALLS)[number]): Promise<{ result: Result; body: unknown }> {
  const qs = new URLSearchParams(c.params ?? {}).toString();
  const url = `https://${HOST}:2083/execute/${c.module}/${c.fn}${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `cpanel ${USER}:${TOKEN}` },
      signal: AbortSignal.timeout(45_000),
    });

    const text = await res.text();

    if (!res.ok) {
      // 401 here means the username or token is wrong, and it will be wrong for every call —
      // worth saying plainly rather than thirteen times.
      return { result: { label: c.label, ok: false, note: `HTTP ${res.status}` }, body: text.slice(0, 400) };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { result: { label: c.label, ok: false, note: 'non-JSON response' }, body: text.slice(0, 400) };
    }

    // UAPI signals application-level failure inside a 200. `errors` is null on success.
    const errors = (parsed as { errors?: unknown[] | null })?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return { result: { label: c.label, ok: false, note: String(errors[0]) }, body: parsed };
    }

    return { result: { label: c.label, ok: true }, body: decodeB64Fields(parsed) };
  } catch (err) {
    return { result: { label: c.label, ok: false, note: (err as Error).message }, body: null };
  }
}

// Wrapped rather than top-level: this repo's tsx resolves a bare `.ts` through esbuild's CJS
// output, where top-level await is a transform error rather than a runtime one — it fails before
// a single line executes.
async function main(): Promise<void> {
  const outDir = join(process.cwd(), '.audit');
  mkdirSync(outDir, { recursive: true });

  console.log(`cPanel read-only audit — ${USER}@${HOST}, zone ${ZONE}\n`);

  const results: Result[] = [];
  for (const c of CALLS) {
    const { result, body } = await call(c);
    results.push(result);
    writeFileSync(join(outDir, `${result.label}.json`), JSON.stringify(body, null, 2), 'utf8');
    console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${result.note ? ` — ${result.note}` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} calls answered. Written to .audit/`);

  if (failed.length > 0) {
    console.log(`Did not answer: ${failed.map((f) => f.label).join(', ')}`);
    if (failed.every((f) => f.note?.startsWith('HTTP 401'))) {
      console.log('\nEvery call returned 401 — CPANEL_USER or CPANEL_TOKEN is wrong.');
      console.log('CPANEL_USER is the account username (File Manager shows it as /home/<username>),');
      console.log('not the name you gave the token when you created it.');
    }
  }

  console.log('\n.audit/ holds real email addresses. It is gitignored; do not commit it.');
  console.log('Promote .audit/zone.json into docs/ by hand once it has been read.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
