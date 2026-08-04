# ece

Multi-tenant platform for New Zealand early learning services. One web app, one
mobile app, one deployment serving every centre.

```
apps/web        Next.js 15 — admin and staff web
apps/mobile     Expo 57 / React Native — whānau and educators
packages/core   types, roles, capabilities. No Node, no Next, no React Native.
packages/api    the only place either app talks to Supabase
supabase/       migrations. RLS is the tenant boundary.
```

```bash
npm install
npm run dev:web        # http://localhost:3000
npm run dev:mobile     # Expo
npm run typecheck      # all four workspaces
```

Copy `.env.example` to `.env.local` first.

---

## Why this is pooled and not siloed

`shop-platform` and `charity-platform` both put one deployment and one database
schema per customer. That is right for them: each customer wants their own
website on their own domain.

It cannot work here, because **this ships a mobile app**. You cannot publish one
App Store binary per childcare centre. One app must serve every centre, so the
tenant is resolved at sign-in and isolation has to live somewhere the client
cannot reach.

What carries over from `shop-platform` is the monorepo and the shared-core
discipline. What changes is the tenancy model, because mobile forces it.

## The tenant boundary is Postgres, not the application

Every tenant-scoped table carries `centre_id` and has Row Level Security keyed
on `caller_centre_ids()`. The query layer in `packages/api` contains **no tenant
filtering at all**, deliberately:

- A filter in the app is one forgotten `.eq('centre_id', …)` away from showing
  one centre another centre's children.
- A mobile client cannot be trusted to filter, because a mobile client can be
  modified.
- Writing the filter anyway would be worse than useless — it would imply the
  filter is what keeps centres apart, and the next person would rely on it.

Adding a table? Copy the convention at the bottom of
[`0001_tenancy.sql`](supabase/migrations/0001_tenancy.sql). Both `USING` and
`WITH CHECK` are required: `USING` alone lets a caller insert rows into a centre
they cannot read, and the row then vanishes from their own view, so the bug is
invisible in testing.

## The service-role key is the one thing that breaks all of this

It bypasses RLS entirely — it can read every centre's children in one query. It
exists for tenant onboarding and scheduled jobs.

- Never in the mobile workspace. Expo inlines every `EXPO_PUBLIC_*` value into
  the shipped binary.
- Never in a browser bundle.
- In the web app it is `serviceDb()` in `apps/web/src/lib/supabase.ts` —
  deliberately not the default export and not wrapped in anything convenient, so
  every use is visible in review.

## Decisions worth not re-litigating

**Expo 57 / React Native 0.86 / React 19.** Expo 55 and 56 peer-require React
18, which cannot coexist with Next 15 in one hoisted workspace. Sharing a query
layer between the two apps is only worth having if both agree on React.

**Expo modules are versioned `57.x`, matching the SDK major.** Not the
independent `~14.2.4` / `~0.31.5` scheme used up to SDK 53 — StoreDash predates
the change, so don't copy its version ranges.

**`expo-secure-store`, not AsyncStorage,** for the auth session — following
StoreDash. AsyncStorage is an unencrypted file, and this token authorises reads
of children's names, health notes and custody arrangements. SecureStore caps a
value at 2048 bytes and Supabase sessions can exceed it, so
[`secureStorage.ts`](apps/mobile/lib/secureStorage.ts) chunks across numbered
keys and writes the count last, so an interrupted write forces a clean re-login
rather than reconstructing a truncated token.

**`metro.config.js` needs `watchFolders` and `nodeModulesPaths`.** Metro does not
look outside the app directory, and without both, `@ece/core` fails at bundle
time with an error that never mentions workspaces.

**A person can belong to several centres.** A manager of a two-site operator, or
a parent with children at two services. So `activeCentreId` is explicit state
and is never inferred when there is more than one choice — guessing is how
somebody posts a notice to the wrong centre.

## Open questions

- **First feature module.** The scaffold is domain-agnostic on purpose. The
  product plan in the `salix` repo
  (`llm-wiki/wiki/possible-projects/ece-early-learning-app.md`) argues for a
  licensing-evidence tool over enrolment or funding, on the grounds that
  Ministry ELI integration is closed to new vendors and Storypark anchors price
  at NZ$1.89/child/month. That plan's Stage 0 — ten conversations, no code — has
  not been run.
- **Whether mobile should be its own repo.** StoreDash is a separate repo.
  Keeping it here buys one shared query layer; splitting it would simplify EAS
  builds. Reversible either way.
- **Nothing holds child data yet**, and it should not until there is a written
  agreement and professional indemnity insurance in place. Under-5 records are
  among the most sensitive personal information in the country.
