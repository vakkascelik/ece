# Privacy and retention

What the Privacy Act 2020 actually requires, a correction to an earlier wrong claim, and how
purging coexists with append-only tables.

## Overview

This page exists partly to record a mistake. An earlier version of this repo's documentation
stated that the Privacy Act 2020 "gives a right to request" deletion. **It does not.**

The Act gives a right of **access** (IPP 6) and a right to request **correction** (IPP 7).
There is no general right to erasure in New Zealand law — that is GDPR Article 17, and it does
not apply here. What the Act does impose is **IPP 9**: personal information must not be kept
for longer than it is required for the purposes for which it may lawfully be used.

That distinction changes the design. IPP 9 is an obligation on the centre discharged by
following a retention schedule, not an endpoint an individual triggers. So the main mechanism
is a scheduled sweep, and ad-hoc purging is the restricted exception.

## Key Points

- **No right to erasure in NZ law.** IPP 6 access, IPP 7 correction, IPP 9 retention limit.
- **IPP 6 is why an educator can read their own vetting result** — see
  [[compliance-and-evidence]].
- **Purging is possible only because the audit log holds column names and never values.**
- `purge_child` is **owner only, archived children only, reason required and audited**.
- The seven-year retention default is **an assumption**, not a citation. See
  [[unverified-claims]].
- Under-5 records are among the most sensitive personal information in the country, and a
  breach is notifiable.

## Details

### The archived-only rule is the load-bearing guard

`purge_child(child, reason)` refuses a child who is still enrolled. That is not tidiness: it
is the guard against "delete this child" being used to remove a record that has become
inconvenient while they still attend, which after an incident is the scenario worth designing
against.

A reason of at least ten characters is required and is written to the audit log **before**
anything is deleted, so a failure part-way leaves the intention recorded.

`SECURITY DEFINER`, so it bypasses every policy — which means each of its guards is the only
thing standing between a caller and another centre's records. All of them are asserted in the
suite, including that an owner of the *other* centre cannot use it.

**Those guard assertions are weaker than they look, which 0029 exposed.** Each one calls the
function, catches whatever comes back, and asserts an exception occurred — so *any* failure
satisfies them, including a failure that has nothing to do with authorisation. 0029 changed the
function's opening `SELECT` to join `centres` (to compute `was_under_two` in the centre's own
timezone rather than UTC), and a botched join would have returned no row, raised "No such child",
and left all four refusal assertions green. Two things actually pin it: the still-enrolled case
asserts the *specific* message, which only appears once the row comes back, and a new assertion
checks the audit row's `was_under_two` is `true` or `false` rather than null. Nothing reads that
field yet — which is precisely why a null in it would have gone unnoticed for as long as the
audit rows outlive the children they describe. See [[conventions]].

### Why purging works at all, given append-only tables

Because of a decision made in `0005_audit_triggers.sql`: `audit_events.detail` records column
**names**, never values. So the audit trail contains no personal information about a child —
only "somebody changed `health_conditions` on this date".

A child's record can therefore be destroyed while the evidence that it existed, and that it
was deliberately deleted, by whom and why, survives. Had the trigger logged `to_jsonb(NEW)`
this would be impossible without also destroying the audit trail. The suite asserts both
halves: that the purge is recorded, and that no name or medical detail survives in it.

Consent is append-only against *edits* and still deletable by a purge, which is the right way
round: the point of append-only was that a consent decision cannot be quietly **changed**, not
that a departed family's file is kept forever.

### Guardians are purged separately

`child_guardians` cascades; `guardians` does not. Left alone, the contact details of a family
who left seven years ago sit in the table indefinitely — exactly what IPP 9 is about.

`purge_orphaned_guardians` is separate from `purge_child` rather than folded into it, because
the same person is often guardian to siblings and removing them alongside the first child
purged would strip the remaining sibling's record of a contact. It never touches a guardian
who has an app account: that is a person with a login, and removing them would break their
access rather than tidy up a contact card.

### `detail_confirmations` holds a date and deliberately nothing else

Added 2026-08-09 by `0055`. Append-only, one row each time a guardian says their child's
details are current — and it is on this page rather than only on
[[parent-self-service]] because **what it refuses to store is a retention decision**, not a
product one.

The richer design copies the guardian's phone and address into the row so the product can say
"confirmed, and nothing has changed since". That is a real question and this table cannot
answer it. It is refused because the snapshot would be a **second copy of a family's contact
details living under a different rule from the first**: `guardians` is purgeable when a child
leaves, and a frozen duplicate on an append-only table can be neither corrected nor purged.
IPP 9 cuts against holding one.

The question stays answerable without the copy. `guardians` carries the shared audit trigger,
so a change to a family's details already has a timestamp — "has anything changed since the
last confirmation" is a comparison against `audit_events`, not a column here. That comparison
is office-only, because a guardian cannot read `audit_events`.

Purging needs nothing new: both foreign keys are `on delete cascade`, so `purge_child`'s
`delete from public.children` takes the confirmations with it, and so does
`purge_orphaned_guardians`. This is the same shape as consent — append-only against *edits*,
still deletable by a purge, which is the right way round.

### Rejected: automatic deletion on a schedule

`children_due_for_purge()` lists what is due; nothing calls it on a timer. Retention is
currently a thing somebody has to remember, which is a real gap — but automating irreversible
deletion of children's records without a human looking at the list first is a bigger one. It
needs a decision, not just a cron job.

### Rejected: hard-coding the retention period

It is a function parameter (`p_retention_years integer default 7`) so it can be corrected
without a migration. The figure assumes funding-relevant records must survive a Ministry
funding audit. **Unconfirmed** — see [[unverified-claims]].

### The insurance gate, and its removal — 2026-08-29

From 2026-08-04 this product held itself to a rule of its own devising: schema and screens could
be built, because writing code puts nobody's information anywhere, but *"the line not to cross
without cover is a real child's allergies being typed in"*.

**The owner removed that gate on 2026-08-29**, after it was traced to a bullet in a day-one list
of open questions rather than to any external requirement — no statute, no Ministry criterion, no
clause in the services agreement, and no mention anywhere in `privacy-statement.md`,
`breach-response.md` or `AGENTS.md`. The full record, including what the rule conflated, is in
[`docs/tenant-little-pearls.md`](../../docs/tenant-little-pearls.md) under *The gate that was
lifted*, and [[unverified-claims]] item 35 is closed by decision rather than by an answer.

**Nothing on the rest of this page changes.** Insurance was never what protects the data — the
retention schedule, the purge path, the redaction in error reports and the RLS boundary are, and
all four are untouched. A commercial caution being lifted is not a licence to relax any of them,
and if this entry is ever read as one, it has been misread.

### Error reports are a disclosure surface

An error report is a copy of whatever state the app was in when it broke, and Postgres is
helpful in exactly the wrong way — a constraint violation quotes the offending value back.
`beforeSend` in `apps/web/src/lib/observability.ts` redacts emails, phone numbers, dates of
birth and quoted row values; UUIDs are kept, because they identify a row without describing a
person. The same scrubbing runs on messages shown to the *user*, via `actionError`.

It has its own tests, because a bug there does not produce a wrong screen — it sends a child's
medical information to a third party.

### The pre-wipe backup

`.backups/zelva-pre-wipe-2026-08-04.json` held the previous occupant of this database: 34
tables, 6,184 rows, six user accounts and their forum posts. **Deleted 2026-08-04.**
`.gitignore` still covers `.backups/`, so the next one is also kept out of git.

Two corrections worth keeping. It was described in an earlier session as sitting inside a
OneDrive folder and therefore as having been copied to Microsoft — **that was wrong.** This
repository is at `C:\dev\ece`; the OneDrive-synced repository on this machine is a
different one. The file never left local disk. And the residual risk was not zero for the
right reason either: gitignoring prevented it reaching git, which is a different guarantee
from it not existing.

## See Also

- [[compliance-and-evidence]] — IPP 6 and staff records
- [[tenancy-and-rls]] — the audit trigger and what it records
- [[model-calls]] — the fourth processor, and the cross-border disclosure the type system prevents
- [[unverified-claims]]

*Last updated: 2026-08-09*
