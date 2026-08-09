# Parent self-service

*The first write a family may make to the centre's own records, and the reasoning that made it
safe to hand over.*

Migration `0051`. Code: `report_absence` in SQL, `reportAbsence` in `packages/api/src/billing.ts`,
`BookingsPanel` on the child record.

---

## What a guardian may do, and the one-sentence reason they may

**Mark a booked day as `absent`. Nothing else.**

The safety argument is entirely in 0018's comment on the enum:

> `absent` = booked and did not attend (**usually still charged**). `cancelled` = withdrawn in
> time. `closed` = the centre was shut, so nobody owes anything.

So this write **cannot change what a family owes**. It is a *notification*, not a financial act,
and that is the whole reason it can be performed unsupervised at 7am from a phone. `cancelled` and
`closed` stay office-only, because those are the statuses that move money.

Everything else about booking remains office work, for the reason 0018 gives: a booking carries a
fee and the centre has a licence capacity to respect. A parent asking for an extra Thursday is
still a conversation.

---

## Why a definer function and not an RLS policy

The plan said *"a guardian-scoped policy on `bookings`"*. That does not work, and the reason is a
property of RLS rather than a preference:

> **A policy's `WITH CHECK` sees only the NEW row. It cannot say "and nothing else changed."**

An UPDATE policy permissive enough to let a guardian set `status = 'absent'` also lets them rewrite
`note` — a staff-facing field — and shift `from_time`, `to_time` and `on_date` on the same row.
Pinning those would mean comparing each column against its old value, which a policy cannot
reference. A trigger can see `OLD`; so can a function.

So `report_absence` is one narrow `SECURITY DEFINER` entry point, the same shape as
`kiosk_sign_child` (0044) and `submit_job_application` (0024). It writes the literal `'absent'` and
touches no other column.

Granted to `authenticated`, **not** to `anon` — so it does not touch `review:security` check 8 or
the allowlist that check maintains. That distinction matters: check 8's message explains why the
single anon-executable definer is safe, and adding a second anon one would require rewriting that
explanation, not just extending a list.

`bookings_write` is unchanged and still refuses a guardian outright. **Both halves are asserted**,
because a future migration adding a guardian-friendly policy would leave every test about the
function passing while opening a write path nobody designed.

---

## Today is allowed — a deliberate departure from the plan

The plan said *future dates only*. Taken literally that excludes the dominant case — a parent at
7am with a sick child, which is **today** — and a feature that refused today would be a feature
nobody used.

What is refused is the **past**. That is what the future-only instruction was really guarding:
retroactively rewriting a record of a day that has already happened. Note that even a retroactive
change could not avoid a fee, since `absent` still charges, so the guard protects the integrity of
the record rather than the money.

"Today" is the **centre's** today, from `centres.timezone` — never `current_date`, which is the
session's, which is UTC in production and thirteen hours wrong for half of every day.

---

## Outcomes, not exceptions

`report_absence` returns a status string and never raises, the same contract as `kiosk_sign_child`:
the caller is a parent on a phone, and every outcome is an ordinary thing rather than an error
anybody can act on.

| Outcome | Means |
|---|---|
| `recorded` | the booking is now absent |
| `already_absent` | it already was — reported as success would hide a double tap, as failure would alarm somebody who did the right thing |
| `no_booking` | not booked that day, so there is nothing to mark |
| `past` | the day has been and gone |
| `not_bookable` | cancelled or the centre was closed — somebody else's decision |
| `not_permitted` | not this caller's child |

`reportAbsence` in `packages/api` collapses an **unrecognised** status into `not_permitted`. A
status added to the function later must not be read by an older client as "it worked", because the
direction that fails in is a family believing they told the centre something they did not.

---

## The wording is the feature

The button says **"Tell the centre"**, and the panel says in as many words that this does not change
what you are charged and does not cancel the booking.

"Cancel" is the word people reach for and it is the wrong one — it names a different status with
different consequences. A parent pressing a button labelled *Cancel* would reasonably believe they
had stopped the charge. That is not a copy problem; it is a family discovering a bill they thought
they had avoided, and it is asserted in `absence.spec.ts` rather than left to review.

Only a `booked` day offers the control. A day already marked, cancelled or closed shows no button
at all — an enabled control that answers *"you cannot do that"* teaches people to distrust every
button on the page.

**Staff see the same panel without the column.** Not because they are less trusted — they have
`bookings_write` and the office screens — but because the button means *a family told us*, and a
manager pressing it would record that a family said something they did not.

---

## An assertion that lied, and how

The first version of the audit assertion ran **as the parent**:

```sql
select count(*) from public.audit_events where entity = 'bookings' ...
```

It failed, and the obvious reading was *"the trigger did not fire"*. The trigger had fired. **A
parent cannot SELECT `audit_events` at all**, so the count was zero because of the policy on the
reader, not because of a missing row.

An assertion whose subject cannot see its own evidence reports the wrong failure, and it would have
sent somebody looking for a bug in the audit trigger. It now reads as the owner, and a second
assertion states the correct asymmetry: the parent's action is recorded, and the parent cannot read
that record — the audit log holds every family's activity, not just theirs.

---

---

## Enrolment enquiries (0052, 0053)

A family who is not yet a customer asks for a place. Structurally this is
`job_applications` again — see [[recruitment]] for the design it copies — and the differences
are where the thought went.

### A separate table, not a `children` row

The same argument `waitlist` makes, for a sharper reason. Writing a stranger's claim into
`children` would put somebody who may never attend into the roll, the ratio, the funding
return and the retention schedule — and it would be a record **about a real child** created
by an unauthenticated caller who may have no relationship to them at all.

Promotion to `children` + `guardians` + `enrolments` is by hand. There is deliberately no
function that does it: the moment a stranger's claim becomes the centre's record about a
child is a moment somebody should be accountable for.

### What is not asked

**No date of birth, no NSN, no health information, no immunisation status.** Every one is
useful for placing a child and every one is a special category of personal information about
a **third party** — the child — supplied by somebody this product has not authenticated and
cannot verify is their guardian.

The birth *month* is asked instead, as free text. The real question is "which room, roughly
when", and a month answers it. A centre that needs the date gets it at enrolment, from a
person they have met, with a document. Same line 0024 draws in refusing CV attachments: the
value of the extra field is not close to the cost of holding it.

### The idempotency key is email **and** child name

Keying on the email alone would silently swallow a family enquiring about a second child,
which is the case a centre most wants to know about. Mutation-tested — removing the name
clause fails the assertion by name.

It returns quietly rather than raising, because *"you have already enquired"* is an oracle:
it tells anybody who asks whether a named family is looking at a named service. Same
reasoning as the uniform response on password recovery.

### DELETE is granted, which `waitlist` refuses

This table is written by unauthenticated strangers, so it accumulates spam and mistakes about
**named children**. A centre that cannot remove a junk row is stuck holding personal
information it never wanted, and IPP 9 cuts the same way: "needed" for a duplicate submission
is zero. The delete is audited, and afterwards the audit row is the only evidence the enquiry
existed.

### A test that passed for the wrong reason

Granting `anon` SELECT on this table **did not fail the suite.** The read still raised 42501 —
but on `permission denied for function caller_has_role`, not on the table. The SELECT policy
calls that predicate and `anon` has no EXECUTE on it, so the policy cannot even be evaluated.

Genuine defence in depth, and worth knowing. It also meant the behavioural assertion was
**insensitive to the grant being widened** — the same shape as the `security_invoker`
assertion that passed because of a nested view. The grant is now asserted directly against
`information_schema` as well, and that one fails the moment anybody grants `anon` anything
here, whatever the policies do.

---

## Related

[[tenancy-and-rls]] · [[funding-and-billing]] · [[kiosk-and-pins]] · [[conventions]] ·
[[unverified-claims]]

*Last updated: 2026-08-09*
