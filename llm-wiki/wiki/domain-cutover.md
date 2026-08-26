# The domain cutover

Moving `littlepearls.org.nz` off InMotion shared hosting onto the `little pearls` Railway service,
with DNS moving to Cloudflare on the way. The operational runbook is
[`docs/dns-cutover-littlepearls.md`](../../docs/dns-cutover-littlepearls.md); this page is what the
work taught, which outlives the runbook.

## Overview

Started 2026-08-26. The first plan was written from outside the server — public DNS probes and the
live site over HTTP — because the standing rule was not to log into a client's hosting account
without an access grant. That plan was wrong in three places, one of them fatally, and every
correction came from a read-only cPanel audit that took ten minutes once a token existed.

The lesson generalises past this domain: **an outside-in DNS survey cannot see record *types*, only
resolved values.** It answers "what does this name resolve to" and is silently unable to answer
"how".

## Key Points

- **`mail`, `smtp`, `ftp` and `www` are CNAMEs to the apex, not A records.** The first plan's mail
  fix — "point the MX at `mail.littlepearls.org.nz`, that A record already exists" — therefore
  fixed nothing: the MX would have kept following the apex to Railway, and the centre's email would
  have gone to a container with no SMTP listener. `nslookup` had reported the *end* of a CNAME
  chain, with an `Aliases:` line that said so and was not read. **RFC 2181 also forbids a CNAME as
  an MX target**, so it had to change regardless.
- **The TTLs were 900 seconds, not 86400.** `86400` was the SOA **minimum** field — negative-cache
  lifetime, not record lifetime. A nine-day plan built around waiting for TTLs to expire collapsed
  to three days. Reading a zone's SOA as if it described its records is an easy and expensive
  misread.
- **cPanel's zone and the served zone disagree.** cPanel reports SOA serial `2026021300`; both
  authoritative nameservers *and the account's own box* serve `2022020104`. Records match, only the
  serial diverges. Left uninvestigated on purpose: the plan was reshaped so that **no DNS change is
  ever made in cPanel**, which makes the question moot rather than answered. If the Zone Editor is
  writing to a zone nobody serves, this project never finds out the expensive way.
- **`littlepearls.org.nz` is an addon domain on `piforg5`, whose main domain is `pif.org.nz`** —
  Pearl of the Isles Foundation. 14 mailboxes on the account, 7 each. Document root
  `/home/piforg5/littlepearls.org.nz`.
- **`pif.org.nz` already made this exact move**, and is the working precedent: Cloudflare DNS-only,
  apex CNAME flattened onto Railway, `www` pointed at its own Railway target, mail on Google
  Workspace. Every structural decision in the runbook is already running on the sibling domain.
- **The InMotion account is residue.** PIF's site is on Railway and its mail is at Google, so its
  seven cPanel mailboxes receive nothing. This account's only live function is Little Pearls' website
  and seven mailboxes — and after the cutover, only the mailboxes. "Do not cancel InMotion" is
  therefore a mail-archive argument, not a hosting one.
- **Railway issues a CNAME per custom domain and no TXT.** Queried directly, each domain returns
  exactly one required record with `purpose: DNS_RECORD_PURPOSE_TRAFFIC_ROUTE`; ownership is
  validated through that CNAME. The `_railway-verify` TXT records in the `pif.org.nz` zone are
  residue from an older flow. The apex and `www` get **different** targets.
- **Railway supports no A record and publishes no static IP**, which is the entire reason Cloudflare
  is in this plan: an apex on Railway needs CNAME flattening, and neither cPanel nor Crazy Domains
  offers it.

## Details

### Preserving beats investigating

`smtp` and `ftp` are cPanel convenience records. The instinct was to ask whether anyone uses them
before letting them break. cPanel was asked instead — `Email::get_client_settings` reports
`mail.littlepearls.org.nz` for **both** SMTP and IMAP on every mailbox, and never mentions `smtp.`
So anyone configured from cPanel's own instructions is safe, and the residual is one person who
typed `smtp.` from memory years ago.

That residual is unfalsifiable: proving nobody did means asking seven people and still ending on
"probably". Two extra A records close it permanently. **The failure they prevent is the worst kind
— outbound mail stops while inbound keeps working**, so the user reports "email is fine" while
their Outbox fills up.

### A verification tool that manufactured failures

`scripts/dns-diff.ts` compares Cloudflare's answers against InMotion's, record by record, and is the
gate Stage B's safety argument rests on. Its first version reported five differences that did not
exist — `ESERVFAIL` alternating between the two servers, and a `_caldav` SRV supposedly answered
with `biz251.inmotionhosting.com`, a target no record in either zone contains.

The cause was one `Resolver` handle per nameserver with both sides of each comparison run under
`Promise.all`; c-ares matched responses to the wrong in-flight query. `nslookup`, asked the same
questions, showed the zones agreeing exactly.

**This is the worst failure mode a verification tool can have.** It did not miss a problem — it
invented one, and a gate that cries wolf gets waved through on the day it is right. The fix is one
resolver per query, strictly sequential, with retries, and the reasoning is in the file so nobody
reintroduces the parallelism as an optimisation.

### Two records that are load-bearing in a way that is not visible locally

`localhost A 127.0.0.1` is copied into Cloudflare along with everything else. It is a pointless
cPanel artefact and it stays, because Stage A's contract is *byte-identical copy* — and a copy that
quietly improves things is not a copy, it is an untested change wearing a copy's clothes.

The four caldav/carddav SRV records point at the apex on ports 2079/2080. They follow the apex to
Railway, where nothing listens. Same reasoning as `smtp`: repoint rather than investigate.

## See Also

- [[public-website]] — the site being moved onto this domain, and the legacy-URL redirects
- [[deployment]] — the two Railway services, the `/portal` mount, and the variables that follow a
  hostname
- [[unverified-claims]] — the cPanel/served-zone serial divergence is recorded there as unchecked

*Last updated: 2026-08-26*
