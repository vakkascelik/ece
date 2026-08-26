/**
 * Stage C of docs/dns-cutover-littlepearls.md — cut mail loose from the apex.
 *
 * PLANS BY DEFAULT. WRITES ONLY WITH --apply.
 *
 * This is the change the whole cutover exists to make safe. Until it runs, the apex A record is
 * load-bearing for mail three ways at once: it is the MX target, and SPF's `+a` and `+mx` both
 * resolve through it. Move the website while that is true and the centre's email goes to a
 * container with no SMTP listener — silently, with no bounce, until a parent says a reply never
 * arrived.
 *
 * WHY `mail` HAS TO BECOME AN A RECORD AND NOT STAY A CNAME
 *
 * It is a CNAME to the apex today, which is why the first draft of the runbook was wrong: pointing
 * the MX at `mail.` while `mail.` is a CNAME to the apex leaves the MX following the apex exactly
 * as before. The fix only works if `mail` resolves independently. RFC 2181 also forbids a CNAME as
 * an MX target, so it had to change regardless.
 *
 * `smtp` and `ftp` get the same treatment, not because anyone is known to use them, but because
 * preserving costs one record each and finding out costs seven conversations and still ends on
 * "probably". cPanel's own client settings hand out `mail.` for both SMTP and IMAP and never
 * mention `smtp.` — so the residual is one person who typed it from memory years ago, and the
 * failure they would hit is the nasty kind: outbound stops while inbound keeps working, so they
 * report "email is fine" while the Outbox fills.
 *
 * THE SPF REWRITE PRESERVES COVERAGE EXACTLY
 *
 *   before   +a → 74.124.203.191 | +mx → 74.124.203.191 | ip4 192.145.239.251 | include
 *   after         +mx → 74.124.203.191 | ip4 74.124.203.191 | ip4 192.145.239.251 | include
 *
 * `+a` is replaced by the literal it resolves to. No sending host loses authorisation. It has to
 * go before Stage D, because at Stage D `+a` starts meaning "Railway's shared edge may send mail
 * as this domain" — which is the defect already live on the sibling domain pif.org.nz.
 */

import { Resolver } from 'node:dns/promises';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_NAME = process.env.CPANEL_ZONE ?? 'littlepearls.org.nz';
const APPLY = process.argv.includes('--apply');

/** The InMotion box. Everything mail-related keeps pointing here; only the website moves. */
const MAIL_IP = '74.124.203.191';
const MAIL_HOST = `mail.${ZONE_NAME}`;
const NEW_SPF = `v=spf1 +mx +ip4:${MAIL_IP} +ip4:192.145.239.251 include:smtp.servconfig.com ~all`;

if (!TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN in .env.migration.');
  process.exit(1);
}

type Change = {
  match: (r: Rec) => boolean;
  to: Partial<Rec> & { type: string };
  why: string;
};
type Rec = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
  data?: Record<string, unknown>;
};

const CHANGES: Change[] = [
  {
    match: (r) => r.type === 'CNAME' && r.name === MAIL_HOST,
    to: { type: 'A', name: MAIL_HOST, content: MAIL_IP },
    why: 'the MX target must resolve independently of the apex — the whole point of this stage',
  },
  {
    match: (r) => r.type === 'CNAME' && r.name === `smtp.${ZONE_NAME}`,
    to: { type: 'A', name: `smtp.${ZONE_NAME}`, content: MAIL_IP },
    why: 'preserved rather than investigated; would otherwise follow the apex to Railway',
  },
  {
    match: (r) => r.type === 'CNAME' && r.name === `ftp.${ZONE_NAME}`,
    to: { type: 'A', name: `ftp.${ZONE_NAME}`, content: MAIL_IP },
    why: 'same',
  },
  {
    match: (r) => r.type === 'MX' && r.name === ZONE_NAME,
    to: { type: 'MX', name: ZONE_NAME, content: MAIL_HOST, priority: 0 },
    why: 'off the apex, onto a name that will not move at Stage D',
  },
  {
    match: (r) => r.type === 'TXT' && r.name === ZONE_NAME && r.content.includes('v=spf1'),
    to: { type: 'TXT', name: ZONE_NAME, content: NEW_SPF },
    why: '+a replaced by the literal it resolves to, before it starts meaning Railway',
  },
  // The caldav/carddav SRVs point at the apex on cPanel's 2079/2080. They would follow it to
  // Railway, where nothing listens. Repointed rather than investigated, same reasoning as smtp.
  ...['_caldav._tcp', '_caldavs._tcp', '_carddav._tcp', '_carddavs._tcp'].map((label) => ({
    match: (r: Rec) => r.type === 'SRV' && r.name === `${label}.${ZONE_NAME}`,
    to: { type: 'SRV', name: `${label}.${ZONE_NAME}` },
    why: 'cPanel calendar/contact sync; target moved off the apex so it keeps reaching cPanel',
  })),
];

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

  console.log(`Stage C — ${ZONE_NAME}: cut mail loose from the apex\n`);

  const planned: Array<{ rec: Rec; change: Change; body: Record<string, unknown> }> = [];

  for (const change of CHANGES) {
    const rec = recs.find(change.match);
    if (!rec) {
      console.log(`  SKIP  ${change.to.type} ${change.to.name ?? ''} — no matching record found`);
      continue;
    }

    const body: Record<string, unknown> = {
      type: change.to.type,
      name: change.to.name ?? rec.name,
      ttl: 1,
    };
    if (change.to.content != null) body.content = change.to.content;
    if (change.to.priority != null) body.priority = change.to.priority;
    if (change.to.type === 'SRV') {
      // Keep priority/weight/port exactly as they are; only the target moves.
      const d = (rec.data ?? {}) as Record<string, unknown>;
      body.data = { priority: d.priority, weight: d.weight, port: d.port, target: MAIL_HOST };
      delete body.content;
    }
    if (['A', 'AAAA', 'CNAME'].includes(change.to.type)) body.proxied = false;

    const from =
      rec.type === 'SRV'
        ? `${(rec.data as Record<string, unknown>)?.target}`
        : `${rec.priority != null ? `${rec.priority} ` : ''}${rec.content}`;
    const to =
      change.to.type === 'SRV'
        ? MAIL_HOST
        : `${body.priority != null ? `${body.priority} ` : ''}${body.content}`;

    console.log(`  ${rec.type} -> ${change.to.type}  ${(change.to.name ?? rec.name).padEnd(34)}`);
    console.log(`      from: ${from}`);
    console.log(`      to:   ${to}`);
    console.log(`      why:  ${change.why}`);
    planned.push({ rec, change, body });
  }

  if (!APPLY) {
    console.log(`\n${planned.length} changes planned. Nothing written. Re-run with --apply.`);
    return;
  }

  console.log(`\n--apply given. Writing ${planned.length} changes...`);
  let ok = 0;
  for (const { rec, body } of planned) {
    const res = await cf(`/zones/${zone.id}/dns_records/${rec.id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.success) {
      ok++;
      console.log(`  ok    ${body.type} ${body.name}`);
    } else {
      console.log(`  FAIL  ${body.type} ${body.name} — ${JSON.stringify(res.errors)}`);
    }
  }
  console.log(`\n${ok}/${planned.length} applied.`);

  // Verified against Cloudflare's own nameserver rather than a resolver, because a resolver would
  // answer from cache and report the old values as if nothing had happened.
  console.log('\nVerifying against the authoritative server...');
  const boot = new Resolver();
  boot.setServers(['8.8.8.8', '1.1.1.1']);
  const [ns] = await boot.resolve4('harleigh.ns.cloudflare.com');

  const check = async (fn: (r: Resolver) => Promise<string>, label: string) => {
    const r = new Resolver({ timeout: 5_000, tries: 2 });
    r.setServers([ns]);
    try {
      console.log(`  ${label.padEnd(22)} ${await fn(r)}`);
    } catch (err) {
      console.log(`  ${label.padEnd(22)} ERROR ${(err as NodeJS.ErrnoException).code}`);
    }
  };

  await check(async (r) => (await r.resolve4(MAIL_HOST)).join(' '), 'mail A');
  await check(async (r) => (await r.resolve4(`smtp.${ZONE_NAME}`)).join(' '), 'smtp A');
  await check(async (r) => (await r.resolveMx(ZONE_NAME)).map((m) => `${m.priority} ${m.exchange}`).join(' '), 'MX');
  await check(
    async (r) => (await r.resolveTxt(ZONE_NAME)).map((c) => c.join('')).filter((t) => t.startsWith('v=spf1'))[0] ?? '(none)',
    'SPF',
  );
  await check(
    async (r) => (await r.resolveTxt(`default._domainkey.${ZONE_NAME}`)).map((c) => c.join(''))[0]?.slice(0, 30) + '…',
    'DKIM (untouched)',
  );

  console.log('\nTEST MAIL NOW, BOTH DIRECTIONS. At 900s TTL a mistake here is 15 minutes old.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
