# Conventions

Migrations, testing, tokens, timezones and the traps this repo has already fallen into.

## Overview

The rules that are cheap to follow and expensive to rediscover. Most of them exist because
something broke.

## Key Points

- **The wiki is updated before the commit**, and a page the change contradicts is corrected
  first — a wiki that is wrong is worse than none, and that has already happened once.
- **Every new table needs a policy *and* a grant**, and an assertion in the isolation suite in
  the same commit.
- **Migrations are applied by `npm run migrate`**, which refuses to continue if a file changed
  after it was applied.
- **Migrations must be replayable** against a populated database.
- **Never compute "today" as UTC.** Use `todayInZone(centre.timezone)`.
- **PostgREST bulk inserts do not apply column defaults.**
- **Design tokens have one source**, and CI fails on drift.

## Details

### The convention for a new tenant-scoped table

```sql
create table public.<thing> (
  id        uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres(id) on delete cascade,
  ...
);
create index <thing>_centre_idx on public.<thing> (centre_id);
alter table public.<thing> enable row level security;
create policy <thing>_rw on public.<thing>
  for all using (centre_id in (select public.caller_centre_ids()))
          with check (centre_id in (select public.caller_centre_ids()));
revoke all on public.<thing> from anon;
grant select, insert, update, delete on public.<thing> to authenticated;
```

Both halves of the policy are required. `USING` alone lets a caller insert a row belonging to
a centre they cannot read — a silent cross-tenant write, invisible in testing because the row
promptly disappears from view.

**The GRANT line is not boilerplate to skip, and not boilerplate to paste unread.** Postgres
checks the table privilege *before* it evaluates a policy: without a grant the table is
unreadable by every real caller; wider than the policies contemplate and it is writable in
ways nothing checks. Grant only the verbs the product performs, and remember
`service_role` — it bypasses RLS but **not** grants.

For anything append-only, withhold `UPDATE`/`DELETE` from `service_role` too. That is what
makes the claim "this cannot be altered" true rather than aspirational.

### Migrations

```bash
npm run migrate                  # apply anything pending
npm run migrate -- --status      # show state, change nothing
npm run migrate -- --baseline    # record as applied WITHOUT running
```

Each file is applied once, in order, with a checksum recorded. **If a file changed after it
was applied the runner refuses to continue**, because that means the database and the repo
disagree about the schema and only a person knows which is right.

**They must replay cleanly against a populated database.** `create or replace view` refuses to
change a view's column list, so a later migration adding a column to a view makes replaying
the earlier one fail with "cannot drop columns from view". Use `drop view if exists` then
`create view`. Found by the runner on its first real use.

### Timezones — the trap this repo fell into twice

`current_date` in Postgres uses the session timezone, and PostgREST connects as **UTC**. New
Zealand is 12 or 13 hours ahead, so for the whole New Zealand morning UTC is *yesterday*.

The consequences were real: a `CHECK` constraint rejected a baby born that morning as being
born in the future, and a same-day enrolment was missing from the roll until lunchtime.

- In SQL, use `(now() at time zone 'Pacific/Auckland')::date`, not `current_date`.
- In TypeScript, use `todayInZone(centre.timezone)` from `@ece/core`. Never
  `toISOString().slice(0, 10)`, and never the device's local date on a server — a Next server
  runs in UTC.
- For a *window* of a local day, use `dayWindow()` in the compliance folder, which goes
  through `Intl`. A fixed +12 is wrong for half the year; the tests assert a 23-hour day in
  September and a 25-hour day in April.

**Third time, 2026-08-06, and this one was in a test fixture.** The e2e seed stamped its
sign-in at `Date.now() - 3_600_000` and its adult count at `Date.now() - 3_700_000`. The roll
and the ratio are scoped to today in Auckland, so between midnight and 1am those timestamps
land on *yesterday*: the roll loses its row, the ratio drops to "no adult count recorded", and
`Here now — 2` cannot be satisfied. **The suite failed for one hour in every twenty-four and
passed the other twenty-three**, which is worse than failing outright — at 00:07 the obvious
conclusion is that whatever you just changed broke attendance, and it takes a while to stop
believing that. Found while verifying a change to the login screen, which had nothing to do
with it. The product was correct the whole time: a new day starts an empty roll.

The lesson generalises past this repo. A relative timestamp (`now - an hour`) is not
day-safe, and a fixture that is only wrong inside a narrow window is a fixture that will be
wrong while somebody is debugging something else. `recentlyToday()` in
`apps/web/e2e/fixtures/tenant.ts` clamps it.

**Fourth time, 2026-08-07 — and this one is why the rule is now enforced rather than written
down.** `recordPayment` in `packages/api/src/billing.ts` defaulted `paid_on` to
`new Date().toISOString().slice(0, 10)`: the exact expression the bullet above forbids by name,
in a file written after the bullet was written. Every payment reconciled before about 1pm
Auckland would have been dated the previous day — and for anything reconciled on the 1st, into
the previous *month*, disagreeing with the bank statement it was keyed from. Nothing called
`recordPayment`, so no payment was ever misdated. It was a trap, not a bug, and it survived four
phases of review because it is invisible to `typecheck`, to `lint`, and to any unit test written
in the same wrong way as the code.

So `packages/core/src/__tests__/localDates.test.ts` now reads the source of every shipping tree
and fails on a calendar day taken from a UTC instant, in any of its spellings — `slice(0, 10)`,
`substring(0, 10)`, `split('T')[0]`, and `toJSON()` as well as `toISOString()`. The design is
lifted wholesale from `bounded-queries.test.ts` in `@ece/api`, including the part that matters:
an exemption is a **named entry with the argument written out**, not a pattern in an ignore
list. There is one, `dayWindow.ts`, and its argument is that `lastSevenDays` walks back from a
date a caller already resolved, using explicit `Date.UTC` components at both ends, so the offset
cancels and it never asks what day it is.

The test asserts its own file count and mutation-tests its own regex inline, because a
source-scanning test that matches nothing is a green test that checked nothing — which is the
same class of failure one level up.

**Still outstanding, in SQL.** Three `default current_date` columns remain:
`medication_authorities.starts_on` (0004), and `fee_schedules.active_from` and `payments.paid_on`
(0019). `children_due_for_purge` (0008) does date arithmetic against it too. 0006 fixed this
class for `children.date_of_birth` and did not sweep the rest. The medication one is the one that
bites: an authority to administer a prescription medicine becomes valid a day early. They are
**not** allowlisted anywhere — the guard above scans TypeScript only, deliberately, because
adding an exemption to make a known defect quiet is the move this repo has already recorded as
worse than no check. Fixing them needs a migration, and a migration needs database access.

### PostgREST traps

- **Bulk inserts do not apply column defaults.** One `INSERT` is built from the *union* of
  keys, so a key present in one object and absent from another is sent as an explicit `NULL`.
  Give every object in a batch every key. Cost a debugging session that looked like an RLS bug.
- **Unbounded `select()` is capped at 1000 rows** by default. Cosmetic in a report, a
  correctness bug in a dedupe.
- **A to-one embed is typed as an array.** Two plain queries are clearer than a cast that
  reads like a mistake.
- **`upsert` without `ignoreDuplicates` needs `UPDATE` privilege.** On an append-only table it
  fails with `42501` before any `CHECK` is evaluated — which can make a test pass for the
  wrong reason.

### Testing

| Command | What it covers |
|---|---|
| `npm run typecheck` | four workspaces |
| `npm run lint` | flat ESLint config at the root; `next lint` is deprecated and prompts interactively with no config, which in CI hangs |
| `npm test` | unit tests in `@ece/core`, `@ece/api` and `@ece/web`. **Not `apps/mobile`** — it has no `test` script, so `--if-present` skips it silently and the command still looks complete. See [[unverified-claims]] item 20 |
| `npm run test:rls` | **the one that matters** — 119 assertions as at 2026-08-04 |
| `npm run tokens:check` | generated CSS matches the shared tokens |
| `npm run drill:offline` | the outbox contract against the real database |

**Mutation-test a new policy.** If a suite passes first run, weaken the policy deliberately
and confirm the suite fails on the right assertion. A test that cannot fail is not a test.

The RLS suite is one self-contained SQL script ending in `ROLLBACK`, so it needs no Docker and
no local Postgres and is safe against a live project. Impersonation is `set local role
authenticated` plus a `request.jwt.claims` blob, which is what PostgREST does per request.

### Design tokens

`packages/core/src/tokens.ts` is the single source. The mobile theme reads it as data;
`apps/web/src/app/tokens.css` is **generated** by `npm run tokens` and CI fails on drift.

That check exists because the duplication was not hypothetical: the two copies had already
diverged, with the page background `#fafaf9` against `#faf9f7` and the muted grey a full
contrast point worse than the value the contrast test was asserting. The tests passed and the
screens rendered the other values.

Flags always carry a **symbol and a word**, never colour alone (WCAG 1.4.1). What they carry
is "this child could stop breathing", and about one man in twelve cannot reliably separate the
red from the green.

The generated file carries colour, spacing, radius, type scale, touch targets and — since
2026-08-06 — **motion**, including the easing curve. Motion was added the moment a component
needed the 260ms dialog timing and was about to retype it next to the token that already held
it. That is the whole failure this generator exists to prevent, so the rule is: if a value
lives in `tokens.ts` and a stylesheet wants it, emit it rather than copying it.

### Versions worth not re-litigating

- **Expo 57 / React Native 0.86 / React 19.** Expo 55 and 56 peer-require React 18, which
  cannot coexist with Next 15 in one hoisted workspace.
- **Expo modules are versioned `57.x`**, matching the SDK major — not the old independent
  `~14.2.4` scheme. `shop-admin-app` predates the change; do not copy its ranges.
- **`expo-secure-store`, not AsyncStorage**, for the auth session. AsyncStorage is an
  unencrypted file and this token authorises reads of children's health notes.
- **`metro.config.js` needs `watchFolders` *and* `resolver.nodeModulesPaths`.**
- **`dotenv-cli` wraps the Next scripts.** Next ignores a monorepo root `.env.local`, and the
  failure is delayed — `next build` succeeds and only a real request fails.

### Server actions

A form `action` must return `void`, so an action returning `{ error }` needs `useActionState`
in a client component. Catches go through `actionError`, which reports the failure and scrubs
the message — Postgres quotes offending values back, and a constraint violation can put a
child's name on screen.

Closing a panel on success belongs in a `useEffect`, not the render body: calling the parent's
`setState` during render is a React error that only shows up in the console.

### The wiki is updated before the commit, not after

A standing instruction from the owner, recorded here because it is a convention and not a
preference, and as a gate in `AGENTS.md` §5.

The order matters for two reasons. The commit message and the wiki page are written from the same
understanding, and that understanding is sharpest while the work is fresh — a page written three
commits later records what somebody remembers rather than what they learned. And a wiki updated
afterwards is the one that gets skipped precisely when the work was hard, which is when it was
worth writing down.

**If a change contradicts something a page already says, correct that page first.** A wiki that is
wrong is worse than no wiki, because it is trusted. There is a precedent rather than a hypothetical:
[[offline-outbox]] spent a day asserting that every check violation was a permanent failure, which
was the exact opposite of the fix that had just been made — and that page is the one somebody would
read before touching the offline path.

The checklist is in `AGENTS.md`. The short version: the page for the area, `unverified-claims` if
anything is now asserted without a source, `index` for a new page, `log` always, then
`npm run check:docs`.

The only exception is a commit that touches nothing but `llm-wiki/`.

## See Also

- [[tenancy-and-rls]] — the policy half of the convention
- [[unverified-claims]]
- [[offline-outbox]]

*Last updated: 2026-08-05*
