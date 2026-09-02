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
- **Nothing else touches the tree while an e2e run is going** — not a second run, and not a
  build. Both produce failures that look like regressions and are not.

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

### Timezones — the trap this repo has now fallen into five times

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

### A mutation test that could not fail, because the suite was testing yesterday's build

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, which is right for iterating
locally and has a trap in it that is worth one paragraph.

Found 2026-08-11 while mutation-testing the `NavGroup` empty-group rule. A `next start` had been
left running on 3210 from an unrelated screenshot capture. The mutant was introduced,
`npm run build -w @ece/web` rebuilt `.next`, the suite was run — and **all five tests passed**,
which for a deliberately broken build is the worst possible outcome: the obvious conclusion is
that the new assertions are inert and should be deleted. Playwright had reused the running
server, which was still serving the pre-mutant output. Killing it and re-running failed exactly
the two assertions it should, on the two roles it should, and left the manager passing because a
manager legitimately sees all six groups.

So: **a manually started server makes the whole suite a test of the previous build**, silently,
with no warning from Playwright and nothing in the output that says which build was served. It
does not only affect mutation tests — it affects any local run after any edit. If a change that
should have broken something does not break it, kill whatever is on the port before believing
the result.

**The clamp is not the whole fix, found 2026-08-11.** `recentlyToday()` runs once, in the seed
project, and pins the timestamp inside the day *as it stood at seed time*. A full run takes ten
minutes. Seeded at 00:00:23 and asserted at 00:01:50, the sign-in was stamped on the 10th and
read back on the 11th — `ratio.present` fell to 0, and the wall display's unverified-ratio
caveat, which renders only when somebody is present, was not on the page. Same symptom as the
third occurrence, and **no clamp can fix it**, because the day changes after the clamp has run.

The window is now about ten minutes a day rather than an hour, which makes it rarer and
correspondingly more confusing: it arrives once, in the middle of unrelated work, and everything
passes on the retry. If it costs anybody an hour a second time, the fix is for the seed to refuse
to start within a run's length of midnight — a skip that names the reason beats a failure that
implicates whatever was last edited. Not done yet; recorded so the next person spends a minute
rather than an evening.

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

**Fifth time, in SQL, and 0029 closes it.** Three `default current_date` columns survived 0006 —
`medication_authorities.starts_on` (0004), `fee_schedules.active_from` and `payments.paid_on`
(0019) — plus one function body, `purge_child`, computing `was_under_two` for the audit record
that outlives the child's data. Found by querying the live catalogue rather than reading the
migration files, which is the only way to know what a column actually defaults to after
twenty-eight migrations. The medication one was the one that bit: an authority to administer a
prescription medicine became valid a day early.

They are now `(now() at time zone 'Pacific/Auckland')::date`, the form AGENTS §4.3 names.
**Not dropped**, which was the stronger fix and was rejected: the columns are `NOT NULL`, so no
default at all means a forgetful caller fails loudly, and every caller in `packages/api` already
passes the date. But `rls_isolation.sql` itself inserts into `fee_schedules` and `payments`
without them, and so would any statement typed into the SQL editor during an incident. Trading a
wrong default for a foot-gun in the tool you reach for at 2am is a bad trade.

The zone is hard-coded and that is not laziness: **a column default cannot see other columns of
its own row**, let alone join to `centres`, so the per-centre-correct value is not expressible as
a default at any price. `purge_child` does use the centre's own timezone, because there the
centre is one join away — and that join is why 0029 also asserts `was_under_two` comes back
decided rather than null. Every refusal assertion around `purge_child` passes on *any* exception,
so a join returning no row would raise "No such child" and leave the suite green. The failure
mode is a JSON `null` rather than a SQL `NULL`, which was checked rather than assumed.

**Enforced now, in both languages.** `rls_isolation.sql` gained the SQL twin of
`localDates.test.ts`: no column default and no function body may take a calendar day from the
session zone. It catches `current_date`, `now()::date` and `current_timestamp::date` alike, via
the general form — `::date` without `at time zone`. Mutation-tested the honest way round: written
first, run against the unfixed schema, and it named all three offending columns before 0029
existed.

### A fixture that seeds invalid data tests nothing

Added 2026-08-08, and it cost an afternoon. The e2e tenant seeded
`moe_service_number: 'AUD-<tag>'` — readable, unique, and **rejected by the product's own
rule** that a Ministry service number is three to eight digits.

Nothing failed, because nothing had ever driven `/settings`. The moment a test did, the form
refused to save *anything* — it re-validates every field on submit, so an unparseable number
already in the record blocked an unrelated change and reported an error about a field the user
had not touched. The seeded state was one the application cannot reach through its own UI, and
every assertion downstream of it was really asserting the first refusal.

The rule: **a fixture must satisfy the validation the product enforces.** If it cannot, the
validation and the fixture disagree about what a valid record is, and one of them is wrong.

Two further diagnoses in the same chase were wrong and are recorded because the wrongness is the
useful part:

- *"The settings form has never saved anything."* False. It saves. The tests were reloading
  immediately after `click()`, which returns as soon as the event is dispatched — the reload
  raced the POST and the page came back with the old value. The tell was the **next** test in
  the file reading back the value the previous one had in fact written. `save()` in
  `settings.spec.ts` now waits on the response.
- *"A `0` interval proves the server-side guard."* It proves nothing: `min={1}` on a
  `type="number"` input means the browser never submits it, and its implicit `step="1"` blocks
  `1.5` too. Both earlier versions of that test named a guard they could not reach, which is
  worse than no test — it reports the guard as covered. The server branch and the
  `centres_sleep_interval_sane` CHECK are second and third lines of defence for callers that are
  not this form, and the test now asserts what is true at this layer: the field is invalid and
  nothing saves.

`updateCentre` came out of it with a `.select('id')` and a throw on zero rows. A PostgREST UPDATE
that matches nothing returns `error: null`, and under RLS "matches nothing" is what a refusal
looks like — so a caller who may not update a centre would otherwise be told "Saved.".

### A write that does not count its rows cannot tell "saved" from "refused"

**Promoted to its own heading on 2026-09-03**, because it had been a paragraph inside the sleep-check
section and kept being missed while it was buried there.

The rule, and it is the whole convention:

> A PostgREST `UPDATE` or `DELETE` that matches no rows returns **`error: null`**. Under RLS,
> "matches no rows" is exactly what a refusal looks like. So a writer that inspects only `error`
> reports a refusal as a success — and this product's entire security model is *Postgres refuses*.

The shape:

```ts
const { data, error } = await db.from('t').update(row).eq('id', id).select('id');
if (error) throw new Error(`updateThing: ${error.message}`);
if (!data || data.length === 0) {
  throw new Error('updateThing: nothing was updated. Either the id is wrong or the policy refused it.');
}
```

**Measured, because "we mostly do this" turned out to be false.** Every write statement in
`packages/api` scanned on 2026-09-03: **20 guarded, 34 unguarded.** The unguarded list is in
[[unverified-claims]] item 49 and includes changing a member's role, revoking a membership,
revoking an invitation, recording who sighted a certificate, superseding a custody arrangement,
updating an enrolment and issuing an invoice. On those, a refusal currently renders as *"Saved."*

**Do not sweep all 34.** Some are legitimately allowed to match nothing — `engagement.ts` has a
comment relying on it, where a second concurrent decision on the same row *should* be a no-op
rather than an error. The check is a judgement per call site about whether zero rows is a
possible-and-fine outcome or a refusal being swallowed, which is why this is a convention for new
writers and a tracked item for the existing ones rather than a codemod.

### A `fetch` whose body you never read stays in flight

Found 2026-09-03, and it cost six days of a completely dead end-to-end suite — the full story is
[[unverified-claims]] item 41.

`await fetch(url)` resolves as soon as the **headers** arrive. The body is a stream, and a stream
nobody reads leaves the request open in Chromium's accounting. `SyncStatus` wanted only `res.ok`,
never touched the body, and sat in `(app)/layout.tsx` — so every authenticated page held one
request open forever. Playwright's `networkidle` waits for the in-flight count to reach zero, so
every navigation in the suite timed out at 60 seconds on screens that were rendering perfectly.

```ts
const res = await fetch(url, { cache: 'no-store' });
await res.text().catch(() => {});   // drain it, even when only res.ok is wanted
setReachable(res.ok);
```

**Two things worth keeping from how it was found.** A trace's network log records only *completed*
resources, so the hanging request was invisible in it; what answered the question in one run was
listening to `request`/`requestfinished`/`requestfailed` and printing what was still outstanding.
And every server-side measurement said the app was healthy — the route answered in 5ms by `curl`
— which is why it survived so long: the evidence all pointed away from the client.

### A policy that reads another table inherits that table's RLS

Found 2026-08-08 while trying to mutation-test `immunisation_records`. The attempted weakening
was the classic mistake — keying on the child's centre instead of on guardianship:

```sql
using (exists (select 1 from public.children c
                where c.id = child_id and c.centre_id in (select public.caller_centre_ids())))
```

The suite stayed green, and for a while that looked like an assertion that could not fail.

It is not. **A policy expression is evaluated as the querying user, so a table referenced inside
it is subject to its own policies.** `children` is restricted by guardianship, so for a parent
the inner `SELECT` returns nothing, `EXISTS` is false, and the row is hidden — the "weakened"
policy was accidentally as strict as the real one. Replacing it with `using (true)` failed the
assertion immediately, which is what proved the test works.

Two consequences worth carrying:

- **A mutation test can fail to mutate.** A green suite after a deliberate weakening is not
  evidence the assertion is sound; it may be evidence the weakening did nothing. Reach for the
  bluntest possible mutation (`using (true)`) before concluding a test is weak.
- **The `caller_*` predicates are `SECURITY DEFINER` for exactly this reason.** They read
  `memberships` and `child_guardians` as the owner, so they answer honestly rather than being
  silently narrowed by the policies on the tables they consult. A hand-written `exists (select …)`
  in a policy does not have that property, which makes it unpredictable in both directions —
  accidentally safe here, accidentally *restrictive* somewhere it matters. Use the predicates.

### Two `test:e2e` runs at once produce a false failure

The suite seeds one audit tenant, and `reuseExistingServer` is on locally — so a second run
started while the first is going **shares the webserver and the tenant**, and the second run's
teardown drops the tenant out from under the first. The first then reports a partial pass with
the rest unrun.

Recorded because the output looks exactly like a real regression, and 2026-08-08 was spent
briefly believing it was one. A full run started in the background is not a thing to work
alongside; either wait for it, or accept that its result is worthless. The tell is a pass count
well short of the total with no failure detail — an interrupted run, not a failing one.

### Nor does anything else touch the tree while a run is going

The sibling of the trap above, found the same day and with a **different tell**, which is why it
needs its own entry.

`next start` serves `.next` from disk. Running `npm run build` while a suite is in flight replaces
the application under the running server, mid-run. The result is not a truncated run — it is **one
ordinary-looking failure in an otherwise complete run**, in whichever spec happened to be executing
when the build landed. That reads exactly like a real regression in unrelated code, and on
2026-08-08 it was briefly believed to be one: `sleep.spec.ts` failed as test 72 of 85, having
nothing to do with the change under test, and passed in isolation straight afterwards.

Worse, **the isolated re-run destroys the evidence**: Playwright clears `test-results` when a run
starts, so the trace and error context from the failure are gone before anybody reads them. Read the
artefacts before re-running, not after.

**And the mirror image, which is easier to fall into: restoring a mutation without rebuilding.**
`next start` serves what is on disk, so `cp` -ing a file back and re-running the suite tests the
*mutated* build against *restored* source — and `git diff` is clean, which is exactly what makes it
convincing. This produced two genuine-looking export failures on 2026-08-09; the source was correct
and the server was not.

A mutation test has four steps and the fourth is the one that gets dropped: **mutate, build, run,
restore *and build again*.** If a failure survives a restore, rebuild before believing it.

### The cleanup that became the mess it was written to clean up

`sweepStaleAuditTenants` removes audit tenants older than two hours, so a run killed mid-flight does
not leave its centre behind forever. On 2026-08-09 it was doing the opposite, and had been for a
while.

Three tenants from an earlier session still held a **payment** — created during the very
investigation that established a payment cannot be deleted (`payments.invoice_id` is `on delete
restrict`, and DELETE on `payments` is withheld from `service_role` as well as `authenticated`).
The fixture was corrected afterwards to seed invoices and never a payment. The three tenants
created while finding that out were never reclaimed.

Then they aged past the two-hour cutoff, and the mechanism inverted:

1. Every run's sweep now picked them up.
2. The delete was one batch — `.delete().in('id', ids)` — so it failed on the whole batch.
3. The function threw.
4. The teardown died **before reaching `destroyAuditTenant`**, so the run stranded its own tenant.
5. Which, two hours later, became another tenant the sweep would try and fail on.

Twelve had accumulated before anybody looked, and the only symptom the whole time was **one red
teardown at the end of an otherwise green run** — the easiest failure in a suite to read as noise,
because every test passed.

Three things came out of it, and the third is the general one:

- **The sweep is per-tenant now**, and an unremovable centre is skipped with its reason printed
  rather than aborting the batch.
- **The teardown wraps the sweep.** Housekeeping for *other* runs must never block cleanup of
  *this* one. The per-tenant change makes the catch redundant today; the ordering is the hazard,
  and anything that runs before your own cleanup and can throw will eventually take it with it.
- **The append-only guarantee was working correctly the entire time.** Nothing here weakened it —
  the stranded rows were cleared as the table owner, out of band. The bug was never that payments
  could not be deleted; it was that one thing that could not be deleted stopped everything else
  from being.

**The escape hatch did not escape.** `npm run sweep:audit` is what the fixture points at when a
tenant cannot be removed from the test harness — it runs as the table owner through the Management
API. It would have failed on the same three, because owner privilege does not defeat `on delete
restrict`; the payment has to go first, and nothing deleted it. That script now clears payments for
the tenants it is about to sweep, scoped by the ids it already selected. It is the **only** place
allowed to: the fixture and the teardown run as `service_role`, which has no DELETE on `payments`
at all, and that is the guarantee rather than an obstacle.

**A third leak, found by counting rows rather than by a test.** With the sixty cleared, one audit
account was still there: the **kiosk** login. `destroyAuditTenant` deletes a hand-written list of
ids — owner, manager, educator, parent — and the kiosk role was added to the fixture without being
added to that line. So every run since the kiosk seed landed leaked exactly one account.

One per run is the worst possible rate for noticing. It is too slow to be obvious, and **it never
fails anything**: the tenant drops, the teardown reports success, the count climbs. Nothing in the
suite would ever have gone red.

The general shape is worth more than the fix: *a list written by hand does not grow when the thing
it enumerates grows.* Adding a role to `createAuditTenant` and not to that list is a silent leak by
construction — the same failure as the two audit-exemption lists in [[model-calls]], and the same
one `tokens:check` exists to prevent for design tokens.

### The same shape, four times in one day

Worth collecting, because the individual fixes are unremarkable and the pattern is not. On
2026-08-09 four separate defects had one cause — **a hand-maintained list that does not grow when
the thing it enumerates does**:

| List | Missing | How it would have been found |
|---|---|---|
| audit-trigger exemptions in `rls_isolation.sql` | `ai_requests` | `review:security` went HIGH — the *good* failure, because a second list disagreed |
| audit-trigger exemptions in `security-review.ts` | `ai_requests` | nothing; it is the second copy of the first |
| account ids in `destroyAuditTenant` | `kioskId` | **nothing.** One leaked login per run, forever |
| audited routes in `a11y.spec.ts` | `/reports` | **nothing.** The sweep keeps reporting every listed screen clean, truthfully |

Three of the four fail *silently* and one of them never fails at all — the a11y sweep would go on
passing while saying nothing about a page it had never seen. That is worse than a red test, because
the green one reads as coverage.

**The tell is the same every time: a literal list that has to be edited whenever an unrelated file
grows.** When adding one, ask what happens if the next person forgets — if the answer is "nothing
visible", the list needs a check that derives its contents rather than restating them. That is
exactly what `tokens:check` does, what `bounded-queries.test.ts` does by scanning source, and what
the audit-trigger class assertion does by reading `pg_class`. None of those can be forgotten into
silence.

Not unified here: the two audit lists cross a SQL/TypeScript boundary, and the a11y and tenant lists
are legitimately hand-curated (each entry carries a reason). Recorded so the fifth instance is
recognised as an instance rather than as a fresh surprise.

**And the countermeasure worked once, the same day.** `detail_confirmations` (0055) is the next
append-only table with no audit trigger, and it went into *both* exemption lists in the same
commit. Knowing the shape was enough — which is the argument for writing the pattern down rather
than only the four fixes.

**A convention that did not survive one day, though.** The section above this one ends *"use the
predicates"*, and 0055's insert policy — written the next morning — hand-rolls
`exists (select 1 from public.guardians …)` where `caller_guardian_ids()` already exists and is
stricter. See [[parent-self-service]] for what gets through. The lesson is not "try harder": a
convention recorded in prose is only reachable by somebody who happens to reread that page. The
version that would have caught it is a check that scans policy bodies for `from public.guardians`
and similar, the way the UTC-date guard scans `prosrc`.

Its centre loop was also fail-fast, and one stuck tenant aborted it **before the accounts section**.
That is where the rest of the damage was: `--dry-run` found **60 orphan logins**, the same
accumulation the fixture comment already describes from an earlier occurrence ("fifty-six of them
had accumulated"). It happened again because the loop was fixed for centres and not for the thing
that ran after them. When a cleanup step can fail, ask what is downstream of it — the visible
casualty is rarely the expensive one.

### Adding a column to a table with COLUMN-level grants

The new-table checklist says *policy and grant*. There is a second form of it that the checklist
does not cover and that bites on an **existing** table: `centres` does not carry a table-wide
UPDATE grant, it carries a **column-level** one naming each column an owner or manager may change.

Add a column without adding it to that grant and Postgres refuses the statement — before any
policy runs, because it checks the column privilege first. The error is `42501 permission denied
for table centres`, which names the *table* and not the column, so it reads like a policy problem.

**It breaks more than the new field.** `updateCentre` builds one UPDATE from every changed field,
and one ungranted column fails the whole statement. Adding `ai_features` in 0047 without its grant
stopped the settings form saving **anything** — the sleep-check interval, the ratio source, the
centre's name. A feature nobody had enabled broke three that already worked.

Nothing static caught it: typecheck, lint, every unit suite and `review:security` were green. It
was caught by `settings.spec.ts`, which asserts `.error` is absent *before* reloading — an
assertion added earlier for an unrelated reason, and the only thing in the repo able to tell
"refused" from "did not persist".

Before adding a column to an existing table, check for column-level grants:

```sql
select privilege_type, column_name from information_schema.column_privileges
 where table_name = '<table>' and grantee = 'authenticated';
```

And assert the positive in the suite. A negative assertion ("nobody has this on") passes just as
happily when the column is unwritable by everybody — note that a missing **grant** raises `42501`
where a missing **policy** filters silently, so the two failures look nothing alike.

### An applied migration is a record of what ran, including its comments

The runner stores a checksum per file and refuses to continue when one changes after being
applied — *"this database and this repo now disagree about the schema… refusing to guess."*
That fires on a **comment-only** edit too, which is correct and is easy to meet with
irritation rather than agreement.

It happened on 0045: the file was applied, then its comment was improved, then the next
migration would not run. The right fix is not to update the ledger by hand. It is to restore
the file to exactly what ran and put the new understanding **in the next migration or in the
wiki** — both of which are for what you now know, while an applied migration is for what
happened.

Re-applying by hand and updating the checksum is available and is a last resort: it means
editing the one table that records whether the schema is trustworthy, and it should be a
deliberate decision by a person rather than a step in a workflow.

### A view runs as its owner, and a behavioural test cannot always tell you

Every view here declares `security_invoker = on`. Without it a view runs as the migration
runner, which bypasses RLS — measured rather than assumed: a probe view over `centres` with the
setting off returned **5 rows to a caller who is a member of nothing**.

The trap is that a *behavioural* test for this can pass for the wrong reason. Turning it off on
`invoice_arrears` changed nothing across the whole suite, because that view joins
`invoice_totals`, which is itself an invoker view and went on enforcing the boundary by itself.
The assertion was labelled *"security_invoker carries the boundary"* and did not test that at
all — and would have kept passing until somebody rewrote the join to read `invoice_lines`
directly.

So the suite asserts it from `pg_class.reloptions` as a class-level check over every view in
`public`, and the behavioural assertion was relabelled to claim only what it proves.

**The general rule: when a nested object can satisfy your assertion for you, assert the property
directly rather than its consequence.** The same shape as the audit-trigger check, which asserts
the trigger exists because asserting that rows appear would pass for tables the trigger silently
skips.

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
- **A concatenated `select()` string silently loses the row type.** `supabase-js` infers the
  result from the *literal text* of the select, so `'id, name' + ', more'` degrades the return
  to `GenericStringError[]`. The visible symptom is a confusing `TS2352` on the cast that
  follows — "neither type sufficiently overlaps" — several lines away from the cause. The
  invisible symptom is worse: if the cast is written as `as unknown as Row[]` to make the error
  go away, every field access downstream typechecks against nothing. Keep a column list as one
  string literal however long it gets; `registers.ts` and `compliance.ts` both do.

### Testing

| Command | What it covers |
|---|---|
| `npm run typecheck` | four workspaces |
| `npm run lint` | flat ESLint config at the root; `next lint` is deprecated and prompts interactively with no config, which in CI hangs |
| `npm test` | unit tests in `@ece/core`, `@ece/api` and `@ece/web`. **Not `apps/mobile`** — it has no `test` script, so `--if-present` skips it silently and the command still looks complete. See [[unverified-claims]] item 20 |
| `npm run test:rls` | **the one that matters.** It prints `N/N assertions passed`; that is the count, and this table no longer carries one — it said 119 for a month while the suite grew past 600 |
| `npm run tokens:check` | generated CSS matches the shared tokens |
| `npm run drill:offline` | the outbox contract against the real database |

**Mutation-test a new policy.** If a suite passes first run, weaken the policy deliberately
and confirm the suite fails on the right assertion. A test that cannot fail is not a test.
The live variant (0061–0063) derives the weakened body from the migration file itself —
`s/the predicate//` on the shipped text — so the drill cannot drift from what actually
shipped, applies it, runs the suite, demands failure on the named assertion, and restores.

The RLS suite is one self-contained SQL script ending in `ROLLBACK`, so it needs no Docker and
no local Postgres and is safe against a live project. Impersonation is `set local role
authenticated` plus a `request.jwt.claims` blob, which is what PostgREST does per request.

**Count somebody else's rows as postgres, not as the actor.** A 0063 assertion counted the
notifications a report produced from the reporter's own seat and read zero — which was the
notifications policy correctly hiding the recipient's inbox, mistaken for the feature
failing. If the assertion is about rows the actor is not allowed to see, the count belongs
in a `set local role postgres` block, and the actor's own filtered view becomes a *separate*
assertion of the policy.

**An assertion block can become a writer when a migration adds a side effect.** The same
0063 counts then read 2 where 1 was expected: the 0051 block six migrations upstream calls
`report_absence`, and the moment the migration taught that function to notify, a
six-migration-old test started producing notifications. Absolute counts in later blocks
must account for the suite's own upstream calls — or better, count within a discriminating
predicate (`body like '%chickenpox%'`) that upstream noise cannot match.

### Definer helpers granted to nobody

Three functions now carry `revoke all … from public, anon, authenticated, service_role` and
**no grant at all**: `kiosk_pin_gate` (0062), `report_absence_core` and `notify_absence`
(0063). Only the owner can call them, which in practice means only from inside another
`SECURITY DEFINER` body — Postgres checks the inner call against the outer function's
owner, and the owner always may.

Use this when a helper would be dangerous as a public RPC but is shared by two or more
definer entry points: a PIN check that would otherwise be an oracle unscoped by
`caller_kiosk_centre_id()`, a notifier that writes into other people's inboxes. The suite
asserts `42501` on a direct call for each — an assertion per helper, because "granted to
nobody" is one dropped `revoke` away from "granted to everyone signed in", and nothing else
would notice.

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

*Last updated: 2026-08-14 (mutation drills against the live schema, counting seats, and helpers granted to nobody)*
