# Deploying to Railway

The web app only. The mobile app ships through EAS to the stores and talks to the same
Supabase project directly — Railway is not in its path at all.

Nothing here has been deployed yet. Every command below has been run or tested locally
except the ones that need a Railway project, and those are marked.

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

**Root directory: the repository root**, not `apps/web`. The build needs the workspace root
for `npm ci` to link `@ece/core` and `@ece/api`; pointing it at `apps/web` produces a
"cannot find module '@ece/core'" that looks like a code fault.

Railway reads `railway.json` and will use:

```
build   npm ci --include=dev && npm run build
start   npm run start -w @ece/web
health  /api/health
```

`--include=dev` is not redundant — see the note in `railway.json`. Nixpacks sets
`NODE_ENV=production`, under which npm omits devDependencies, and this build needs
`typescript`, `@types/react` and `@types/node`. The failure without it reads as a TypeScript
error in the application, which sends you looking in the wrong place.

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

*Last updated 2026-08-05. Not yet deployed: steps 1 and 3 need a Railway project. Steps 2, 4
and 5 have been prepared and the commands tested — the build has been run with no env file
present and the health route verified returning both 200 and 503.*
