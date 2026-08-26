/**
 * Stage D of docs/dns-cutover-littlepearls.md — the web flip.
 *
 * PLANS BY DEFAULT. WRITES ONLY WITH --apply.
 *
 * Two records. This is the only stage the public sees: the 2018 Adobe Muse site stops being what
 * littlepearls.org.nz serves, and the Next app on Railway starts.
 *
 * WHY THIS IS SAFE TO DO TO MAIL, WHICH IT WOULD NOT HAVE BEEN AN HOUR AGO
 *
 * Stage C moved every mail dependency off the apex: `mail` is its own A record, the MX points at
 * it rather than at the apex, and SPF names both IPs literally instead of deriving one from `+a`.
 * Before that, this change would have taken the centre's email down silently. Verified in both
 * directions after Stage C, by the owner, before this ran.
 *
 * THE APEX BECOMES A CNAME, WHICH IS NORMALLY ILLEGAL
 *
 * A CNAME at a zone apex cannot coexist with other record types under RFC 1034, and this apex
 * carries MX and TXT that mail depends on. Cloudflare's CNAME flattening resolves the target and
 * serves synthesised A records, so the apex answers as an address while keeping its MX and TXT.
 * That is the specific capability that put Cloudflare in this plan: Railway publishes no static IP
 * and supports no A record, and neither cPanel nor Crazy Domains can flatten.
 *
 * PROXY OFF. NOT NEGOTIABLE.
 *
 * Orange cloud deadlocks Railway's Let's Encrypt issuance and the host 404s — already lived
 * through once on salixtech.co.nz, and Railway's docs say the same independently.
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_NAME = process.env.CPANEL_ZONE ?? 'littlepearls.org.nz';
const APPLY = process.argv.includes('--apply');

/** Issued by Railway when the custom domains were attached. One target per hostname, not per service. */
const APEX_TARGET = 'a8po7i7y.up.railway.app';
const WWW_TARGET = '57ajsiwm.up.railway.app';

if (!TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN in .env.migration.');
  process.exit(1);
}

type Rec = { id: string; type: string; name: string; content: string; proxied?: boolean };

async function cf(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(45_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const zoneRes = await cf(`/zones?name=${ZONE_NAME}`);
  const zone = (zoneRes.result as Array<{ id: string }>)?.[0];
  if (!zone) {
    console.error(`Zone ${ZONE_NAME} not found.`);
    process.exit(1);
  }

  const recRes = await cf(`/zones/${zone.id}/dns_records?per_page=100`);
  const recs = (recRes.result as Rec[]) ?? [];

  const apex = recs.find((r) => r.name === ZONE_NAME && (r.type === 'A' || r.type === 'CNAME'));
  const www = recs.find((r) => r.name === `www.${ZONE_NAME}` && (r.type === 'A' || r.type === 'CNAME'));

  if (!apex || !www) {
    console.error(`Could not find both apex and www records. apex=${!!apex} www=${!!www}`);
    process.exit(1);
  }

  console.log(`Stage D — ${ZONE_NAME}: the web flip\n`);
  console.log(`  ${apex.type} -> CNAME  ${ZONE_NAME.padEnd(30)}`);
  console.log(`      from: ${apex.content}   (InMotion, the 2018 site)`);
  console.log(`      to:   ${APEX_TARGET}   (Railway, flattened)`);
  console.log(`  ${www.type} -> CNAME  www.${ZONE_NAME.padEnd(26)}`);
  console.log(`      from: ${www.content}`);
  console.log(`      to:   ${WWW_TARGET}`);
  console.log(`\n  Untouched, and this is the point: mail, smtp, ftp, webmail, autodiscover,`);
  console.log(`  autoconfig, cpanel, cpcalendars, cpcontacts, webdisk, whm, MX, SPF, DKIM.`);

  if (!APPLY) {
    console.log('\nPlan only. Nothing written. Re-run with --apply.');
    console.log('Rollback afterwards: apex back to A 74.124.203.191, www back to CNAME littlepearls.org.nz.');
    return;
  }

  console.log('\n--apply given.');
  for (const [rec, target, label] of [
    [apex, APEX_TARGET, ZONE_NAME],
    [www, WWW_TARGET, `www.${ZONE_NAME}`],
  ] as Array<[Rec, string, string]>) {
    const res = await cf(`/zones/${zone.id}/dns_records/${rec.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'CNAME', name: label, content: target, ttl: 1, proxied: false }),
    });
    console.log(res.success ? `  ok    CNAME ${label} -> ${target}` : `  FAIL  ${label} — ${JSON.stringify(res.errors)}`);
  }

  console.log('\nRailway will now validate ownership and issue certificates; that takes a minute or two.');
  console.log('HTTPS to the real domain may fail during that window. It is not a rollback signal yet.');
  console.log('\nTHEN TEST MAIL AGAIN, BOTH DIRECTIONS. The apex just moved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
