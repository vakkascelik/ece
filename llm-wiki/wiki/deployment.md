# Deployment

One Railway service serves every centre. The web app is a server-rendered frontend, not a backend —
the backend is Supabase, and it always was.

## Overview

The web app deploys to Railway as a single Next.js process. It holds no data. Supabase remains the
only place anything is stored, and both apps talk to it directly through `packages/api`.

Two things on this page exist because they were asked as questions and the answers were not written
down anywhere: whether the deployment is per-customer (it is not, and cannot be), and what it costs
to put this container on the internet (a key that bypasses every policy).

## Key Points

- **One service, every centre.** Nothing about a centre is in the build — no tenant in an
  environment variable, no centre id in the bundle. **CORRECTED 2026-08-11: "no hostname that
  means anything" has stopped being true.** The console has no domain of its own, so it is now
  proxied onto Little Pearls' website hostname at `/portal`. The *build* is still tenant-free —
  `ECE_PORTAL_MOUNT` is a path, not a customer — but the address families arrive at belongs to one
  customer. See [[#the-console-has-no-domain-so-it-borrows-a-customers]].
- **That mount is dated, and the date is customer #2.** Supabase's `site_url` is a single value for
  the whole project, so while it points at the mount, *every* tenant's invitation and
  password-reset links land on Little Pearls' hostname. Doorway needs a domain before a second
  centre signs up, not before go-live.
- **The Railway service is not a backend.** There are no API endpoints in it beyond a health check;
  it is React Server Components and server actions.
- **The container must hold the service-role key**, so the blast radius of the Railway environment
  is the entire database.
- **Migrations are not part of the deploy**, deliberately. Migrate first, then deploy.
- **A security header made the whole product read-only** — and typecheck, lint and build were clean.
- **The first build failed on a flag defending against a failure that could not happen**, and the
  comment justifying it was wrong in both halves.
- **Every Railway variable is baked into the image** as `ARG`/`ENV`, so image access is key access.
- `site_url` pointed at `localhost:3000`, and every invitation link lands on `site_url`.

## Details

### Why it cannot be one deployment per customer

The other platforms in this account work the opposite way: `shop-platform` and `charity-platform` put
one deployment and one schema per customer, and five live shop storefronts each have their own. That
is right for them — each customer wants their own website on their own domain.

It cannot work here, and the reason is the mobile app. **You cannot publish one App Store binary per
childcare centre.** One app has to serve every centre, so the tenant must be resolved after sign-in
rather than chosen by which deployment you reached. Once that is true for mobile, making web work
differently would mean two tenancy models to keep correct instead of one. See [[tenancy-and-rls]].

Verified rather than asserted: no centre name, id or service number appears in any app code or
environment variable. Every request resolves the tenant from the JWT through live memberships, with
the `ece_centre` cookie as a preference that is re-checked and discarded if no membership backs it.

**Consequence for naming:** do not name the service or a custom domain after the first customer. The
second one would sign in at a URL bearing another centre's name, and by then it is a URL people have
bookmarked and invitation links point at.

**That rule applies to the platform service, and its inverse applies to the other one.** Since
2026-08-06 this repo deploys **two** Railway services: the pooled-tenant app (`apps/web`, from
`railway.json`) and Little Pearls' own public website (`apps/site`, from `railway.site.json`). The
website is single-tenant by decision — it *is* that centre's site, on their own domain — so it must
carry their name. Two things follow, and both are traps:

- **A second service that reads `railway.json` boots the platform**, health-checks it successfully
  on `/api/health`, and serves the app holding children's records on the marketing domain. A green
  deploy pointing at the wrong application. The site service must be configured with
  `railway.site.json` as its config path, and — as below — its root directory must stay the repo
  root or the file is ignored anyway.
- **The claim "nothing about a centre is in the build" is now narrower than it was.** It remains true
  of `apps/web`, which is what it was written about. `apps/site` contains a centre's name, addresses
  and phone numbers as source, because a marketing site is exactly that. See [[public-website]].

**The trade, stated plainly.** Pooled tenancy buys one deployment, one database, one migration, and a
mobile app that can exist at all. It costs two real things: a policy mistake exposes every centre at
once rather than one — which is what the 176-assertion RLS suite is the compensating control for —
and one deploy is a single point of failure for every centre at 7.30am, made worse by there being no
staging environment.

### Railway offers two services, and one of them must be deleted

Workspace detection finds `@ece/web` and `@ece/mobile` and offers a service for each, because
`apps/mobile/package.json` has a `start` script — and that script is `expo start`, a development
bundler rather than a server.

The mobile service must be deleted. A container running it costs money, serves nothing reachable,
and fails the health check forever. It is worth writing down because it does not *look* like a
mistake in the dashboard: the service has a name, a green badge, and sits beside the real one.

The same detection sets the service's root directory to `apps/web`, which has to be changed to the
repository root — and this failure is the silent one. `railway.json` lives only at the root, so from
`apps/web` Railway never sees it, ignores the build command, the start command and the health check
path, and guesses instead. The result is a deploy that looks configured and is not. Separately,
`npm ci` needs the workspace root to link `@ece/core` and `@ece/api` at all.

### The deploy's real cost: a bypass-everything key in a container

`SUPABASE_SERVICE_ROLE_KEY` has to be a Railway variable. The invitation flow calls the GoTrue admin
API to create an account, and **no Postgres function can substitute** — so this is not laziness and
cannot be designed away without dropping self-service invitation acceptance.

That key bypasses every row-level security policy. So the Railway project's member list is now the
list of people who can read every child's medical record, and it should be kept as short as that
sentence implies.

Nothing else in the deploy holds a secret. There is no service-role key in any client bundle, and
[[security-review]] checks that on every run.

### The first build failed on a precaution against a failure that did not exist

The build command was `npm ci --include=dev && npm run build`, and the comment justifying it said
Nixpacks sets `NODE_ENV=production` so npm would omit the `typescript` and `@types` packages that
`next build` needs.

Neither half was true. Nixpacks runs its own install phase — plain `npm ci` — and the log shows it
adding 898 packages against 903 in the lockfile, so dev dependencies were already there. And those
packages are not dev-only in this lockfile; they are reachable through non-dev edges, so an
`--omit=dev` would not have dropped them.

The redundant install is what broke it. `npm ci` deletes `node_modules` first, and the second run hit
a directory the builder still held: `EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'`.

Kept on this page because the shape recurs: a guard written from reasoning about a platform, rather
than from watching the platform, that costs a real failure to protect against an imagined one. The
same instinct produced the `Referrer-Policy` header below, and in both cases one run of the real
thing would have settled it.

### The service-role key is in the image layers, not only the environment

Nixpacks passes every Railway variable into the image as `ARG` and `ENV`, and the build log says so
in as many words — a `SecretsUsedInArgOrEnv` warning naming `SUPABASE_SERVICE_ROLE_KEY`.

So the key sits in the image's layer metadata, readable by anything that can pull or inspect the
image. Railway offers no per-variable build/runtime split to avoid it and the key is genuinely needed
at runtime, so it cannot be moved out. What it changes is the threat model: the blast radius above is
not "people with Railway project access" but **anything that can reach the image**, and a leaked build
artefact is a leaked database.

### Migrations are not in the deploy

A build that migrated would run on every redeploy, in parallel across replicas, with no way to stop
half way. So the schema and the code can disagree, and the rule is **migrate first, then deploy**.
`npm run migrate -- --status` is how you find out whether they agree.

This is stated first in the runbook because getting it wrong is the most likely way to break a deploy
that was working.

### Three things checked rather than assumed — and the third was checked wrong

- **`dotenv-cli` exits 0 on a missing file**, so `dotenv -e ../../.env.local` in the web scripts is
  harmless on a host that has no such file. The obvious "fix" — rewriting the scripts — would have
  been churn for nothing.
- **`next start` reads `PORT`** through commander's `.env('PORT')` and binds `0.0.0.0` by default.
  Tested with `PORT=3999`; it served on 3999.
- **`npm ci` under `NODE_ENV=production` omits devDependencies** — true of npm in general, and
  irrelevant here, which is the distinction that was missed. This page asserted it as a reason for
  `--include=dev`; the first build then failed *on that flag*. See above. The claim was checked
  against npm's documented behaviour rather than against Nixpacks, which runs its own install phase
  and did not prune anything.

The first two were checked by running something. The third was checked by reading. Only the third
was wrong, and that is not a coincidence.

### The health check is about configuration, not liveness

`/api/health` returns `{"ok":true}`, or 503 **naming the missing variable**. It deliberately does not
touch Supabase: a health check that did would turn a blip in a third-party service into a container
restart, so a dependency's outage would become an outage of the deploy's own making.

What it catches is the failure that is actually likely — a missing or misspelled variable — before
traffic is routed, rather than as a 500 on whichever page somebody opens first, minutes after the
deploy reported success, because the Supabase clients throw lazily at the first request that needs
one.

It reports no versions and no values. An unauthenticated endpoint that lists which secrets are
configured is a reconnaissance endpoint.

### A security header that made the product read-only

Worth its own section as a worked example of a control failing by **disabling the product** rather
than by permitting something.

`Referrer-Policy: no-referrer` was correct reasoning: these URLs contain child UUIDs, and a UUID in a
`Referer` header sent to another host is an identifier leaving the building. But Next validates a
server action's `Origin` against the forwarded host, and where `Origin` is absent it falls back to
`Referer` — which that policy strips, so it parsed the string `"null"`.

**Every write in this product is a server action.** The roll rendered, the ratio rendered, and signing
a child in did nothing. `typecheck`, `lint` and `next build` were all clean, and the page looked
perfect. The end-to-end suite was one test away.

`same-origin` keeps the privacy property and the header Next needs. It is asserted as an exact value
in the e2e suite, with the reason, so nobody "hardens" it back.

### Two findings on the Supabase side

**`site_url` was `http://localhost:3000`.** Every invitation and password-reset link GoTrue issues
lands on `site_url` — so without the post-deploy step, a real staff member clicks their invitation and
their browser tries to open a server on their own laptop. `uri_allow_list` is the other half: a
redirect target not on it is **silently replaced** with `site_url`, so the symptom of forgetting it is
a link that appears to work and goes somewhere else.

**`password_min_length` was 6.** The invitation form has always refused anything under ten, so the
product was promising a stronger minimum than the service enforced, and any route that set a password
without going through that form was held to six. Raised to 10.

Both are handled by `npm run deploy:auth`, which is a script rather than a dashboard visit because
configuration that exists only as a sequence of clicks cannot be reviewed, repeated or restored.

### The console has no domain, so it borrows a customer's

`doorway.co.nz` was recorded as available and then found to be registered and lapsing — see
[[unverified-claims]] §19. So the console had two addresses available to it: a
`*.up.railway.app` hostname nobody would type, or somebody else's domain. It now answers at
`/portal` on the Little Pearls website's hostname.

**Railway routes by hostname, not by path.** One address cannot be split across two services at the
platform level, so one of the two containers has to forward, and it must be the one that owns the
hostname families arrive at — the website. `apps/site/next.config.ts` rewrites `/portal/*` to the
console service; `apps/web` runs with `basePath` set to the same prefix.

Four places store that prefix or that hostname, and each one fails differently:

| Where | Wrong or missing gives you |
|---|---|
| `ECE_PORTAL_MOUNT` on **both** services | prefix disagreement → 404 on every console page |
| `healthcheckPath` in `railway.json` | probe 404s → replica never healthy → deploy fails while the container serves fine |
| `ECE_ALLOWED_ORIGINS` on the console | every page renders, **every write is refused** |
| Supabase `site_url` | invitations land on the old host, and off-allowlist redirects are silently rewritten |

**`deploy:auth` dropped the path, and that was a fifth silent failure.** It set `site_url` from
`new URL(domain).origin`, which discards everything after the host — correct while the console owned
its hostname, wrong the moment it was mounted under one. `site_url` would have become the bare host,
and since every invitation and password-reset link lands on `site_url`, a new kaiako would have
arrived at the **marketing homepage** with an auth token attached to a page that has no idea what to
do with it. It reads as a broken email, not a missing path segment, and nothing would have logged
it. The script now keeps the path, and `uri_allow_list` inherits it — a tightening, since a redirect
target outside the console has no business being allowed. Live value is now
`https://little-pearls-production.up.railway.app/portal`.

Worth knowing while this mount stands: the **old** `site_url` was
`https://ece-production-fc07.up.railway.app`, whose root now 404s because `basePath` moved every
route. So any invitation issued before this change is already dead and must be reissued — the
script says so, and here the usual "still points at the old host" is worse than usual.

**`basePath` is what makes one origin work, and stripping the prefix at the proxy would not.** Both
apps otherwise serve their assets from `/_next/`, so the website's chunks would answer the console's
requests — a page that renders and then dies in hydration. `basePath` prefixes the routes *and* the
asset path, which is the whole reason it is the mechanism here.

Five traps, four found by reading rather than by deploying:

1. **`basePath` moves `/api/health`.** Railway hits the literal path in `railway.json`, so the probe
   had to be prefixed or the deploy would have failed its health check with a container that was
   serving the app perfectly — the same shape as the canonical-redirect failure in
   [[public-website]], caught earlier this time.
2. **The website's middleware had to stop running on `/portal`.** Middleware runs *before*
   `next.config` rewrites, so it would have stamped its own nonce'd CSP onto the proxied response
   alongside the console's. Two policies intersect rather than override, and a nonce from a
   different response matches nothing — a blank page on every console route at once.
3. **`rewrites()` is baked into `routes-manifest.json` at build time.** Setting the destination on a
   running service does nothing; it needs a redeploy. Quiet, unlike the others.
4. **Excluding `/portal` from that matcher removed the only `X-Robots-Tag` covering it**, and the
   site's `robots.txt` said `allow: /`. So the console would have been *invited* into search results.
   `apps/web` had no robots handling of any kind — no `robots.txt`, no `noindex` — which was
   survivable only while its hostname was unlinked. It now sends `X-Robots-Tag: noindex, nofollow`
   unconditionally, and the site disallows `/portal`. Both, because `Disallow` stops the crawl and
   `noindex` stops the indexing; a disallowed URL is still listed from an external link.
   A robots route inside `apps/web` would have been published at `/portal/robots.txt` and read by
   nobody — crawlers fetch `/robots.txt` from the host.
5. **The one found by deploying, locally.** `export ECE_PORTAL_MOUNT=/portal` in Git Bash reached
   `next build` as `C:/Program Files/Git/portal` — MSYS2 rewrites POSIX-looking values when it
   spawns a native process. Both builds failed loudly and correctly. A leading slash is now optional
   so a Windows developer can write `portal` and avoid the conversion; Railway is Linux and never
   saw the problem.

**The bare console hostname was a 404, and that was reported rather than predicted.** `basePath`
moves *every* route, so `ece-production-fc07.up.railway.app/` — the address anybody who has opened
this service has bookmarked — started returning Next's 404 while the console sat perfectly happily at
`/portal/login` on the same host. A `redirects()` entry with **`basePath: false`** catches it: with a
basePath set, a request outside it is not routed at all, and a redirect declared in the config is one
of the few things that still sees the unprefixed path. Root only — a tempting `/:path*` would match
the *raw* `/portal/login` and send it to `/portal/portal/login`, a loop on the one route that has to
work. 307 and not 308, for the reason [[public-website]] records at length: a permanent redirect is
cached for the life of a browser profile, so a wrong one cannot be fixed by deploying.

**The console gets a way back out, and it carries no tenant.** The ask was for the Little Pearls
footer on the sign-in page — coral, both addresses, the phone numbers, the social links. That would
put one customer's address book into the pooled build, show it to the second centre that signs up,
and require a console deploy whenever a phone number changes. What went in instead is one line,
`← Back to the website`, linking to **`/`** — relative, so it is Little Pearls on this mount and
centre #2's own site on theirs, with nothing tenant-shaped compiled in.

The load-bearing detail is that it is a plain `<a>` and never `next/link`: `Link` prepends `basePath`,
so `<Link href="/">` resolves to `/portal` and a link meant to leave the console would return to its
own front door. Verified in the shipped HTML, where the anchor is `/` while the script tag beside it
is `/portal/_next/…` — basePath applied to one and deliberately escaped by the other. It lives in a
`login/layout.tsx` rather than the page because `page.tsx` is `'use client'` and a client component
cannot read a non-public environment variable; a `NEXT_PUBLIC_` twin of `ECE_PORTAL_MOUNT` would have
been two variables for one fact.

### The mount cannot learn its own address, and that broke every outbound link

Found by making a real person a manager and discovering he had no way to set a password.

**The pre-existing half.** `auth/confirm/route.ts` built its redirects from `request.url`. Railway
addresses the container internally, so `url.origin` is `https://localhost:8080` — both the success
and the expired path redirected the person to their own machine. Reproduced on the console's **own**
hostname with the website's proxy out of the picture, so it predates the mount by every deploy there
has been. It survived only because no password reset had ever been completed in production.

**The mount's half.** Every route now lives under `/portal`, and a link built from a bare origin
omits it. `NextResponse.redirect(new URL(path, origin))` gets no `basePath`, while `redirect()` from
`next/navigation` does — which is exactly why `/portal/reset-password` redirected correctly and its
neighbour did not. Worth knowing before adding another route handler that redirects.

**Why a configured value, when `originOf()` exists specifically to avoid one.** Because behind the
mount the app genuinely cannot know its public address. The website proxies `/portal/*` by fetching
this service's Railway hostname, so `x-forwarded-host` here is *this* service's host in both cases,
never what the browser typed. That is the same fact that forces `ECE_ALLOWED_ORIGINS` to exist. A
header-derived link would point at `ece-production-fc07…/portal/auth/confirm`, which is **not** on
`uri_allow_list` — and an off-allowlist redirect is silently replaced with `site_url`, so the person
lands on the sign-in page having done nothing, with no error anywhere.

So `publicAppBase()` reads **`ECE_PUBLIC_URL`** and falls back to headers-plus-mount when it is
unset, which is correct for a direct deploy and for localhost. Three call sites moved onto it: the
reset `redirectTo`, the `/auth/confirm` redirects, and the invitation link in `members/actions.ts` —
that last one had been pointing at `…/invite/<token>` with no prefix, which is the marketing site's
404. `originOf()` stays, used only for the same-origin comparison in `sameOriginPath`, which needs a
bare origin or every `next` silently collapses to the fallback.

Verified by consuming real tokens against the running app, not by reading: the success path sets a
session cookie and lands on `…/portal/reset-password`, and `/%5Cevil.com`, `//evil.com` and an
absolute `https://evil.com/x` all fall back to `/reset-password` and stay on the origin — the
backslash bypass [[password-recovery]] documents is still blocked under the change from
`new URL(…)` to string concatenation.

**Those last two changes interact, and the defect is recorded rather than fixed.** On the console's
own Railway hostname the back-link is a loop: `/` there is caught by the redirect above and sent to
`/portal`, which sends you to `/portal/login` — the page you were on. Found by checking the live
deploy, not by reasoning about it.

It cannot be fixed by detecting the host. Through the proxy the console sees its **own** hostname in
both `Host` and `X-Forwarded-Host` — that is the whole reason `ECE_ALLOWED_ORIGINS` is required for
writes — so no header separates "arrived directly" from "arrived through the mount". It is left
alone because on that hostname there is no website to return to, so the label is wrong and the
destination is harmless; and because clearing `ECE_PORTAL_MOUNT` when Doorway gets a domain removes
both the redirect and the link together. Until then the raw Railway hostname is not a supported
entry point: `site_url` and the website both point at the mount.

**The public URL is used, not `ece.railway.internal`.** Railway's private network is IPv6-only and
`next start` binds `0.0.0.0`, so the internal name would refuse every connection and each console
request would 502 while the marketing pages rendered fine. Nothing here has ever used Railway's
private network. Moving to it needs `HOSTNAME=::` and a test, and buys one round trip.

**Two things this arrangement costs, stated rather than discovered later.**

It crosses the boundary `railway.site.json` was written to draw. That image still holds no database
credential, but authenticated console traffic and Supabase session cookies now pass through the
public, unauthenticated container.

And **the e2e suite does not cover the mount.** Playwright resolves `page.goto('/login')` with
`new URL()`, so a leading slash discards any prefix on `baseURL` — exercising the mounted config
would mean rewriting every navigation in about twenty spec files. The suite proves the app still
works *unmounted*. The mount's only coverage is the manual pass: health, a page render, and a real
write through the proxy.

## The scheduler service (0065)

A second Railway service in the same project, configured by `railway.scheduler.json` —
committed for the same reason the web service's config is. It builds only `@ece/core` and
`@ece/api`, runs `npm run schedule:run -- verification-chase` on a daily cron
(`0 20 * * *` — 20:00 UTC is the next New Zealand morning on both sides of daylight
saving), and needs three variables: the Supabase URL, the **service-role key**, and
`ECE_SCHEDULER_LIVE=yes` — without the last, every run is a dry run that prints its plan
and sends nothing.

This is the only deployed process besides the web app that holds the service key, and the
only one that fans out across tenants: `scripts/run-scheduled.ts` iterates centres
explicitly because `service_role` bypasses RLS, so there the loop *is* the boundary — see
[[attendance-verification]] for why the code that holds the key contains no judgement.
`restartPolicyType: NEVER`, because the job is idempotent by construction and a cron that
retries a half-crashed run is a cron that can double-send in the gap between an insert and
its ledger row; the next day's tick re-plans from what actually landed.

**Not yet created in the Railway dashboard.** The config is reviewable here; the service
does not exist until somebody makes it and points it at this file.

## See Also

- [[tenancy-and-rls]] — the boundary that makes one deployment safe
- [[security-review]] — the headers, and what is checked on every run
- [[invitations]] — why the container needs the service-role key
- [[attendance-verification]] — the chase this cron runs, and its ledger
- [[unverified-claims]] — CI has still never run

## The variables that follow a hostname

Set 2026-08-26, ahead of the domain cutover ([[domain-cutover]]).

**`SITE_CANONICAL_HOST=www.littlepearls.org.nz`** on the website service. The long-standing advice
was to leave this unset until the domain resolved, because setting it early once 308'd the Railway
preview URL to the old website it replaces. That advice is now obsolete and the file says so: the
two exemptions in `middleware.ts` — `/api/health` and any `*.up.railway.app` host — mean the
variable does only the job it is good at. Verified after the redeploy: health 200, preview root 200,
neither redirected, and `/api/health` stopped reporting it in `usingDefaultsFor`.

**`ECE_ALLOWED_ORIGINS`** on the console now carries `www.littlepearls.org.nz` and
`littlepearls.org.nz` alongside the Railway host. Purely additive, exact hosts, no wildcard.

**Three variables deliberately not moved yet**: Supabase `site_url`, `SITE_APP_URL` and
`ECE_PUBLIC_URL` all point at `little-pearls-production.up.railway.app/portal`. Repointing them at
the real domain before DNS moves would aim every invitation and password-reset link at a hostname
still serving the **old InMotion site**. They move after the DNS flip, not before. This is the
mirror image of the `SITE_CANONICAL_HOST` trap: one variable is safe early because the code exempts
the preview host, and these three are not because nothing exempts a dead link.

**Custom domains are attached but not resolving.** `littlepearls.org.nz` → `a8po7i7y.up.railway.app`
and `www.littlepearls.org.nz` → `57ajsiwm.up.railway.app`, both at
`CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP` until the CNAMEs point here. Two facts worth keeping:
**Railway issues no TXT record** — one CNAME per domain with `purpose: TRAFFIC_ROUTE`, and ownership
is validated through it — and **the apex and `www` get different targets**, one per custom domain
rather than one per service.

Adding a custom domain silently rewrote `RAILWAY_STATIC_URL` and `RAILWAY_SERVICE_LITTLE_PEARLS_URL`
to `littlepearls.org.nz`, a hostname currently serving the old site. Checked rather than assumed:
nothing in this repo reads either variable. Worth knowing before something starts to.

*Last updated: 2026-08-26*
