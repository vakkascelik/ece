# DNS cutover — littlepearls.org.nz to Railway

Moving the website from InMotion shared hosting to the `little-pearls` Railway service, with DNS
moving to Cloudflare on the way. **Mail stays on InMotion and the InMotion account is not
cancelled.** Decided by the owner, 2026-08-26.

**REVISED 2026-08-26 after a read-only cPanel audit** (`npm run audit:cpanel`, 11 of 13 UAPI calls
answered). The first draft of this plan was written from outside, against public DNS. The audit
contradicted it in three places, one of them fatally — see §2. What follows is the corrected plan;
the corrections are recorded rather than quietly edited, because the reasoning that produced the
wrong version is the reasoning that will produce it again.

Nothing here has been executed beyond the read-only audit.

---

## 1. The baseline, from the server rather than from outside

`littlepearls.org.nz` is an **addon domain** on the cPanel account `piforg5`, whose **main domain
is `pif.org.nz`** — the Pearl of the Isles Foundation. Two organisations share one hosting account.
Document root `/home/piforg5/littlepearls.org.nz`.

| Layer | Where it is |
|---|---|
| Registrar | **Crazy Domains**. Created 2012-10-07, updated 2025-10-07, status `ok` |
| Authoritative DNS | **InMotion** — `ns1`/`ns2.inmotionhosting.com` |
| cPanel + outbound mail | `secure251.inmotionhosting.com` = **192.145.239.251** |
| Web + inbound mail | **74.124.203.191** |
| Mailboxes | **14 on this account** — 7 on `littlepearls.org.nz`, 7 on `pif.org.nz`, plus 2 forwarders and 2 autoresponders |
| DNSSEC | **Unsigned.** No DS at the parent |
| CAA | **None**, at the domain or at `org.nz` |
| New site | Live and healthy at `little-pearls-production.up.railway.app` |

The zone as actually served (verified against `ns1` directly, not through a resolver cache):

```
                     TTL     TYPE
@                    900     A       74.124.203.191
www                  900     CNAME   littlepearls.org.nz.
mail                 900     CNAME   littlepearls.org.nz.
smtp                 900     CNAME   littlepearls.org.nz.
ftp                  900     CNAME   littlepearls.org.nz.
webmail              900     A       74.124.203.191
autodiscover         900     A       74.124.203.191
autoconfig           900     A       74.124.203.191
cpanel               900     A       74.124.203.191
cpcalendars          900     A       74.124.203.191
cpcontacts           900     A       74.124.203.191
webdisk              900     A       74.124.203.191
whm                  900     A       74.124.203.191
localhost            900     A       127.0.0.1
@                    900     MX      0 littlepearls.org.nz.
@                    900     TXT     v=spf1 +a +mx +ip4:192.145.239.251 include:smtp.servconfig.com ~all
default._domainkey   900     TXT     v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEF... (2048-bit)
_autodiscover._tcp   900     SRV     0 0 443 cpanelemaildiscovery.cpanel.net.
_caldav._tcp         900     SRV     0 0 2079 littlepearls.org.nz.
_caldavs._tcp        900     SRV     0 0 2080 littlepearls.org.nz.
_carddav._tcp        900     SRV     0 0 2079 littlepearls.org.nz.
_carddavs._tcp       900     SRV     0 0 2080 littlepearls.org.nz.
_caldav._tcp         900     TXT     path=/
_caldavs._tcp        900     TXT     path=/
_carddav._tcp        900     TXT     path=/
_carddavs._tcp       900     TXT     path=/
@                    14400   NS      ns1.inmotionhosting.com.
@                    14400   NS      ns2.inmotionhosting.com.
@                    14400   SOA     ns1... systems-notices... 2022020104 86400 7200 3600000 86400
```

**Nine of those records the outside-in sweep never found**: `whm`, `webdisk`, `cpcalendars`,
`cpcontacts`, `localhost`, and the four caldav/carddav SRV+TXT pairs. That is the blind spot the
first draft warned about, measured.

---

## 2. What the audit changed, and one thing it broke

### 2.1 CORRECTION — the mail fix in the first draft did not work

The first draft said: *"MX from `0 littlepearls.org.nz` to `0 mail.littlepearls.org.nz`. That A
record already exists and already points at `74.124.203.191`."*

**There is no such A record.** `mail` is a **CNAME to the apex**, and so are `smtp`, `ftp` and
`www`. The outside-in probe showed `mail.littlepearls.org.nz → 74.124.203.191` and I read that as
an A record; nslookup was reporting the *end* of a CNAME chain, and the `Aliases:` line saying so
was there to be read.

The consequence is that the first draft's fix **fixed nothing**. Repointing the MX at `mail.`
while `mail.` is a CNAME to the apex leaves the MX following the apex exactly as before — so
moving the apex to Railway would still have delivered the centre's email to a container with no
SMTP listener, which is precisely the failure the whole document exists to prevent. It would have
looked done, tested fine while the apex still pointed at InMotion, and broken at the last step.

There is a second reason it has to change: **RFC 2181 forbids an MX target that is a CNAME.**
Plenty of senders tolerate it; some do not, silently.

**The fix:** `mail` must become an **A record** to `74.124.203.191` before the MX points at it.

### 2.2 The TTLs are 900 seconds, not 86400

The first draft built a nine-day timeline around lowering TTLs from 86400 and waiting a day for
each change to age out. That premise was wrong: `86400` is the SOA **minimum** field, which governs
negative caching, not record lifetime. Every record in this zone is already at **900 seconds**, and
the NS records at 14400.

So the TTL-lowering stage disappears entirely, and the plan compresses from nine days to about
three. The soak periods that remain are governed by the NS TTL and the .nz parent's delegation TTL,
neither of which we control.

### 2.3 cPanel's zone and the served zone disagree — so do not edit cPanel

cPanel's local zone file reports SOA serial **`2026021300`**. Both nameservers *and the account's
own box* serve **`2022020104`** — four years earlier. Every record matches; only the serial
diverges.

Untested, and this plan makes it moot rather than investigating it: **the revised sequence never
edits DNS in cPanel at all.** Every change happens in Cloudflare, after delegation. If cPanel's
Zone Editor is in fact writing to a zone nobody serves, we never find out the expensive way.

### 2.4 `pif.org.nz` has already made this exact move — the pattern is proven in this account

Not merely "already on Cloudflare". Measured:

```
pif.org.nz        A      69.46.46.106        → Server: railway-hikari
www.pif.org.nz    CNAME  q2dik2k9.up.railway.app
pif.org.nz        MX     1 smtp.google.com
pif.org.nz        NS     harleigh / mike.ns.cloudflare.com
```

**Cloudflare DNS-only, apex flattened onto Railway, `www` pointed at the Railway target
explicitly** — every structural decision this plan argues for, already made and already working on
the sibling domain. Stages A, B and D are not a new procedure here; they are a repeat.

### 2.5 CORRECTION — the InMotion account is residue, and "don't cancel it" needs a better reason

An earlier revision of this file said cancelling InMotion "would take down a second organisation's
website and seven more mailboxes." **The website half is wrong.**

- `pif.org.nz`'s **website is on Railway**, not here. Its cPanel docroot `/home/piforg5/public_html`
  is abandoned, and two FTP accounts still point at
  `/home/piforg5/public_html/littlepearls`, **a directory that no longer exists**.
- `pif.org.nz`'s **mail is on Google Workspace** (`MX 1 smtp.google.com`), not here. So its seven
  cPanel mailboxes receive nothing; they hold historical mail and no more.

What that leaves: **this account's only live function is Little Pearls' website and Little Pearls'
seven mailboxes.** After Stage D it is one function — mail for one domain.

The reason not to cancel is therefore narrower and sharper than "PIF depends on it": **seven live
mailboxes, plus fourteen mailboxes' worth of historical mail that exists nowhere else.** That is a
mail-archive question, not a hosting question, and it is the right frame for the "email services
later" conversation the owner has deferred.

One thing worth someone's attention on its own schedule: `pif.org.nz`'s SPF is
`v=spf1 +a +mx include:pif.org.nz.spf.auto.dnssmarthost.net ~all`. Its `+a` now resolves to
**Railway's shared edge IP** — the identical defect §2.1 is about, already live on the sibling
domain, authorising a PaaS edge to send mail as PIF. Over-authorisation rather than breakage, so
nothing is failing; it is still wrong, and it is evidence that this failure mode is easy to walk
into.

### 2.6 What else reaches the old site — the hidden-dependency sweep

Asked for explicitly, so it was looked for rather than assumed. Nothing here blocks the cutover;
two items are findings in their own right.

- **No analytics of any kind.** No Google Analytics, no Tag Manager, no Facebook pixel, no
  `google-site-verification` meta tag, no verification file in the docroot, and no verification TXT
  anywhere in the zone. Nothing to migrate — **and no baseline**, so there is no before-and-after
  measurement available for this migration. If that matters, it has to be created now, not after.
- **`.htaccess` contains only the cPanel PHP handler.** No redirects, no rewrites, nothing to carry
  across. The six legacy URLs in §5 really are the whole redirect surface.
- **Directory listings are on.** `/images/`, `/assets/`, `/scripts/` and `/Website Files/` all
  return real Apache "Index of" pages. Ends by itself at Stage D.
- **`Website Files.zip` — 2.5 MB, publicly downloadable** from the site root, verified with a range
  request. The whole site source, served to anyone who guesses the name; Adobe Muse left it there.
  Also ends by itself at Stage D, which is the only reason it is not urgent.
- **`littlepearls.pif.org.nz` does not resolve.** It is a SAN on the account's TLS certificate, the
  classic addon-domain alias, and the classic way a stale copy of a site stays live after a cutover.
  Checked precisely because of that; there is no ghost.
- **Every third-party reference is outbound and unaffected**: Flickr (`/people/littlepearls/` and
  `/photos/littlepearls/`), Instagram, Facebook, Twitter, education.govt.nz, rie.org,
  thepiklercollection.weebly.com, flyingstart.uk.com, maps.google.com, issuu.com. None is an
  embed; nothing breaks when the host changes.
- **Twitter is on the old site and not on the new one.** Facebook, Instagram and Flickr were all
  carried across; Twitter was not. Deliberate or dropped — worth one question to the manager before
  the old site stops being the reference.

### 2.7 Two things the account carries that are not this project's problem, and one that is

- **PHP 7.4** for `littlepearls.org.nz`, **PHP 7.2** for `pif.org.nz`. Both years past end of life
  (7.4 ended November 2022; 7.2 ended November 2020). Not a cutover blocker. After cutover the
  Little Pearls vhost stops serving anything, but **`pif.org.nz` is still on this box on PHP 7.2**,
  and that is worth someone's attention on its own schedule.
- **62 GB used, 166,107 inodes**, with no quota ceiling set on the account.
- **The account is shared with another organisation**, so anything done to `piforg5` — a password
  change, a plan change, a cancellation — reaches `pif.org.nz`'s *mailboxes*. Not its website; see
  §2.5 for what that is actually worth.

---

## 3. The two constraints that still hold

### 3.1 Railway cannot take an apex without CNAME flattening

Railway publishes no static IP and supports no A record: *"Railway supports CNAME Flattening and
dynamic ALIAS records."* InMotion's cPanel Zone Editor has neither; nor does Crazy Domains' DNS.
Cloudflare flattens at the root, which is why it is in this plan.

Flattening does not conflict with mail. Cloudflare synthesises A answers at the apex from the CNAME
target, so `MX` and `TXT` at the apex keep working — the thing that would normally make an apex
CNAME illegal.

### 3.2 The Cloudflare proxy must be off, on every record

Orange cloud deadlocks Railway's Let's Encrypt issuance and the host 404s. This already happened on
`salixtech.co.nz`, and Railway's docs say the same independently. **Grey cloud, everything.**

---

## 4. Two decisions to make first

**DECIDED 2026-08-26 — the philosophy PDF is not republished.** It redirects to `/philosophy`
with the other five. The file itself stays dead: its "shoe-free inside" claim was retracted by the
manager on 2026-08-17, so re-serving it would put a known-false claim back on the live site to
preserve a URL. Shipped — see §5.

**DECIDED 2026-08-26 — the console is not being used for now.** Which changes Stage E, and the
change is worth stating carefully because the pieces are coupled.

`ECE_PORTAL_MOUNT` is what makes `/portal/*` on this site proxy to the console, and clearing it is
a clean switch — `apps/site/next.config.ts` returns no rewrites when it is absent, "switched on and
off by one variable on each service rather than by a revert". But clearing it is **not free**, and
it drags two other things with it:

- `apps/web` runs with `basePath` set to the same value, so the variable has to be cleared on
  **both** services or the console 404s on every page.
- Supabase `site_url` is `https://little-pearls-production.up.railway.app/portal` today. Remove the
  mount without moving it and every invitation and password-reset link lands on a path that no
  longer exists.

**Recommendation: change nothing about the mount during the cutover.** Not because it should stay
— because a DNS cutover and a console reconfiguration failing in the same window give you two
candidate causes and no clean rollback, and clearing the mount is reversible at any time
afterwards. Do it later, deliberately, as its own three-line change.

What that means for Stage E: **item 1 is required, items 2–5 become cheap insurance rather than
mandatory.** Nobody is using the console, so a broken write breaks nothing today; doing them anyway
costs two minutes and means the console is not silently broken the first time somebody does log in.

---

## 5. Pre-flight — code, before any DNS moves

Every URL in the old sitemap 404s on the new site, and there is no redirect map:

```
/index.html                                    404   → /
/our-staff---career.html                       404   → /careers
/contact-us.html                               404   → /contact
/enrolment---fees.html                         404   → /enrolment
/our-centres.html                              404   → /centres
/assets/little-pearls-educare--philosophy.pdf  404   → /philosophy
```

**WRITTEN AND VERIFIED LOCALLY 2026-08-26 — NOT DEPLOYED.** The word "shipped" was wrong in an
earlier revision of this line. The six redirects exist in the working tree and are confirmed in a
local `next build`, but nothing is committed and Railway deploys from GitHub, so the live service
still 404s every one of them (measured, not assumed). **They reach production only when this work
is committed and pushed** — which per AGENTS.md §5 means the wiki leads, not follows. `apps/site/src/lib/legacyRoutes.ts` holds the map and the reasoning for
each mapping; `next.config.ts` calls `legacyRedirects(false)`. Verified in the built
`routes-manifest.json` rather than inferred from a passing test — all six emit as **307**, and they
become permanent in Stage F. `apps/site/src/lib/__tests__/legacyRoutes.test.ts` asserts the map
against the old sitemap and against the routes that actually exist on disk, so a renamed page
breaks the test rather than breaking a redirect in production. 35 tests pass; typecheck clean.

Leave `SITE_CANONICAL_HOST` unset until Stage E — setting it before the domain resolves is how the
preview URL once 307'd to the old website. The canonical host is `www.littlepearls.org.nz`, already
decided: `SITE_ORIGIN` emits it across all nine sitemap entries.

---

## 6. The stages

The shape that the audit produced: **three changes, each one thing, none of them in cPanel.**

Copy the zone → delegate → fix mail → flip web. Every step verified before the next, and every step
rolls back inside 15 minutes because the TTLs are already 900.

### Stage A — build the Cloudflare zone as an exact copy (D-1)

Add `littlepearls.org.nz` to the **existing** Cloudflare account that already holds `pif.org.nz`.

Recreate §1 **exactly as served**, including the parts that are about to change: `MX 0
littlepearls.org.nz`, the SPF with `+a` still in it, `mail`/`smtp`/`ftp`/`www` as CNAMEs to the
apex. **Proxy off on every row.** The point of a copy is that delegating it changes nothing.

Three Cloudflare traps:

- **Do not enable Email Routing.** Cloudflare offers it the moment it sees MX records. Accepting
  *replaces the MX records*, and mail goes to Cloudflare, which has no mailboxes.
- **Do not enable DNSSEC.** Unsigned today, no DS at the parent. Signing mid-cutover adds a failure
  mode that takes the whole domain offline. Fine to do in a quiet month afterwards.
- **The DKIM TXT goes in as one unbroken string.** ~400 characters; public DNS returns it as two
  quoted chunks and pasting the chunk boundary in as literal quotes gives a key that fails to parse.

Verify by querying Cloudflare's assigned nameservers directly and diffing against `ns1`:

```powershell
$cf = "<the pair Cloudflare assigns>"
foreach ($t in "A","MX","TXT","NS","SRV") {
  Resolve-DnsName littlepearls.org.nz -Type $t -Server $cf -DnsOnly
  Resolve-DnsName littlepearls.org.nz -Type $t -Server ns1.inmotionhosting.com -DnsOnly
}
```

Not ready until they agree on everything except SOA and NS.

**Rollback:** delete the zone. It is not delegated; the internet has never seen it.

### Stage B — delegate at Crazy Domains (D-Day)

Replace the nameservers with Cloudflare's pair. No DS to remove — the domain is unsigned.

**Nothing visible should change.** Old site still serving from InMotion, mail still flowing, because
the zone is a copy. This step is only about who answers.

Soak until `Resolve-DnsName littlepearls.org.nz -Type NS -Server 8.8.8.8` returns Cloudflare
everywhere. The NS TTL is 14400, so allow a few hours; the .nz parent's delegation TTL may add more.
**Do not delete the InMotion DNS zone** — it is the rollback.

Re-test mail once it flips: send out to a Gmail address and read `Authentication-Results` for
`spf=pass` and `dkim=pass`; send one in from outside and confirm arrival.

**Rollback:** nameservers back to InMotion. Slow (hours), but total.

### Stage C — fix mail, in Cloudflare (D+1)

Only after Stage B has settled and mail has been tested. This is §2.1, done properly.

| Action | Type | Name | Content |
|---|---|---|---|
| **Replace** | CNAME → **A** | `mail` | `74.124.203.191` |
| **Replace** | CNAME → **A** | `smtp` | `74.124.203.191` |
| **Replace** | CNAME → **A** | `ftp` | `74.124.203.191` |
| **Change** | MX | `@` | `mail.littlepearls.org.nz` priority 0 |
| **Change** | TXT | `@` | SPF below |

```
v=spf1 +mx +ip4:74.124.203.191 +ip4:192.145.239.251 include:smtp.servconfig.com ~all
```

`+a` goes because it will start meaning "Railway" one stage from now. Both IPs are named
explicitly: 74.124.203.191 is what `+a` and `+mx` covered, and 192.145.239.251 is the box's own
outbound address, which the original SPF already trusted enough to hardcode.

**`smtp` and `ftp` become A records too — `74.124.203.191`, same as `mail`.** Not because anyone
is known to use them; because preserving is cheaper than finding out.

cPanel was asked directly what it hands out (`Email::get_client_settings`), and for every mailbox
it recommends **`mail.littlepearls.org.nz` for both directions** — SMTP on 465/587, IMAP on
993/143. It never mentions `smtp.`. So anyone configured from cPanel's own instructions, or through
`autodiscover`/`autoconfig` (both A records, both unaffected), already points at `mail.`, which
this stage fixes anyway.

That leaves one unfalsifiable residual: somebody who typed `smtp.` from memory years ago. Proving
that nobody did means asking seven people and still ending on "probably". Two extra A records
closes it for good, and the failure mode they prevent is the worst kind — **outbound mail stops
while inbound keeps working**, so the user reports "email is fine" while their Outbox fills up.

Same for the four **caldav/carddav SRV records**, which point at the apex on ports 2079/2080. After
Stage D they point at Railway, where nothing listens. Repoint them at a hostname that stays on
InMotion, or delete them — cPanel calendar sync is unlikely to be in use, but it should be a
decision rather than an accident.

**Test mail immediately, both directions, with headers.** At 900s TTL, a mistake here is 15 minutes
old at worst.

**Rollback:** `mail` back to a CNAME, MX back to the apex, SPF back. Minutes.

### Stage D — flip the web (D+2)

**DONE 2026-08-26.** Both domains are attached to the `little pearls` service
(`e4864bed-4016-42e3-ab90-7d2028384176`, project `ece-platform`). Railway issued:

```
littlepearls.org.nz       CNAME  ->  a8po7i7y.up.railway.app
www.littlepearls.org.nz   CNAME  ->  57ajsiwm.up.railway.app
```

Both sit at `CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP` until the CNAMEs point here, which is
expected and is the reason for doing this before the flip rather than during it.

**CORRECTION.** An earlier revision said Railway issues "a CNAME target and a TXT record for each,
both required; a missing TXT is a 404." **It issued no TXT.** Queried directly, each domain returns
exactly one required record — a CNAME with `purpose: DNS_RECORD_PURPOSE_TRAFFIC_ROUTE` — and
ownership is validated through that CNAME. The claim came from Railway's docs and from seeing
`_railway-verify` TXT records in the `pif.org.nz` zone; those are residue from an older validation
flow, not a current requirement. Note also that **the two hostnames get different targets** — one
per custom domain, not one per service.

Then in Cloudflare:

| Action | Type | Name | Content | Proxy |
|---|---|---|---|---|
| **Delete** | A | `@` | `74.124.203.191` | — |
| **Create** | CNAME | `@` | `a8po7i7y.up.railway.app` | **DNS only** |
| **Replace** | CNAME | `www` | `57ajsiwm.up.railway.app` | **DNS only** |

Point `www` at Railway explicitly rather than leaving it aliased to the apex, so a later change to
one does not silently move the other.

```bash
for u in http://littlepearls.org.nz https://littlepearls.org.nz \
         http://www.littlepearls.org.nz https://www.littlepearls.org.nz; do
  curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" "$u"
done
curl -sS https://www.littlepearls.org.nz/api/health
curl -sS -o /dev/null -w "%{http_code}\n" https://www.littlepearls.org.nz/our-centres.html
```

**Then test mail again**, both directions. The apex just changed; this is the moment §2.1 exists
for. `webmail`, `autodiscover`, `autoconfig`, `cpanel` and `webdisk` are all A records and stay
pointing at InMotion on their own, so mail-client autodiscovery survives untouched.

**Rollback:** delete the CNAMEs, recreate `A @ → 74.124.203.191` and `CNAME www → @`. Minutes.

### Stage E — the configuration that follows the domain (D+2, same session)

**Item 1 is required. Items 2–5 are cheap insurance now that the console is not in use** (§4) —
do them anyway, because "nobody uses it yet" is a statement about today.

1. `SITE_CANONICAL_HOST=www.littlepearls.org.nz` on the site service. Then confirm the apex 307s to
   www **and** the `*.up.railway.app` host still returns 200 — both exemptions exist because both
   were broken once.
2. `ECE_ALLOWED_ORIGINS` on the **console** service must include the new host. Its failure mode is
   the nastiest here: every page renders and **every write is refused**, because Next validates a
   server action's `Origin` against the forwarded host and the proxy hides the browser's.
3. Supabase `site_url` → `https://www.littlepearls.org.nz/portal`. **Keep the path.** `deploy:auth`
   once dropped it via `new URL(domain).origin`, which would have landed every invitation on the
   marketing homepage with an auth token attached.
4. **Re-issue one invitation and click it.** The only test that exercises `site_url`, the
   allow-list, the proxy and the console's basePath at once.
5. **Sign a child in on the demo tenant.** The only test that proves item 2.

### Stage F — after a week (D+9)

- **Add DMARC.** Absent today; SPF and DKIM are both correct and testable now. `p=none` with a
  `rua`, read for a month before tightening.
- **Promote the redirects to permanent** — middleware 307 → 308, the six legacy redirects to
  `permanent: true`. Only now: a permanent redirect is cached for the life of a browser profile.
- **Re-snapshot the zone** from Cloudflare and commit it.
- **Do not cancel InMotion.** Seven live Little Pearls mailboxes are there, plus fourteen
  mailboxes' worth of historical mail that exists nowhere else (§2.5). Not the PIF website — that
  left for Railway some time ago.
- **Rotate the cPanel API token.**

---

## 7. The risk that outlives the cutover

After Stage D this account does exactly one live job: mail for `littlepearls.org.nz`. That is a
smaller surface than it was, and it is the surface the deferred "email services later" decision is
about.

Once DNS is at Cloudflare, InMotion can no longer update `mail.littlepearls.org.nz`. If they migrate
the `piforg5` account to a different server — routine, and not always announced — the `mail` A
record and both `ip4:` values in SPF go stale and **mail breaks with no warning and no obvious
cause**, months later, with nobody connecting it to this week.

The audit makes this *more* likely to bite, not less: the account already spans two IPs
(74.124.203.191 and 192.145.239.251), and `biz251.inmotionhosting.com` — the reverse-DNS of the web
IP — already forward-resolves to a third address entirely, so InMotion demonstrably moves things
around.

Confidence it eventually happens: **moderate**. Mitigations, ascending: a monthly check that `mail`
still matches the box cPanel reports; an uptime monitor on 993/465; or move mail off shared hosting
entirely, which is a separate project.

Tell whoever holds the `piforg5` account, in one sentence, that DNS now lives elsewhere.

---

## 8. Timeline

| Day | Stage | Reversible in |
|---|---|---|
| — | Stage 0 — audit | **done** 2026-08-26 |
| D-1 | A — Cloudflare zone as an exact copy | instantly |
| D | B — delegate at Crazy Domains, soak | hours |
| D+1 | C — mail: `mail` to an A record, MX, SPF | minutes |
| D+2 | D — the web flip | minutes |
| D+2 | E — canonical host, allowed origins, `site_url`, a real invitation | minutes |
| D+9 | F — DMARC, promote redirects, rotate the token | — |

Three working days, down from nine, because the TTLs were never 86400.

---

## 9. Before committing this

Per AGENTS.md §5 the wiki leads the commit. A commit adding this file should also touch
[public-website](../llm-wiki/wiki/public-website.md) (the legacy-redirect gap; the domain going
live) and [deployment](../llm-wiki/wiki/deployment.md) (`site_url` and `ECE_ALLOWED_ORIGINS` change
with the host).

One correction belongs upstream in the Salix wiki's `little-pearls-website.md`: it says *"No
DKIM/DMARC record exists at the root."* **DKIM exists** — 2048-bit RSA at cPanel's `default`
selector. Only DMARC is absent. That page also does not record that this domain shares a cPanel
account with `pif.org.nz`, which is now the most important fact about the hosting.

*Written 2026-08-26; revised the same day after the audit. Nothing executed but the audit.*
