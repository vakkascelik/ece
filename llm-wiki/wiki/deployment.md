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
  environment variable, no centre id in the bundle, no hostname that means anything.
- **The Railway service is not a backend.** There are no API endpoints in it beyond a health check;
  it is React Server Components and server actions.
- **The container must hold the service-role key**, so the blast radius of the Railway environment
  is the entire database.
- **Migrations are not part of the deploy**, deliberately. Migrate first, then deploy.
- **A security header made the whole product read-only** — and typecheck, lint and build were clean.
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

### Migrations are not in the deploy

A build that migrated would run on every redeploy, in parallel across replicas, with no way to stop
half way. So the schema and the code can disagree, and the rule is **migrate first, then deploy**.
`npm run migrate -- --status` is how you find out whether they agree.

This is stated first in the runbook because getting it wrong is the most likely way to break a deploy
that was working.

### Three things checked rather than assumed, and two needed no change

- **`dotenv-cli` exits 0 on a missing file**, so `dotenv -e ../../.env.local` in the web scripts is
  harmless on a host that has no such file. The obvious "fix" — rewriting the scripts — would have
  been churn for nothing.
- **`next start` reads `PORT`** through commander's `.env('PORT')` and binds `0.0.0.0` by default.
  Tested with `PORT=3999`; it served on 3999.
- **`npm ci` under `NODE_ENV=production` omits devDependencies**, which here means `typescript` and
  the `@types` packages `next build` needs. This one bites, hence `--include=dev`. The failure reads
  as a TypeScript error in the application, which sends you looking in the wrong place.

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

## See Also

- [[tenancy-and-rls]] — the boundary that makes one deployment safe
- [[security-review]] — the headers, and what is checked on every run
- [[invitations]] — why the container needs the service-role key
- [[unverified-claims]] — CI has still never run

*Last updated: 2026-08-05*
