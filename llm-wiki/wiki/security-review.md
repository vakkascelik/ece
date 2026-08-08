# Security review

Sixteen checks written as SQL against the live schema, not as a reading of the migrations.
Four real findings, two of which contradicted claims this repo had already made in writing.

## Overview

`npm run review:security` asks Postgres. That is the whole design decision: a security
review written by reading migration files is a review of what somebody **intended**, and
in each of the four findings below the code said the right thing while the database did
not enforce it.

It also found four false positives in its own first version, all from the same cause —
reading `role_table_grants`, which shows table-level grants only, while most write access
in this schema is deliberately **column-scoped**. A review that misses the mechanism the
schema uses on purpose is a review of a different schema.

## Key Points

- **An issued invoice did not freeze**, though the README said it did. Three ordinary
  statements changed what a family had been billed, with no audit record.
- **Eight tables holding consequential state had no audit trigger**, `staff_records`
  among them — the table that *is* the licensing evidence.
- **`Referrer-Policy: no-referrer` broke every write in the application.** A security
  header, correctly reasoned, that silently made the product read-only.
- **Fourteen tables carried the shape that produced the Phase 4 consent leak.** All were
  narrow; 0022 removes the shape so the question cannot recur.
- Clean and worth stating: no secret in any bundle, no `dangerouslySetInnerHTML`, all 17
  definer functions pin `search_path`, `auth.users` is unreachable, the media bucket is
  private, and `anon` has no table grant at all.

## Details

### Finding 1 — an issued invoice did not freeze

The Phase 5 commit and the README both said: *"An issued invoice freezes — the line policy
requires `status = 'draft'`."*

The line policy does require draft. Nothing required the **status** to stay put, and
`invoices.status` carries a column-level UPDATE grant because an owner has to be able to
issue one. So:

```sql
update invoices      set status = 'draft'  where id = …;  -- allowed
update invoice_lines set unit_cents = …    where …;       -- now allowed, it is a draft
update invoices      set status = 'issued' where id = …;  -- allowed
```

Three ordinary statements, no privilege escalation, and the amount a family was billed
differs from the amount they were shown. `invoices` had no audit trigger either, so there
was no record it happened. The existing CHECK — `invoices_issued_when_not_draft` — is
satisfied by a reversion, because it only says "if not draft then `issued_at` is not null".

Fixed by a trigger in `0021`, because **a CHECK sees one row and cannot see the row it
replaced**; "was this already issued" is a question about the transition. It refuses a
return to draft, refuses reinstating a void, and fixes the reference, recipient, period,
centre and issue date. A note can still be added, because a rule that blocks ordinary work
is a rule somebody removes.

Seven assertions in the RLS suite, and they are mutation-tested: disabling the trigger
inside the transaction fails with `FAIL an ISSUED invoice CANNOT be returned to draft`. An
eighth counts the audit rows, which is a second independent check on all of them — insert,
issue, note, void is exactly four, and a successful reversion would make it more.

### Finding 2 — the audit log stopped keeping up with the schema in April

`0005` applied the trigger to ten tables. Phases 3, 4 and 5 added twelve more and no
migration extended it. **A missing audit row looks exactly like a quiet day**, so nothing
surfaced it.

The one that matters is `staff_records`. That table is the licensing evidence this product
sells: an expiry date on a police vetting record could be edited, or a "sighted by"
cleared, with no trace at all. A centre could have handed a reviewer a binder assembled
from records that had been quietly adjusted, and the product would have had nothing to say.

`0021` extends the trigger to twelve tables and teaches it to attribute an invoice line
through `invoice_id` — it has a nullable `child_id`, and the function silently skipped rows
it could not attribute to a centre, so the most audit-worthy edit in the table (a changed
amount on a line naming no child) was the one it dropped.

Still excluded, with the reasoning from 0005 intact: append-only tables, where the row is
its own record, and per-person settings that belong to no centre.

The suite now asserts audit coverage **as a rule** rather than table by table, with the
exclusions listed by name. That is the assertion that would have caught the original gap,
and it fails when somebody adds a table without the trigger — which happened three phases
running.

### Finding 3 — a security header that made the product read-only

There were no security headers at all: no CSP, no frame protection, no referrer policy, no
`nosniff`. For an app whose screens show a named under-five's anaphylaxis plan and a court
order reference, that is a gap in the same category as a missing policy — it just fails in
the browser, so no amount of SQL testing would find it.

Fixed with a nonce-based CSP in middleware (a nonce in a static config is not a nonce) plus
the static headers. `script-src` carries a nonce and **not** `'unsafe-inline'`, which would
make the directive decorative. `connect-src` is the one that limits damage: if a script ever
did run, the only origins it could reach are this one and the Supabase project.

Then `Referrer-Policy: no-referrer` broke every write in the application.

Sign-in failed with `TypeError: Invalid URL … input: 'null'`, on the POST and never on a
GET. Next's server-action origin check compares the request origin against the host, and
where `Origin` is absent it falls back to `Referer` — which `no-referrer` strips, so it
parsed the string `"null"`. Every server action in this product is a write, so the roll
rendered, the ratio rendered, and signing a child in did nothing.

`same-origin` achieves the actual goal — these URLs contain child UUIDs and a UUID in a
`Referer` sent to another host is an identifier leaving the building — while keeping the
same-origin header Next needs.

**`typecheck`, `lint` and `next build` were all clean and the page looked perfect.** The
end-to-end suite was one test away, which is the argument for it existing.

### Finding 4 — fourteen tables with the shape that leaked in Phase 4

The Phase 4 consent gate hid photos from whānau and not at all from educators. The cause
was not the gate: `media_write` was `FOR ALL`, `FOR ALL` covers SELECT, and permissive
policies are OR'd, so a second permissive policy widened the read path.

Fourteen other tables had the same shape — an `x_select` policy and an `x_write` policy
declared `FOR ALL`. Every one was read, and in every case the write policy is **narrower**
than the select policy, so nothing was leaking. That is luck about how they were written,
not a property of the design, and *"we read all fourteen and they were fine"* has a shelf
life of one commit.

`0022` splits them into `insert` / `update` / `delete`, so SELECT has exactly one permissive
policy per table and **adding a write policy can no longer widen a read**. It reads `qual`
and `with_check` out of the catalogue and re-issues them verbatim rather than re-typing
fourteen predicates, because the expressions are the security and re-typing them is fourteen
chances to change one while believing it was copied. It asserts the count is fourteen and
then asserts the invariant, so a future migration cannot silently change what it does.

`0023` then drops the six policies the split produced for verbs that are deliberately not
granted — DELETE on `evidence`, `invoices`, `medication_authorities`, `staff_records`, and
UPDATE on `media_children`, `post_children`. None was exploitable, because Postgres checks
the privilege before the policy. They are gone because of **what they say**: a policy
reading "owner and manager may delete evidence" is a documented permission, and the next
person to find the feature not working has an obvious fix — add the grant — at which point
the design decision is gone.

> A policy is a statement about what is allowed. If the answer is never, the policy should
> not exist: the absence is the design.

### The review's own false positives, which are the more useful lesson

Four of the first version's findings were wrong, all from one cause: it read
`information_schema.role_table_grants`, which shows **table-level** grants. This schema
does most of its write control with **column-level** grants, because a policy restricts
rows and only a grant can restrict columns.

| Reported | Actually |
|---|---|
| `messages` has no UPDATE grant → append-only confirmed | `messages.read_at` has a column UPDATE grant. The "ok" was half false |
| `invitations.token_hash` readable → HIGH | INSERT only, which the invite flow requires. No SELECT |
| `schema_migrations` has no RLS → CRITICAL | No grant to any API role, so PostgREST cannot expose it. Low |
| Nine features broken by a missing grant | Nine column-scoped grants it could not see |

A review that cries critical at something unreachable trains its reader to skim, which is
worse than not running it. Severity is now a function of **reachability**, not of the
policy text alone.

### What was already clean, stated because it is load-bearing

- No service-role key, and no `service_role` string, in any client bundle or the mobile
  workspace. If a key is ever compromised it came from a developer machine or CI, not from
  a phone — which narrows an investigation considerably.
- No `dangerouslySetInnerHTML`, no `eval`, no `new Function` anywhere.
- All 18 `SECURITY DEFINER` functions pin `search_path`. One unpinned function would be the
  whole tenant boundary, since every predicate in this schema is a definer function.
- `auth.users` is granted to nobody. Supabase's own hint for the broken-view symptom in
  Phase 0 was to grant it, and following that advice would have published every email
  address in the project.
- One storage bucket, private. A photo is reachable only through a signed URL, which is what
  makes withdrawing consent effective rather than cosmetic.
- `anon` has **no table grant at all** in `public`. It does, since 0024, hold EXECUTE on one
  function: `submit_job_application`, the public careers form. That is the whole of the
  unauthenticated write surface, and the check that reports anon-executable definer functions
  now carries an allowlist naming it — because its old explanation, "each returns nothing
  without a JWT", is false of a function designed to work without one. See [[recruitment]].
- All four views run as the invoker.

### Not covered, and not to be assumed from a green run

- **No penetration test, and no external review.** Sixteen automated checks against a
  schema are not an adversary.
- **Rate limiting and brute force** rely entirely on Supabase Auth's defaults, which have
  not been configured or verified here.
- **Session lifetime, refresh rotation and password policy** are Supabase defaults, unread.
- **Mobile has no crash reporting and no certificate pinning.**
- **The service-role key has never been rotated**, and the account-wide personal access
  token used by the migration runner is a credential with far more authority than this
  project needs.
- **Storage object paths** are `<centre_id>/<uuid>.<ext>` and the read policy is checked, but
  no test attempts a traversal or an object enumeration.

## See Also

- [[tenancy-and-rls]] — the boundary these checks are checking
- [[consent-gated-media]] — the Phase 4 leak that finding 4 generalises
- [[production-readiness]] — the phase this review belongs to
- [[model-calls]] — the audit exemption this review keeps a second copy of
- [[unverified-claims]] — items 13 and 14 came from here

*Last updated: 2026-08-04*


### The CSP was refusing every script on four routes, in production only

Found 2026-08-07 by tracing flows rather than by any check. `script-src` is
`'self' 'nonce-<per request>' 'strict-dynamic'`, and a **statically prerendered page cannot carry a
nonce** — the nonce is minted per request in middleware and read back by the renderer, so with no
render there is nothing to stamp it onto. Measured from the build output, not inferred: `login.html`
had 16 script tags and zero `nonce=` attributes.

And it failed closed with no fallback. CSP Level 3 requires a browser that sees `'strict-dynamic'` to
**ignore** `'self'`, so every script on the page was blocked.

Four routes were affected — `/login`, `/no-access` and `/_not-found` in the app, and **all ten routes
of the public website**. Consequences in order of who they hurt: the site showed a wall of console
security errors to anyone who opened devtools on a childcare service's own marketing page, while its
client router was dead so every navigation was a full page load; and on `/login`, the `useEffect` that
moves focus to the error message never ran, so the accessibility behaviour the design pack asked for
was absent for exactly the person who needs it.

**Why nothing caught it.** Sign-in survives as a full-page POST, because React leaves
progressive-enhancement markup in static HTML — so every login in the e2e suite kept working. The
suite's own `the page loads with no CSP violation` test visits `/attendance`, which is rendered per
request and always received a nonce, so it could not fail. And `docs/deploy-railway.md` told whoever
deployed it to check `/login` for exactly this, then reassured them the e2e suite already covered it.
The one manual check that would have found it had been waved off in writing.

**Fixed by making every route render per request**, set on both root layouts so a prerendered page
cannot be added by accident. The alternative — keep static and weaken the policy to `'unsafe-inline'`,
which is what most static Next deployments do — was refused for the app, which renders a named
under-five's anaphylaxis plan, and refused for the site too because there is no CDN in front of it:
Railway serves from the container, so "static" was only ever saving a React render of a page with no
data fetching. Verified by serving both builds and confirming every script tag carries the CSP
header's nonce, and a new e2e test visits `/login`, `/no-access` and a 404 without a session and
asserts hydration actually happened.

Note for anyone adding route config: `export const dynamic` is **not honoured in a client component**.
Putting it in `login/page.tsx`, which starts with `'use client'`, left the route prerendered while
looking fixed.
