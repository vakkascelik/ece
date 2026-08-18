# Production readiness

The phase whose job is to find out what is not true. It found two things nothing else
could have.

## Overview

Phases 0–5 built the product. Phase 6 was supposed to polish it: an accessibility audit,
performance budgets, a restore drill, store submission material, and the privacy documents
a service needs before it holds a real child's record.

What made it worth doing was not the polish. It was that **three of those five things are
exercises rather than opinions** — you cannot audit accessibility by reasoning about it, you
cannot verify a backup by believing in it, and you cannot delete a tenant by intending to.
Each one had to be run, and two of them failed the first time in ways no amount of reading
the code would have surfaced.

## Key Points

- **A centre could not be deleted. By anyone. Ever.** The audit fixture found it by needing
  to clean up after itself. Migration `0020` fixes it.
- **The accessibility audit runs on pages with data in them**, because an audit of an empty
  state is worthless — every screen here has one and every one passes trivially.
- **axe found a real critical failure**: the role selector on the People screen had no
  accessible name, so a screen reader announced "combo box, educator" with no indication of
  whose role it was, once per person.
- **The restore drill is mutation-tested.** A drill that passes is worthless until you have
  watched it fail.
- **Performance is governed in gzipped bytes**, not in a Lighthouse score.
- **Nothing has been submitted to a store, and no build exists.** The configuration and the
  declarations are written; that is preparation, not progress.
- **No screen reader has ever touched this product.** See [[unverified-claims]] item 12.

## Details

### What the audit actually covers

19 screens, two roles, a production build, in a real browser:

| | |
|---|---|
| Staff screens | overview, children, child record, new-child form, **the form showing its errors**, attendance, posts, messages, people, compliance, evidence binder, funding, settings, centre selection |
| Whānau screens | overview, their own tamariki, their child's record, pānui, messages |
| Unauthenticated | login, **login showing its error**, a valid invitation, an invalid one |
| Also asserted | that a parent is *redirected* from every staff screen rather than shown an empty one |

The two error states are there on purpose. Error states are where labelling and
announcement usually break, and they are never audited if the audit only ever sees a
pristine form.

The gate is WCAG 2.2 AA — all six axe tags, because 2.2 AA does not imply the earlier ones
and listing five of them silently narrows the audit. `best-practice` findings are printed
but do not fail, since a gate nobody can satisfy is a gate somebody disables. As at
2026-08-04 there are none of either.

### Why the fixture seeds its own data

Because an accessibility audit of an empty page measures nothing. axe cannot find a
contrast failure in a table with no rows, an unlabelled control in a form nobody rendered,
or a heading problem in a section that short-circuited to "nothing has been filed".

So the fixture builds the *loaded* version of every screen: a child with an anaphylaxis
plan and a withheld consent, one signed in an hour ago so the ratio bar has something to
assess, three staff records covering expired / due-soon / current so all three flag colours
are measured, a thread with two messages, a published pānui, a live invitation.

Two centres, not one, because `requireCtx()` auto-selects when there is exactly one
membership — with one centre, `/select-centre` is unreachable and would never be audited.
Two is also the real shape of the first customer.

**Media is deliberately not seeded.** A photo on a post is a signed URL to an object in a
private bucket, and uploading one means the fixture writes to storage, which it would then
have to clean up — and a failed clean-up leaves a child's photo in a bucket. So the image
elements on `/posts` are **not covered**. Recorded here rather than papered over.

### The defect: a centre could not be deleted

The fixture drops its tenant on the way out. The drop failed, with an error worth the whole
phase:

```
insert or update on table "audit_events" violates foreign key constraint
"audit_events_centre_id_fkey"
```

An *insert* failure, while deleting:

1. `delete from centres` removes the centre row.
2. Postgres cascades to `children`, then to health, attendance, consent.
3. Each of those carries the audit trigger, which inserts a row recording the deletion —
   `centre_id` pointing at the centre from step 1.
4. That centre is gone, so the foreign key rejects the audit row and the transaction aborts.

**No centre could be deleted by anybody** — not an owner, not the service role, not by hand
in the SQL editor. Five phases had shipped with no way to offboard a customer, and nothing
in the type system, the policies or the RLS isolation suite could have surfaced it,
because none of them tries.

The fix is to drop the foreign key, and it is a correction rather than a workaround.
`audit_events` is an append-only ledger, and **a ledger has to outlive its subject**; a
foreign key asserts the opposite. It was also a genuine standoff: nobody may delete an
audit row — no policy, no grant, not even `service_role` — so there was no legal sequence
of statements that could have unblocked it. The column, index and RLS policy remain, so a
surviving row names a centre that no longer exists and is invisible to every authenticated
caller, which is the right visibility for it.

No `purge_centre()` function and no button. Removing a tenant is a runbook —
`docs/offboarding.md` — because a self-destruct control in a product used by tired people
at 5pm is a support incident with a countdown on it.

### The accessibility finding

`select-name`, critical. The role selector in each row of the People screen had no
accessible name, and neither did its Save or Remove button. A sighted reader takes the name
of the person from the cell to the left; a screen reader user tabbing through heard "combo
box, educator", "Save, button", "Remove, button" — repeated once per person, with nothing
to say whose row they were in. On the screen that decides who can administer a centre and
who can be removed from it.

Fixed with `aria-label` naming the person on all three controls, rather than a visible
label per row, which would repeat the email three times in a cramped table and be worse for
everybody. Two smaller ones went with it: every action column got a visually-hidden
`Actions` header (they announced as a blank column name once per row), and the attendance
page's three sections became named `<section>` regions so a screen reader user can jump
between "adults present", "here now" and "not here" instead of walking the roll. An unnamed
`<section>` is not exposed as a region at all, which is why each carries `aria-labelledby`
and not just the element.

### Two findings that were the tests, not the app

Worth recording because both would have produced a false green:

- **The setup asserted on the centre's name after choosing a centre.** That name is also on
  `/select-centre`, so the assertion passed instantly against the page being left, and the
  storage state was captured before the cookie the action sets had arrived. Every owner test
  failed on `/select-centre` until it waited for the URL instead.
- **The audit ran against a stale server.** `reuseExistingServer` picked up a build from
  before the fix, so a corrected page still reported the old violation. `npm run test:e2e`
  builds first for exactly this reason.

### The restore drill, and why the mutation test is the point

`npm run drill:restore` enumerates every table **from the catalogue** — so a table added by
a future migration is covered without anyone remembering — extracts every row as JSON to a
file, sends it back, reloads it into a shadow schema built with `like … including all`, and
compares row counts and a content fingerprint per table. 35 tables, 2864 rows, 4/4 as at
2026-08-06.

Reloading uses `jsonb_populate_recordset`, handing Postgres its own JSON back. The
alternative — per-type SQL literals for timestamptz, text[], jsonb, seven enums and a
daterange — means writing a quoting rule for each, and getting one subtly wrong is how a
restore appears to succeed. This way there is exactly one escaping rule in the file.

Then it was mutated, twice:

| Mutation | Result |
|---|---|
| A character appended to a **timestamptz** | Rejected at load, `22007`. Caught — but by the type system, not by the comparison |
| A character appended to **`attendance_events.note`** | Loaded, then **failed the comparison**, naming the table. One character, one column, one row, out of 485 |

The second is the one that mattered. Without it the comparison might have been comparing
something with itself, and a green run would have meant nothing.

What it does not prove is stated in `docs/backup-and-restore.md` and is longer than what it
does: not Supabase's own backup files, not `auth.users`, not Storage, not the policies —
those come back from the migrations, which is a *stronger* guarantee, because a restored
dump gives the policies that were in place while the migrations give the policies that are
supposed to be.

### Performance: bytes, not scores

A Lighthouse number measures the machine that ran it. Gzipped bytes are deterministic and
attributable to a commit, and they are what causes a slow first paint on centre wifi.

| Budget | Measured | Limit |
|---|---|---|
| First-load JS | 100.6kB gzip (342kB raw) | 106kB |
| First-load CSS | 2.0kB | 4kB |
| Middleware, **on every request** | 89.3kB | 94kB |

The first-load figure agrees with what `next build` prints, which is a useful check that
the script measures the right files. It is **not a small number**, and almost none of it is
this app: React 19 and the App Router runtime are ~98kB of it, and each page adds between
142B and 3kB. So movement means a dependency reached the client.

The middleware budget is the one with history: a static Sentry import took it from 91kB to
176kB raw, on every request including 404s, to catch errors in a file that never throws.

The e2e suite also measures the web sign-in. **This page said ~930ms and called it a round
trip; corrected 2026-08-18.**

The figure was right in Phase 6 and wrong five days later. `751837a` gave the web app the
outbox, so a tap enqueues locally and repaints from local state — and the assertion the
measurement ended on started being satisfied by the optimistic paint rather than by the
server. The recorded number fell from a tight 894–971ms band to 68–130ms in one commit and
silently changed meaning. **Twelve days, unnoticed, because it got faster.** The lesson is
the general one this page keeps finding: a measurement is a claim about a code path, and
changing the path invalidates the claim without touching the number.

Two figures now, and the timings artifact keeps the whole history so a regime change is
visible as a step rather than as a footnote:

- **paint** — click to present on the roll, no network: **97–122ms**
- **confirmed** — click until "Waiting to send" clears, the flush landing in Postgres:
  **320–480ms warm**, **~3.1s for the first write after a cold start**

Four samples on one machine against the live project. The cold-start number is the one worth
keeping: the first sign-in of the morning takes about three seconds to confirm, and the only
reason that is acceptable is the outbox — immediate paint, queued write, "Waiting to send"
until it lands. It is the offline design justifying itself on a *connected* morning.

The plan's 100ms budget is still a different number: the **mobile** optimistic write, which
the paint figure is the web analogue of, and which cannot be measured without a device build.
Conflating them would let a fast web action stand in for an untested tablet — which is
exactly the error the corrected paragraph above committed.

### What Phase 6 could not do

- **No EAS build**, so no airplane-mode drill on a device and no push delivery. `eas.json`
  exists with the profiles chosen and commented; it has never run.
- **No screen reader pass.** [[unverified-claims]] item 12.
- **No store submission.** No Expo account, no Apple Developer account, no Play Console.
  Also no icon, splash or screenshots.
- **No real LCP.** There is no deployment, so there is nothing to measure from a network.
- **No hosted privacy policy.** Both stores require a reachable URL and the statement is a
  file in a repository. It is the only blocker on this list that is hosting rather than
  writing.
- **No breach-runbook walkthrough.** It has never been exercised against a simulated
  incident, which is the obvious next thing to do with it.

## See Also

- [[unverified-claims]] — items 10, 11 and 12 came from this phase
- [[privacy-and-retention]] — what the documents in `docs/` are built on
- [[tenancy-and-rls]] — the append-only guarantee that made a centre undeletable
- [[conventions]] — where the audit and the budgets fit in the verification set

*Last updated: 2026-08-04*
