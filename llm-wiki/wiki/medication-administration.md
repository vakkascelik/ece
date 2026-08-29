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

### The screen, and the one bug that needed a browser to find

Dosing lives on the child record, in the same table that already listed the authorities —
because "we may give this" and "we gave this at 9:04" are the two halves a review asks for and
only the first existed. A **Given today** column now sits beside **Status**.

The dose field is prefilled from the authority and **editable**. Half a dose because the child
spat it out is the entry a reviewer most wants to find, and a read-only field would force
somebody to record something untrue.

`Record a dose` is offered only while the authority is in force. The trigger refuses an
out-of-window dose regardless — the UI gate is about not presenting a form that was always going
to be rejected, which is a different job from enforcing the rule. Neither the window nor the
witness requirement is re-implemented in TypeScript; the action turns the database's refusals
into sentences and nothing more, because a second copy of the rule is the copy that drifts.

**The `client_uuid` lifecycle is the dangerous part.** `ON CONFLICT DO NOTHING` means a repeated
key is discarded *and reported as success*. A component that minted its key once at mount would
therefore discard the 2pm paracetamol as a duplicate of the 10am one and tell the person it
worked. A silently dropped medication record is far worse than a duplicated one, which is
visible and correctable with `corrects`.

So the key is minted per submission, refreshed after every success, and held stable while a
submission is in flight — which is also what makes a double-click safe. It is generated in an
effect rather than in `useState`'s initialiser, because the component server-renders first and
two different random values across the hydration boundary is a mismatch.

**None of that is visible to `test:rls`.** At the database both statements look identical; the
suite proves the contract and cannot see which key the browser chose. So `medication.spec.ts`
gives the same medicine twice and asserts *two* entries appear. Mutation-tested: with the key
pinned at mount, the second dose vanished and the test failed on `toHaveCount(2)` receiving 1 —
the exact production bug, reproduced.

The first version of that test asserted on the dose *text* and matched two elements, because the
authority's own Dose column also reads "150 mcg". It now counts list items. Amusing in context:
the test was conflating permission with administration, which is the conflation this whole table
exists to undo.

### A second hardcoded list that silently omitted the new thing

`medication.spec.ts` did not run when first written. The `owner` project in
`playwright.config.ts` selects specs with an explicit regex — `/(a11y|journey|roles|offline)\.spec\.ts/`
— and a file not named there is skipped with no output saying so.

That is the **second** instance of this shape in one session: `roles.spec.ts`'s `MATRIX` had
already let `/incidents` pass unchecked. Both are now updated, and the config carries a note that
a third occurrence should turn the list into a glob with named exclusions. A green run that
silently covered nothing is the failure mode `bounded-queries.test.ts` and
`localDates.test.ts` both guard against in their own domains — worth noticing that the *test
harness* has the same disease.

## See Also

- [[incident-register]] — the other Phase 8 table, and the harder RLS problem
- [[unverified-claims]] — item 22, the witness rule
- [[conventions]] — the timezone rule, now enforced in both languages
- [[privacy-and-retention]] — why the cascade is load-bearing

*Last updated: 2026-08-08 — date taken from this file's last commit, because the page was written without the footer `llm-wiki/schema.md` requires and no other record of it exists.*
