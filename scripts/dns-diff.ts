/**
 * The Stage A gate: does Cloudflare answer exactly what InMotion answers?
 *
 * Stage B's whole safety argument is that delegating changes nothing, because the new zone is a
 * copy. That argument is worth precisely as much as this diff. Creating 26 records successfully is
 * not the same as serving 26 correct records — the API accepted them, which says nothing about
 * normalisation, chunked TXT strings, or a target that lost its trailing dot in the wrong
 * direction.
 *
 * Queries both authoritative servers directly rather than through a resolver, because a resolver
 * answers from cache and would happily report agreement between a server it asked and a server it
 * did not.
 */

import { Resolver } from 'node:dns/promises';

const ZONE = process.env.CPANEL_ZONE ?? 'littlepearls.org.nz';

/**
 * Resolved once, because `Resolver.setServers` wants addresses and will not do the lookup itself.
 *
 * Bootstrapped off 8.8.8.8 rather than the system resolver, which refused the query outright on
 * this machine (`ECONNREFUSED`). The nameserver addresses are the one lookup that cannot come from
 * the servers being compared, so it needs a resolver that is neither of them and is known to work.
 */
async function addressOf(host: string): Promise<string> {
  const r = new Resolver();
  r.setServers(['8.8.8.8', '1.1.1.1']);
  const [addr] = await r.resolve4(host);
  return addr;
}

type Check = { name: string; type: 'A' | 'CNAME' | 'MX' | 'TXT' | 'SRV' };

const CHECKS: Check[] = [
  { name: '@', type: 'A' },
  { name: '@', type: 'MX' },
  { name: '@', type: 'TXT' },
  ...['www', 'mail', 'smtp', 'ftp'].map((n) => ({ name: n, type: 'CNAME' as const })),
  ...['webmail', 'autodiscover', 'autoconfig', 'cpanel', 'cpcalendars', 'cpcontacts', 'webdisk', 'whm', 'localhost'].map(
    (n) => ({ name: n, type: 'A' as const }),
  ),
  { name: 'default._domainkey', type: 'TXT' },
  ...['_autodiscover._tcp', '_caldav._tcp', '_caldavs._tcp', '_carddav._tcp', '_carddavs._tcp'].map((n) => ({
    name: n,
    type: 'SRV' as const,
  })),
  ...['_caldav._tcp', '_caldavs._tcp', '_carddav._tcp', '_carddavs._tcp'].map((n) => ({ name: n, type: 'TXT' as const })),
];

/**
 * Normalised to a sorted string so the comparison is about content, not about the order two
 * servers happened to return a record set in — which is allowed to differ and means nothing.
 */
async function lookup(server: string, fqdn: string, type: Check['type'], attempt = 1): Promise<string> {
  /*
   * A FRESH RESOLVER PER QUERY, AND NEVER TWO IN FLIGHT AT ONCE.
   *
   * The first version of this script held one Resolver per nameserver and ran the two sides of
   * each comparison with `Promise.all`. It reported five differences that did not exist —
   * `ESERVFAIL` alternating between the servers, and a `_caldav` SRV supposedly answered with
   * `biz251.inmotionhosting.com`, a target no record in either zone contains. c-ares was matching
   * responses to the wrong in-flight query on a shared handle. nslookup, asked the same questions,
   * showed both zones agreeing exactly.
   *
   * That is the worst failure mode a verification tool can have: it does not fail to catch a
   * problem, it manufactures one — and a gate that cries wolf gets waved through the day it is
   * right. Hence one resolver per query, sequential, and a retry, because a genuine ESERVFAIL and
   * a transient one look identical from here.
   */
  const resolver = new Resolver({ timeout: 5_000, tries: 2 });
  resolver.setServers([server]);

  try {
    switch (type) {
      case 'A':
        return (await resolver.resolve4(fqdn)).sort().join(' ');
      case 'CNAME':
        return (await resolver.resolveCname(fqdn)).sort().join(' ');
      case 'MX':
        return (await resolver.resolveMx(fqdn)).map((m) => `${m.priority} ${m.exchange}`).sort().join(' | ');
      case 'TXT':
        // Each TXT record arrives as an array of 255-byte chunks; joining them is what makes a
        // 400-character DKIM key comparable rather than a comparison of how it was split.
        return (await resolver.resolveTxt(fqdn)).map((chunks) => chunks.join('')).sort().join(' | ');
      case 'SRV':
        return (await resolver.resolveSrv(fqdn))
          .map((s) => `${s.priority} ${s.weight} ${s.port} ${s.name}`)
          .sort()
          .join(' | ');
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'ERR';
    // ENODATA means "this name exists, that type does not" — a legitimate answer, and one both
    // servers should give identically. It is only a mismatch when they disagree about it.
    if (code === 'ENODATA' || code === 'ENOTFOUND') return '(none)';
    // Anything else gets two more goes before it is believed. Three consecutive failures against
    // one authoritative server is a finding; one is weather.
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return lookup(server, fqdn, type, attempt + 1);
    }
    return `ERROR:${code}`;
  }
}

async function main(): Promise<void> {
  const [cfAddr, imAddr] = await Promise.all([
    addressOf('harleigh.ns.cloudflare.com'),
    addressOf('ns1.inmotionhosting.com'),
  ]);

  console.log(`Cloudflare  harleigh.ns.cloudflare.com  ${cfAddr}`);
  console.log(`InMotion    ns1.inmotionhosting.com     ${imAddr}\n`);

  let same = 0;
  const diffs: string[] = [];

  for (const c of CHECKS) {
    const fqdn = c.name === '@' ? ZONE : `${c.name}.${ZONE}`;
    // Sequential, not Promise.all — see the note in lookup().
    const a = await lookup(cfAddr, fqdn, c.type);
    const b = await lookup(imAddr, fqdn, c.type);
    const label = `${c.type.padEnd(5)} ${c.name}`;

    if (a === b) {
      same++;
      console.log(`  ok    ${label}`);
    } else {
      diffs.push(label);
      console.log(`  DIFF  ${label}`);
      console.log(`          cloudflare: ${a}`);
      console.log(`          inmotion:   ${b}`);
    }
  }

  console.log(`\n${same}/${CHECKS.length} identical.`);
  if (diffs.length) {
    console.log(`\nNOT READY for Stage B. Differences: ${diffs.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nThe zones agree. Delegating changes nothing — Stage B is safe to run.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
