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
| `ECE_ALLOWED_ORIGINS` | no | optional | Only if writes fail after deploy — see step 5 |

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
D=https://<your-service>.up.railway.app

curl -s $D/api/health                        # {"ok":true}
curl -sI $D/login | grep -iE 'content-security-policy|strict-transport|x-frame|referrer'
curl -s -o /dev/null -w '%{http_code}\n' $D/ # 307 → /login when signed out
```

1. **Health.** `{"ok":true}`.
2. **Security headers on the public origin.** CSP with a `nonce-`, `X-Frame-Options: DENY`,
   `Referrer-Policy: same-origin`, HSTS. These are set in middleware, so they are only
   present on what the matcher covers — that is every route and no static asset.
3. **Signed out lands on `/login`**, and the page renders rather than erroring. If it renders
   but the browser console shows CSP violations, the nonce is not reaching Next's inline
   scripts; the e2e suite has a test for exactly that (`the page loads with no CSP
   violation`) and it passes locally.
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
| `SITE_CANONICAL_HOST` | **leave unset at first** | `www.littlepearls.org.nz` — but only once that domain resolves to this service. See the warning below |
| `SITE_ORIGIN` | recommended | `https://www.littlepearls.org.nz`. Absolute URLs in Open Graph, `robots.txt` and the sitemap |
| `SITE_APP_URL` | optional | Where "Sign in to the centre app" points. Defaults to the platform's Railway hostname |

**No Supabase variables. No service-role key. No anon key.** `apps/site` has no `@supabase/*`
dependency and no `@ece/api` path in its tsconfig, so there is nothing for a credential to be used
by — verified by building it with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` all unset from the environment, which succeeds.

That is why the build command is `npm run build:site` (core, then site) rather than the root
`npm run build`. The root chain includes `apps/web`, whose `next build` needs the two
`NEXT_PUBLIC_` values *at build time* — so a site service running the root build would need
Supabase variables set on it, and Nixpacks bakes every Railway variable into the image as
`ARG`/`ENV`. The public container would ship with database credentials in its layers.

All three variables **fail soft**, so `/api/health` returns 200 with `usingDefaultsFor` naming any
that are unset. Refusing traffic over a canonical-URL setting would take a working website offline
to complain about a redirect.

> ### Do not set `SITE_CANONICAL_HOST` before the domain points here
>
> **This failed the first deploy of this service**, and the failure was mine — an earlier version of
> this page recommended setting it straight away.
>
> The middleware 308s any request whose host is not the canonical one. Set to
> `www.littlepearls.org.nz` before that domain is attached, it redirects **the working Railway URL**
> to a hostname that does not resolve, so the site is unreachable in a browser — and it redirected
> the health check too, which is what actually broke the deploy: eight probes failed with "service
> unavailable" and the replica never became healthy, while the container itself had logged
> `Ready in 359ms` and was serving fine on port 8080.
>
> `/api/health` is now exempt from the redirect, so a health check always answers locally. But the
> browser-facing half is a sequencing rule, not a code fix:
>
> 1. Deploy with `SITE_CANONICAL_HOST` **unset**. The service is reachable at its
>    `*.up.railway.app` hostname.
> 2. Attach the custom domain and wait for Railway to report the DNS as resolving.
> 3. *Then* set `SITE_CANONICAL_HOST`, and confirm the Railway hostname 308s to the real one.
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

It has no database access, so it publishes no fees, no capacity, no roll and no news — see
[`apps/site/CONTENT-GAPS.md`](../apps/site/CONTENT-GAPS.md) for what is still to come from the
centre, and [public-website](../llm-wiki/wiki/public-website.md) for why the enquiry form and
platform news were deliberately not built.

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
