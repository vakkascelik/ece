# Deploying to Railway

The web app only. The mobile app ships through EAS to the stores and talks to the same
Supabase project directly — Railway is not in its path at all.

Nothing here has been deployed yet. Every command below has been run or tested locally
except the ones that need a Railway project, and those are marked.

## One service, every centre — not one per customer

**This is not a Little Pearls deployment.** It is *the* deployment, and every centre that ever
uses this product signs in to the same hostname. The question is worth answering in the first
paragraph because the other platforms in this account work the opposite way: `shop-platform`
and `charity-platform` put one deployment and one database schema per customer, and five live
shop storefronts each have their own. That is right for them — each customer wants their own
website on their own domain.

It cannot work here, and the reason is the mobile app. **You cannot publish one App Store
binary per childcare centre.** One app has to serve every centre, so the tenant has to be
resolved after sign-in rather than chosen by which deployment you happened to reach — and once
that is true for mobile, having the web work differently would mean two tenancy models to keep
correct instead of one.

So nothing about a centre is in the build. There is no tenant in an environment variable, no
centre id in the bundle, and no hostname that means anything. Every request resolves the tenant
the same way:

1. the session cookie gives Supabase a JWT, which gives `auth.uid()`;
2. `listMyCentres()` returns the caller's **live** memberships — RLS decides that, not the app;
3. the `ece_centre` cookie picks between them, and it is a **preference, never a grant**: every
   request re-checks it against the memberships and discards a value that is not backed by one.

A second centre is therefore a row in `centres` and a row in `memberships`. Not a deploy, not a
service, not a variable. `npm run onboard` is the whole operation.

### What that means for what you name things

**Do not name the Railway service, or any custom domain, after Little Pearls.** The second
customer would sign in at a URL bearing another centre's name, and by the time that matters it
is a URL people have bookmarked, staff have been trained on, and invitation links in mailboxes
point at.

Name it for the product: service `ece-web`, and later a domain like `app.<yourdomain>.nz`. The
per-centre identity belongs on the screen after sign-in, which is where it already is — the
sidebar shows the centre name and the service number.

### The trade this makes, stated plainly

Pooled tenancy buys one deployment, one database, one migration to apply, and a mobile app that
can exist at all. It costs two things, and both are real:

- **A policy mistake exposes every centre at once**, not one. That is why the RLS suite is 176
  assertions, why it is a separate CI job, and why a red cross there means something different
  from a failing unit test. It is the compensating control for this decision and the reason it
  gets more attention than anything else in the repo.
- **One deploy is a single point of failure for every centre.** A bad release takes everybody's
  roll offline at 7.30am, whereas a per-customer deploy would take one centre offline. There is
  no staging environment yet, which makes that worse rather than theoretical.

## What the deploy is, and what it is not

Railway runs **one Next.js process**. It is not the database, it does not run migrations, and
it holds no data. Supabase remains the only place anything is stored.

That has one consequence worth stating before the steps, because getting it wrong is the most
likely way to break a working deploy:

> **Migrations are applied from a laptop, not by the deploy.** `npm run migrate` is not in the
> build command and must not be: a build that migrates would run on every redeploy, in
> parallel across replicas, with no way to stop it half way. So the schema and the code can
> disagree, and the rule is **migrate first, then deploy**. `npm run migrate -- --status`
> before and after tells you whether they agree.

## Prerequisites

- A Railway account and the repo connected. `railway.json` is committed, so the build and
  start commands come from the repo rather than from the dashboard.
- The Supabase project's URL, anon key and **service-role key**.
- `npm run migrate -- --status` reporting `0 pending`.

## 1. Create the service

New project → Deploy from GitHub repo → `vakkascelik/ece`.

### Railway will offer you two services. Delete one.

Workspace detection finds `@ece/web` **and `@ece/mobile`** and offers a service for each, because
`apps/mobile/package.json` has a `start` script. That script is `expo start` — a development
bundler, not a server.

**Delete the `@ece/mobile` service.** A container running `expo start` costs money, serves nothing
a user can reach, and fails the health check forever. The mobile app ships through EAS to the
stores and talks to Supabase directly; Railway is not in its path at any point.

It will happen again if the project is recreated, and it does not look like a mistake in the
dashboard — the service has a name, a green badge, and sits beside the real one.

### Root directory: the repository root

**Not `apps/web`**, even though the service is named `@ece/web`. Two reasons, and the first is
silent:

- `railway.json` lives at the repository root and **nowhere else**. With the root directory set to
  `apps/web`, Railway never sees it, ignores the build command, the start command and the health
  check path, and guesses instead — a deploy that looks configured and is not.
- The build needs the workspace root for `npm ci` to link `@ece/core` and `@ece/api`. Pointing it
  at `apps/web` produces a "cannot find module '@ece/core'" that reads like a code fault.

Railway reads `railway.json` and will use:

```
build   npm run build
start   npm run start -w @ece/web
health  /api/health
```

Nixpacks runs its own `npm ci` before the build command — do not add a second one; the first
deploy did, and it is why that deploy failed (next section).

### What the first deploy taught us

**The first build failed, on the build command in this repo.** It was
`npm ci --include=dev && npm run build`, justified in a comment claiming Nixpacks sets
`NODE_ENV=production` and would otherwise omit the `typescript` and `@types` packages that
`next build` needs.

Both halves were wrong. Nixpacks runs **its own** install phase — plain `npm ci` — and the build
log shows it adding **898 packages against 903 in the lockfile**, so dev dependencies were already
installed. And `typescript`, `@types/react` and `@types/node` are not dev-only in this lockfile;
they are reachable through non-dev edges, so `--omit=dev` would not have dropped them either.

What the redundant second install did was fail. `npm ci` deletes `node_modules` before
reinstalling, and it hit a directory the builder was still holding:

```
npm error code EBUSY
npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'
```

Belt-and-braces against a failure mode that did not exist, causing one that did. The build command
is now just `npm run build`. If a future builder ever does prune dev dependencies, the fix is the
Railway variable `NPM_CONFIG_INCLUDE=dev` — not a second install.

### The service-role key is baked into the image, not just the environment

The build log carries a Docker linter warning worth reading rather than dismissing:

```
SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data
  (ARG "SUPABASE_SERVICE_ROLE_KEY")
```

Nixpacks passes **every** Railway variable into the image as `ARG` and `ENV`, so the service-role
key is in the image's layer metadata — not only in the running container's environment. Anyone who
can pull or inspect the image can read it, and `docker history` is enough.

There is no per-variable build/runtime split in Railway to avoid this, and the key genuinely is
needed at runtime, so it cannot simply be moved. What it changes is the threat model: **image
access is key access**, which widens the blast radius already described below from "people with
Railway project access" to "anything that can reach the image". Rotate on any suspicion, and treat
a leaked build artefact as a leaked database.

### Region: this service runs in Southeast Asia

The dashboard reports Southeast Asia, and that is a fact the privacy statement has been carrying an
open question about — it currently says to confirm the region before a centre adopts it, because a
New Zealand centre should know whether its children's records are in Sydney, Singapore or Oregon.

Two regions matter and they are not the same: **Supabase** holds the data at rest, and **Railway**
processes it in transit. Both belong on the hosted privacy page, named, before a centre is asked to
adopt anything.

`.nvmrc` pins Node 24.

## 2. Set the variables

| Variable | Secret | Needed at | Why |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | **build and runtime** | Inlined into the browser bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no, by design | **build and runtime** | Shipped to every browser; RLS is what protects the data, not this key |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | runtime | See below |
| `NEXT_PUBLIC_SENTRY_DSN` | no | optional | Without it error reporting is inert, which is a valid choice |
| `ECE_ALLOWED_ORIGINS` | no | optional | Only if writes fail after deploy — see step 5. **Required while the console is mounted**, because the proxy hides the browser's host |
| `ECE_PORTAL_MOUNT` | no | **build and runtime** | The path the console is served under, e.g. `/portal`. Empty means its own root. Next inlines it into the client bundle as `basePath`, so a runtime-only value serves pages at `/portal` whose scripts are fetched from `/` — every asset 404s while the HTML looks perfect |
| `ECE_PUBLIC_URL` | no | runtime | Where the world reaches the console, **including the mount** — `https://little-pearls-production.up.railway.app/portal`. Every password-reset and invitation link is built from it. Behind the proxy the app cannot derive this from headers, which is why it is configured rather than detected |

The two `NEXT_PUBLIC_` values must be present **at build time**, not only at runtime. Next
inlines them into the client bundle, so a deploy that sets them as runtime-only variables
produces a browser bundle pointing at `undefined` — and the server side keeps working, so
the app half-works in a way that is hard to read.

### The service-role key is the real cost of this deploy

That key **bypasses every row-level security policy**. It is in the list because the
invitation flow needs it: accepting an invitation calls the GoTrue admin API to create the
account, and no Postgres function can stand in for that. It is not laziness and it cannot be
designed away without dropping self-service invitation acceptance.

So: **the blast radius of the Railway environment is the entire database, every centre.**
Which means

- everyone with access to the Railway project can read that variable;
- keep the project's member list as short as the list of people who should be able to read
  every child's medical record, because those are now the same list;
- rotate the key if it is ever pasted anywhere — a chat, a terminal somebody screen-shared,
  a support ticket. Supabase → Settings → API. Rotating means updating this variable and
  `.env.local`, and nothing else.

Nothing else in the deploy holds a secret. There is no service-role key in any client
bundle, and the security review checks that on every run.

## 3. Deploy, and watch the health check

Railway will build, start, and poll `/api/health`. That route checks the container booted
**with its configuration** and does not touch the database:

```json
{"ok":true}                                          // 200
{"ok":false,"missing":["SUPABASE_SERVICE_ROLE_KEY"]} // 503, and it names the one
```

A missing variable is the most likely way this deploy fails, and without that route the
symptom is a 500 on whichever page somebody opens first, minutes after the deploy reported
success — because the client constructors throw lazily, at the first request that needs one.

It deliberately does **not** query Supabase. A health check that did would turn a blip in a
third-party service into a container restart, so an outage in a dependency would become an
outage of the deploy's own making.

## 4. Point Supabase Auth at the deployed app

```bash
npm run deploy:auth -- --domain https://<your-service>.up.railway.app
```

As at 2026-08-05 the project's `site_url` was `http://localhost:3000`. **Every invitation and
password-reset link this product issues lands on `site_url`** — so until this runs, a staff
member clicks their invitation and their browser tries to open a server on their own laptop.
The `uri_allow_list` is the other half: a redirect target that is not on it is silently
replaced with `site_url`, so the symptom of forgetting it is a link that "works" and goes to
the wrong place.

The script keeps `localhost:3000` and `exp://**` on the list — development still has to work,
and the Expo scheme carries the mobile app's deep links.

Links issued **before** this change still point at the old `site_url`. Reissue them.

The same script also raised `password_min_length` from **6** to **10**, which is already done.
The invitation form in this app has always refused anything under ten; the service accepted
six, so any route that set a password without going through that form — a recovery link, the
dashboard — was held to the weaker rule. The app's promise and the service's enforcement now
agree, and the service is the one that cannot be bypassed.

## 5. Verify, in this order

The first four are one command each. The fifth is the one that actually matters.

```bash
# P is ECE_PORTAL_MOUNT, or empty when the console is served at its own root.
D=https://<your-service>.up.railway.app
P=/portal

curl -s $D$P/api/health                          # {"ok":true}
curl -sI $D$P/login | grep -iE 'content-security-policy|strict-transport|x-frame|x-robots'
curl -s -o /dev/null -w '%{http_code}\n' $D$P/   # 307 → $P/login when signed out
curl -s -o /dev/null -w '%{http_code}\n' $D/     # 307 → $P, and never a 404
```

> **Every command here asserted an output the console could not produce, for as long as the mount
> had been live.** `basePath` moves *every* route, `/api/health` and `/login` included, so the
> unprefixed forms return Next's 404 — and this page read as a failed deploy on a perfectly healthy
> one. The last line is the redirect that stops the bare hostname 404ing for anybody with the old
> address bookmarked. With no mount configured, set `P=` and the block is what it always was.

1. **Health.** `{"ok":true}`.
2. **Security headers on the public origin.** CSP with a `nonce-`, `X-Frame-Options: DENY`,
   `Referrer-Policy: same-origin`, HSTS. These are set in middleware, so they are only
   present on what the matcher covers — that is every route and no static asset.
3. **Signed out lands on `/login`**, and the page renders rather than erroring. If it renders
   but the browser console shows CSP violations, the nonce is not reaching Next's inline
   scripts.

   > **This instruction was actively misleading until 2026-08-07, and the correction is the
   > useful part.** It used to end "the e2e suite has a test for exactly that (`the page loads
   > with no CSP violation`) and it passes locally." That test visits `/attendance`, which
   > renders per request and always received a nonce. `/login` — the page this step tells you to
   > open — was **prerendered**, and a prerendered page cannot carry a per-request nonce, so
   > every script on it was refused. So the one manual check that would have caught it had been
   > waved off in writing, by this document. Fixed by making every route render per request
   > (see the root layouts of both apps), and there is now a test that actually visits `/login`,
   > `/no-access` and a 404 without a session and asserts hydration really happened.
4. **An invitation link contains the new domain.** Issue one and read it:
   `npm run onboard -- --existing-centre <uuid> --owner <address>`.
5. **A write works.** Sign in and sign a child in on the demo tenant.

   Step 5 is not a formality. Next validates a server action's `Origin` against the
   forwarded host, and **every write in this product is a server action** — attendance,
   consent, invoices, all of them. When that check fails, every page renders perfectly and
   nothing can be saved. This exact class of failure has already happened here once: a
   `Referrer-Policy` of `no-referrer` broke every write in the application during the
   security review, because the origin check falls back to headers a policy or a proxy can
   remove, and `typecheck`, `lint` and `build` were all clean.

   If writes fail with "Invalid Server Actions request", set `ECE_ALLOWED_ORIGINS` to the
   exact host and redeploy. Not a wildcard: an allowlist that is broader than it needs to be
   is a check that has been turned off politely.

## Before this is public, deal with the demo tenant

`npm run seed:demo` creates a parent account and **prints its password**. Once the app is on
the internet, anyone holding that password can sign in and read the demo centre.

The data is fabricated, so the harm is limited — but the password has been printed to a
terminal, and terminals end up in scrollbacks and screenshots. Two acceptable answers:

```bash
ECE_ALLOW_DEMO_SEED=yes npm run seed:demo -- --purge   # remove it entirely
ECE_ALLOW_DEMO_SEED=yes npm run seed:demo              # reseed, new password
```

Keep it if you want a tenant to demonstrate with, and reseed so the printed password is
stale. Purge it if not. The one thing not to do is leave a known password on a public login
page and forget which it belongs to. The demo centres are named `DEMO — … (invented data)`
for the same reason.

**The real tenant holds no child data**, so nothing about Little Pearls is exposed by
deploying. That remains true until professional indemnity insurance is in place — see
[tenant-little-pearls](tenant-little-pearls.md).

## Deploying the public website — a second service

Since 2026-08-06 this repo also holds **Little Pearls' public website** (`apps/site`). It is a
second Railway service in the same project, from the same repository, and everything above about
the platform applies to the platform only.

### The one mistake that is silent

**Set the config path, or the new service boots the platform.** `railway.json` is a single-service
manifest whose `startCommand` is `npm run start -w @ece/web`. A second service that reads it will
build, start, and *pass its health check* while serving the app that holds children's records on
the marketing domain.

Service → Settings → **Config-as-code** → `railway.site.json`.

### 1. Create it

- **New Service → GitHub Repo → the same repo.** Railway's workspace detection will again offer
  a service per workspace; you want one, and its **root directory must be the repository root**,
  not `apps/site`. Same reason as the platform: config-as-code lives at the root, and `npm ci`
  needs the workspace root to link `@ece/core`.
- Set the config path to `railway.site.json` as above.

### 2. Variables — there are no secrets here, and that is the point

| Variable | Needed | Why |
|---|---|---|
> **Copy the value column, not the notes.** `SITE_APP_URL` was once set to the words
> *Where "Sign in to the centre app" points* — the old notes column for that row — which is not a URL,
> so the footer link became a relative path and "Sign in to the centre app" landed on the site's own
> 404 page. The values below are literal and paste as they are. `apps/site/src/lib/site.ts` now
> validates both URL variables and falls back rather than rendering a broken link, and `/api/health`
> reports `setButNotAUrl` when one of them is set to something that is not one — but the doc put the
> two columns side by side, so the doc changed too.

| Variable | Required? | Value to paste |
|---|---|---|
| `SITE_CANONICAL_HOST` | optional | `www.littlepearls.org.nz` |
| `SITE_ORIGIN` | recommended | `https://www.littlepearls.org.nz` |
| `SITE_APP_URL` | optional | `https://little-pearls-production.up.railway.app/portal/login` |

Notes on those three:

- `SITE_CANONICAL_HOST` chooses between www and apex and forces https **on the real domain only** —
  the `*.up.railway.app` hostname is never redirected, so it is safe to set before the domain is
  attached.
- `SITE_ORIGIN` is the origin for absolute URLs in Open Graph, `robots.txt` and the sitemap. No
  trailing slash needed; one is stripped.
- `SITE_APP_URL` is where "Sign in to the centre app" points. Omit it and it defaults to the value
  above, which is correct today — so the safest thing is to leave it unset until the platform has a
  custom domain.
| `SUPABASE_URL` | **required for the careers form** | The same project URL the platform uses |
| `SUPABASE_ANON_KEY` | **required for the careers form** | The **anon** key, never the service-role key |
| `GOOGLE_MAPS_API_KEY` | optional, for the maps | A Google Maps Platform key with the **Maps Static API** enabled |

> ### The maps key, and the two ways it goes wrong
>
> **Unprefixed, for the same reason as the pair above.** The key is used by this container and never
> by a browser: `apps/site/src/lib/staticMap.ts` fetches the picture and `/api/map/<centre>` serves
> the bytes from this origin, which is why the site's CSP still says `img-src 'self' data:` and
> `frame-src 'none'`. A `NEXT_PUBLIC_` prefix would inline the key into client JavaScript, put it in
> front of every reader, and make that whole design pointless.
>
> **Enabling the API is a separate step from creating the key**, and it is the one that catches
> people. "Maps Static API" is its own product in the Google Cloud console — a key that geocodes
> happily will still return **403 with a plain-text body** for a static map. The symptom is a site
> with no maps and no error anywhere on the page, because `CentreMap` renders nothing rather than a
> broken image; the 403 is in the container log, prefixed `[map]`.
>
> **Restrict it and set a budget.** This key is not secret in the sense the service-role key is —
> the worst case is somebody else's map requests on this project's bill — but it is a bill.
> Restrict it to the Maps Static API, and to the Geocoding API only if the coordinates in
> `apps/site/src/lib/centres.ts` ever need redoing.
>
> **Unset is a supported state.** Both pages fall back to what they carried before the maps existed:
> the address in text, "Get directions", and the phone number. `/api/health` reports
> `mapsDisabledFor` so the difference is visible without reading the HTML.

> ### Why those two are unprefixed, and what they can do
>
> **Not `NEXT_PUBLIC_`.** That prefix tells Next to inline the value into client JavaScript, and an
> inlined anon key means the browser can talk to Supabase — at which point this app's
> `connect-src 'self'` no longer describes it and any future page could quietly grow a browser
> query. Unprefixed makes that impossible rather than discouraged: `process.env.SUPABASE_ANON_KEY`
> is `undefined` in a browser.
>
> **The anon key, and never the service-role key.** Holding the anon key lets this container do
> exactly one thing: call `submit_job_application`, which returns void. `anon` has no table grant
> anywhere in `public` and `review:security` fails the build at high severity if that changes. The
> service-role key bypasses RLS on every table and must never be set on this service.
>
> **If they are missing the form fails loudly**, with the careers mailbox offered to the applicant.
> That is deliberate: the state it replaces is their Adobe Muse mailer, which accepted applications
> and silently discarded them.

**No service-role key, ever.** That key bypasses RLS on every table in the database and has no
business in the public container. The site needs the **anon** key and the project URL, both listed
as required in the table above, and nothing else.

> **Corrected 2026-08-07.** This paragraph used to read "No Supabase variables. No service-role
> key. No anon key. `apps/site` has no `@supabase/*` dependency and no `@ece/api` path in its
> tsconfig, so there is nothing for a credential to be used by." That was true until the careers
> form, and it survived twenty lines below a table that marks two Supabase variables **required** —
> a direct contradiction, with the false half in bold, which is the half an operator follows.
>
> An operator who followed it got a green deploy: the build succeeds because the key is only read
> at request time, `/api/health` returns 200 because its soft list covers only the three `SITE_*`
> variables, and all ten pages render. Every applicant then saw "Sorry — we could not save that.
> Please email career@littlepearls.org.nz", and nothing anywhere said why. The mailbox fallback is
> deliberate and means nothing was lost, but the feature was dead with no signal.

That is why the build command is `npm run build:site` (core, then site) rather than the root
`npm run build`. The root chain includes `apps/web`, whose `next build` needs the two
`NEXT_PUBLIC_` values *at build time* — so a site service running the root build would need
Supabase variables set on it, and Nixpacks bakes every Railway variable into the image as
`ARG`/`ENV`. The public container would ship with database credentials in its layers.

All three variables **fail soft**, so `/api/health` returns 200 with `usingDefaultsFor` naming any
that are unset. Refusing traffic over a canonical-URL setting would take a working website offline
to complain about a redirect.

> ### `SITE_CANONICAL_HOST` caused two failures before it was made safe
>
> Both were mine, including an earlier version of this page that told you to set it immediately.
>
> **First it failed the deploy.** The middleware 308'd any request whose host was not the canonical
> one, and Railway's health check hits the container on its internal address — so every probe got a
> 308 instead of a 200. Eight attempts failed with "service unavailable" and the replica never
> became healthy, while the container itself had logged `Ready in 359ms` and was serving on port
> 8080. A working app rejected by its own redirect.
>
> **Then it redirected the preview to the site it replaces.** With the value set before the domain
> pointed here, opening `little-pearls-production.up.railway.app` 308'd to
> `www.littlepearls.org.nz` — the old Adobe Muse site. The new website redirected to the old one,
> and the only escape was remembering to unset a variable.
>
> Two exemptions now, so neither can happen again: **`/api/health` is never redirected**, and
> **`*.up.railway.app` is never redirected**. That hostname is the service's own inspection URL;
> before go-live its target may not resolve, and after go-live the canonical `<link>` tag already
> tells crawlers which URL is real. The variable now does only what it is good at — www versus
> apex, and forcing https on the real domain.
>
> Verified with the variable set, against every host that matters:
>
> ```
> railway URL   /            200          not redirected
> health check  /api/health  200
> apex domain   /            308 -> https://www.littlepearls.org.nz/
> canonical     /            200
> canonical     / over http  308 -> https://www.littlepearls.org.nz/
> ```
>
> Worth knowing if you ever try to be cleverer about this: requiring `x-forwarded-host` to be
> present does **not** distinguish an internal request from a public one, because Next populates
> that header from `Host` when the proxy has not. Measured, not assumed.

### 3. Custom domain — and here the naming rule inverts

The platform must **not** carry a customer's name (see above). This service must: it *is* Little
Pearls' website. Point `littlepearls.org.nz` and `www.littlepearls.org.nz` at it, set
`SITE_CANONICAL_HOST` to whichever you choose as canonical, and the other redirects with a 308.

**Do not change `site_url` in Supabase Auth for this.** That setting is where invitation and
password-reset links land, and those belong to the platform. `npm run deploy:auth` manages it;
the website is not in that flow at all.

### 4. Verify

```bash
curl -s https://<host>/api/health                    # {"ok":true}
curl -sI https://<host>/ | grep -i "content-security\|strict-transport"
curl -s https://<host>/robots.txt
curl -s https://<host>/sitemap.xml | head -5
```

Then, on a phone: the site should reflow rather than zoom out. That is the defect the rebuild
existed to fix, and it is the one thing a desktop browser will not show you.

### What this service does not do

It publishes no fees, no capacity, no roll and no news — see
[`apps/site/CONTENT-GAPS.md`](../apps/site/CONTENT-GAPS.md) for what is still to come from the
centre, and [public-website](../llm-wiki/wiki/public-website.md) for why the enquiry form and
platform news were deliberately not built.

**Corrected 2026-08-06:** this used to say the service has *no database access at all*. Since the
careers form it has exactly one path — the site's **server** calls one `security definer` function
with the anon key. The browser still reaches nothing but the site itself, which is the property the
original sentence was really about. See [recruitment](../llm-wiki/wiki/recruitment.md).

## Rolling back

Railway redeploys a previous build from the deployments list. That rolls back **the code and
nothing else**: the schema stays where it is, and any migration applied since is still
applied. Since migrations here only ever add or tighten, an older build against a newer
schema generally runs — but it is not guaranteed, and `migrate -- --status` is how you find
out what you are actually rolling back onto.

There is no staging environment. A second Railway service against a second Supabase project
would be the honest way to have one, and it does not exist.

## What this deploy does not give you

- **No custom domain.** Railway's generated hostname is fine to start with; a custom domain
  needs DNS and changes `site_url` again (step 4).
- **No point-in-time recovery.** Still up to 24 hours of possible data loss —
  [backup-and-restore](backup-and-restore.md).
- **No CI gate on the deploy.** The GitHub secrets are still unset, so nothing has ever run
  the 176 RLS assertions, the 44 end-to-end checks or the 16 security checks anywhere but a
  laptop. Railway will happily deploy a commit that none of them has seen. **This is the
  thing to fix next**, and it is more valuable than anything else on this page: a deploy
  pipeline in front of an untested boundary is a faster way to publish a mistake.
- **No uptime monitoring, no alerting, no log retention** beyond what Railway keeps.
- **No rate limiting in front of the login page** beyond GoTrue's own defaults, which have
  been read once and never tested.

---

*Last updated 2026-08-06. The platform: steps 1 and 3 need a Railway project; steps 2, 4 and 5 are
prepared and their commands tested. The website service has never been created either — what has
been verified is that `apps/site` builds with every Supabase variable unset, that its ten routes
pass axe at 390px and 1440px, and that its health route, CSP, HSTS, robots.txt and generated
sitemap all respond correctly on a local production server.*
