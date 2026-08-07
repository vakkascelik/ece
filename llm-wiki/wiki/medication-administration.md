# Medication administration

The other half of a medication record: `medication_authorities` says a guardian agreed,
and until 0032 nothing said anybody gave the child anything.

## Overview

Phase 8's second table. The authority answers *were we allowed to*; the question a review
actually asks is *what did you give, when, and who gave it*. Only the first was implemented,
for eight phases, which is half a licensing requirement.

Append-only, for the strongest version of the reason: a medication record that can be edited
after the fact is worth nothing in the one conversation it exists for — the one that starts
with a child having had a reaction.

## Key Points

- **Append-only**, with `UPDATE` and `DELETE` withheld from everybody including `service_role`.
  A correction is a new row citing `corrects`.
- **A dose outside the authorised window is refused**, not warned about. This cannot be a
  `CHECK` — it reads another table — so it is a trigger.
- **The window is evaluated in the centre's timezone**, or the morning of the first authorised
  day would be refused.
- **`child_id` is denormalised off the authority** on purpose, and the trigger asserts the two
  agree so it cannot drift.
- **The witness rule is a centre setting, defaulting to off**, because whether a second
  signature is required is a claim about the criteria that nobody here has read.
- `client_uuid` is the same idempotency contract as attendance, for the same reason.

## Details

### Why the window check is a trigger and why it is a refusal

`starts_on` and `expires_on` live on `medication_authorities`, so a `CHECK` constraint cannot
see them — a constraint may not reference another table. That leaves a `BEFORE INSERT` trigger.

It refuses rather than flags. Giving a child a prescription medicine outside the period their
guardian authorised is the precise event the authority table exists to prevent, and a product
that records it politely has helped nobody. This is the opposite call from the ratio banner,
which warns rather than blocks — the difference is that a ratio breach is a situation to
manage, and this is an entry somebody is about to make about something already done.

### The timezone bug this would have had

```sql
select (new.given_at at time zone ce.timezone)::date into v_given_date …
```

Not `::date` on a UTC instant. A dose given at 9am in Auckland is 9pm *yesterday* in UTC, so a
UTC date would place the morning of the first authorised day outside the window and refuse it.
That is the fourth and fifth incarnation of the bug 0006 and 0029 record, and here it would
have arrived as the product refusing to let a teacher give a child their antibiotics. The
assertion added in 0029 — no function body may take a calendar day from the session zone —
would have caught it had it been written the wrong way.

### Why `child_id` is denormalised

Two reasons, written into the migration because either would be re-normalised away by somebody
tidying:

1. Every policy evaluation would otherwise join to `medication_authorities` to find the child.
2. `purge_child` deletes the `children` row and relies entirely on cascade. A table that
   reaches its child through a second table depends on that table's cascade firing first. One
   hop cannot be got wrong.

The trigger asserts the row's `child_id` equals the authority's, so the copy cannot drift into
a record naming one child and citing an authority for another.

### The purge assertion that had never existed

`incidents` and `medication_administrations` are the first tables whose `on delete cascade` is
asserted rather than assumed. A child-linked table declared `on delete set null` instead breaks
`purge_child` in one of two ways — the row survives as an orphan holding the medicines a child
was given, which nothing would report, or it blocks the purge outright — and neither is visible
in any other test.

`incidents` is the interesting half of that assertion: `DELETE` is revoked on it for every role
including `service_role`, and the purge still takes it, because **a referential action runs as
the table owner and does not consult grants**. That is the mechanism the whole append-only
design rests on, and it is now checked rather than believed.

### Rejected: an audit trigger

The row *is* the record. An audit row describing an insert that can never be followed by an
edit says nothing the table does not already say. Both the isolation suite and
`scripts/security-review.ts` carry the exemption **by name**, so a future mutable table cannot
inherit it silently — which is the failure mode the audit-coverage assertion exists to catch.

### The witness rule, and what it deliberately does not claim

`centres.medication_requires_witness` defaults to **false**. Many services require two staff to
sign for a medicine; whether that is a licensing requirement or widely-adopted good practice has
not been read out of the criteria here. Defaulting to true would encode a regulation nobody
sourced, and a centre hitting the refusal would reasonably conclude the law requires it.

Off by default asserts nothing, and the control is still real the moment a centre turns it on —
the trigger refuses an unwitnessed dose, and the suite asserts it in both positions, because a
setting only ever exercised in the off position is a setting nobody knows works. Recorded as
item 22 in [[unverified-claims]].

The window check is **not** in that category and is enforced unconditionally: it is not a
regulatory reading, it is what the authority record already says.

## See Also

- [[incident-register]] — the other Phase 8 table, and the harder RLS problem
- [[unverified-claims]] — item 22, the witness rule
- [[conventions]] — the timezone rule, now enforced in both languages
- [[privacy-and-retention]] — why the cascade is load-bearing
