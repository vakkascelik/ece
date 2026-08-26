/**
 * Stage A of docs/dns-cutover-littlepearls.md — build the Cloudflare zone as an exact copy of
 * what InMotion serves, so that delegating it changes nothing.
 *
 * PLANS BY DEFAULT. WRITES ONLY WITH --apply.
 *
 * The zone is derived from `.audit/zone.json`, which came off the server itself, rather than from
 * a hand-typed table. That is the whole point: the first draft of the runbook was written from
 * outside-in probing and got `mail` wrong — it is a CNAME to the apex, not an A record, and the
 * mail fix built on that mistake would have silently broken the centre's email. A generated plan
 * cannot make that class of error, because it never retypes anything.
 *
 * WHY THE COPY INCLUDES RECORDS WE INTEND TO CHANGE
 *
 * `mail` stays a CNAME here. The SPF keeps its `+a`. The MX still points at the apex. All three
 * are wrong and all three are fixed in Stage C — *after* delegation, as a separate, separately
 * verifiable change. Fixing them here would mean the delegation and the mail change land together,
 * and a mail failure would then have two candidate causes and no clean rollback.
 *
 * WHAT IS DELIBERATELY NOT COPIED
 *
 * SOA and NS: Cloudflare owns those for a zone it is authoritative for, and copying InMotion's
 * would be both rejected and meaningless.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const ZONE = process.env.CPANEL_ZONE ?? 'littlepearls.org.nz';
const APPLY = process.argv.includes('--apply');

if (!TOKEN || !ACCOUNT) {
  console.error('Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in .env.migration.');
  process.exit(1);
}

type Rec = {
  type: string;
  name: string;
  content?: string;
  priority?: number;
  data?: Record<string, unknown>;
  ttl: number;
  proxied?: boolean;
  comment?: string;
};

const b64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

/** Read the served zone as captured by `npm run audit:cpanel`. */
function readAuditedZone(): Array<{ name: string; ttl: number; type: string; values: string[] }> {
  const raw = JSON.parse(readFileSync(join(process.cwd(), '.audit', 'zone.json'), 'utf8'));
  const lines: unknown[] = raw?.data ?? [];
  const out: Array<{ name: string; ttl: number; type: string; values: string[] }> = [];

  for (const l of lines as Array<Record<string, unknown>>) {
    if (l.type !== 'record') continue;
    const type = String(l.record_type ?? '');
    if (type === 'SOA' || type === 'NS') continue; // Cloudflare owns these
    const dnameRaw = String(l.dname ?? '');
    // cPanel writes bare labels for subdomains and the FQDN (with trailing dot) for the apex.
    const name = dnameRaw.endsWith('.') ? dnameRaw.slice(0, -1) : `${dnameRaw}.${ZONE}`;
    const values = ((l.data_b64 as string[]) ?? []).map(b64);
    out.push({ name, ttl: Number(l.ttl ?? 900), type, values });
  }
  return out;
}

/**
 * `localhost A 127.0.0.1` is a cPanel artefact. It is copied rather than dropped, because Stage A's
 * contract is "byte-identical", and a copy that quietly improves things is not a copy — it is an
 * untested change wearing a copy's clothes. Delete it in Stage F if anyone cares.
 */
function toCloudflare(rows: ReturnType<typeof readAuditedZone>): Rec[] {
  const recs: Rec[] = [];

  for (const r of rows) {
    const ttl = r.ttl === 900 ? 1 : r.ttl; // 1 = "Auto" in Cloudflare; matches how pif.org.nz is set
    const v = r.values;

    switch (r.type) {
      case 'A':
      case 'AAAA':
        recs.push({ type: r.type, name: r.name, content: v[0], ttl, proxied: false });
        break;
      // Trailing dot stripped: a zone file writes the FQDN as `littlepearls.org.nz.` and Cloudflare
      // wants it bare. It normalises the dotted form today, which is exactly why it is worth
      // removing here — a silently-normalised value is one the Stage A diff cannot compare cleanly.
      case 'CNAME':
        recs.push({ type: r.type, name: r.name, content: stripDot(v[0]), ttl, proxied: false });
        break;
      case 'MX':
        recs.push({ type: 'MX', name: r.name, content: stripDot(v[1]), priority: Number(v[0]), ttl });
        break;
      case 'TXT':
        // cPanel splits a long TXT into 255-byte chunks; they are one logical string and must be
        // rejoined. Sending the chunk boundary through as separate quoted strings is how a DKIM
        // key ends up unparseable and `dkim=fail` goes unnoticed for a week.
        recs.push({ type: 'TXT', name: r.name, content: v.join(''), ttl });
        break;
      case 'SRV':
        recs.push({
          type: 'SRV',
          name: r.name,
          ttl,
          data: {
            priority: Number(v[0]),
            weight: Number(v[1]),
            port: Number(v[2]),
            target: stripDot(v[3]),
          },
        });
        break;
      default:
        console.warn(`  ! unhandled record type ${r.type} on ${r.name} — add it by hand`);
    }
  }
  return recs;
}

const stripDot = (s: string) => (s?.endsWith('.') ? s.slice(0, -1) : s);

async function cf(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(45_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const rows = readAuditedZone();
  const recs = toCloudflare(rows);

  console.log(`Stage A — ${ZONE} as an exact copy of what InMotion serves`);
  console.log(`${recs.length} records, every one DNS-only.\n`);

  const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n);
  for (const r of recs) {
    const val = r.data
      ? `${r.data.priority} ${r.data.weight} ${r.data.port} ${r.data.target}`
      : `${r.priority != null ? `${r.priority} ` : ''}${r.content}`;
    console.log(`  ${pad(r.type, 6)} ${pad(r.name, 34)} ${pad(r.ttl === 1 ? 'auto' : r.ttl, 6)} ${String(val).slice(0, 78)}`);
  }

  const changesLater = recs.filter(
    (r) =>
      (r.type === 'CNAME' && r.name === `mail.${ZONE}`) ||
      r.type === 'MX' ||
      (r.type === 'TXT' && String(r.content).startsWith('v=spf1')),
  );
  console.log(`\nCopied deliberately wrong, fixed in Stage C after delegation (${changesLater.length}):`);
  for (const r of changesLater) console.log(`  ${r.type} ${r.name}`);

  if (!APPLY) {
    console.log('\nPlan only. Nothing was created. Re-run with --apply to create the zone and these records.');
    return;
  }

  console.log('\n--apply given. Creating zone...');
  const created = await cf('/zones', {
    method: 'POST',
    body: JSON.stringify({ name: ZONE, account: { id: ACCOUNT }, type: 'full' }),
  });
  if (!created.success) {
    console.error('Zone creation failed:', JSON.stringify(created.errors));
    process.exit(1);
  }
  const zoneId = (created.result as { id: string }).id;
  const ns = (created.result as { name_servers: string[] }).name_servers;
  console.log(`  zone ${zoneId}`);
  console.log(`  nameservers: ${ns.join(', ')}   <- these go into Crazy Domains at Stage B\n`);

  let ok = 0;
  for (const r of recs) {
    const body: Record<string, unknown> = { type: r.type, name: r.name, ttl: r.ttl };
    if (r.content != null) body.content = r.content;
    if (r.priority != null) body.priority = r.priority;
    if (r.data != null) body.data = r.data;
    if (['A', 'AAAA', 'CNAME'].includes(r.type)) body.proxied = false;

    const res = await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body: JSON.stringify(body) });
    if (res.success) {
      ok++;
      console.log(`  ok    ${r.type} ${r.name}`);
    } else {
      console.log(`  FAIL  ${r.type} ${r.name} — ${JSON.stringify(res.errors)}`);
    }
  }
  console.log(`\n${ok}/${recs.length} records created.`);
  console.log('Zone is NOT delegated. Diff it against ns1.inmotionhosting.com before Stage B.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
