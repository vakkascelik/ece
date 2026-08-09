# Parent self-service

*The first write a family may make to the centre's own records, and the reasoning that made it
safe to hand over.*

Migrations `0051` (absence), `0052`–`0054` (enrolment enquiries), `0055` (confirmations). Code: `report_absence` and
`submit_enrolment_application` in SQL, `packages/api/src/enquiries.ts`, `BookingsPanel` on the
child record, `apps/site/src/app/enrolment`, and `/enquiries` in the web app.

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

### What is not asked — and a correction to 0052

**No name, no date of birth, no NSN, no health information, no immunisation status.** Every
one is useful for placing a child and every one is personal information about a **third
party** — the child — supplied by somebody this product has not authenticated and cannot
verify is their guardian.

> **0052 got this wrong and 0054 fixes it.** I shipped `child_name text not null` and an
> enquiry that could not be filed without naming a child. `apps/site/src/app/enrolment/page.tsx`
> had already decided otherwise, in a comment written when the site was built:
>
> *"When an enquiry form is built it will collect the guardian's details and a coarse age
> band, and it will not ask for a child's name or date of birth."*
>
> With two reasons, both stronger than mine. `docs/tenant-little-pearls.md` holds this
> deployment to **zero personal information** until professional indemnity insurance is in
> place — a public endpoint writing an identifiable under-five into this database crosses
> the line that doc exists to hold, on the weakest lawful basis in the product, because
> nobody has signed anything. And: **the centre does not need a child's name to phone a
> guardian back.**
>
> 0052 argued a first name was "the least this can be". That is reasoning from the table
> outwards. From the family inwards it is not needed at all — the enquiry is a request for a
> conversation with an *adult*, whose name is already on the row. The page was right and the
> schema was wrong, so the schema changed.

What is asked instead is a **coarse age band** — `expecting`, `under-2`, `2-and-over` —
which answers "which room, roughly when" and nothing else. `expecting` is a real case:
families join waitlists before the child is born, and a nullable birth month could not say
so.

`child_name` survives as a **nullable** column, because an enquiry the office takes by phone
from a family it has met may reasonably carry one. *The public form does not ask for it*,
which is a different statement from the column not existing — and the honest one.

### The idempotency key is email **and** age band

0052 keyed on email and child name so a family enquiring about a second child was not
swallowed. Without a name, the band carries that property: a family with a baby and a
three-year-old sends two enquiries and both land.

**What it cannot separate is twins.** Two children in the same band from one address inside
a single open enquiry collapse to one row. Stated rather than hidden — the fix is a
conversation, which is what an enquiry is for, and that is a better outcome than asking every
family for a child's name to disambiguate a rare case.

### Two assertions that pin the decision rather than the behaviour

A behavioural test cannot catch a child's name coming back, because whoever re-added the
parameter would write a test that passes it. So the suite reads the catalogue: the public
function **takes no argument matching `child_name`**, and the column **is nullable**. If
either changes, the suite fails and whoever changed it has to come and read the reasoning.

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

## The form and the queue

`apps/site/src/app/enrolment` for the public form, `/enquiries` in `apps/web` for the office.

### The narrow import, kept narrow

`apps/site` maps **only** `@ece/api/recruitment` and now `@ece/api/enquiries` — not `@ece/api`.
The marketing site deliberately cannot reach the rest of the query layer, and a public form
importing the module that also holds invoicing would quietly undo that. `packages/api/src/enquiries.ts`
exists to keep that property rather than because enquiries needed their own file.

### What the form asks

Guardian's name, email, optional phone, which centre, a **coarse age band**, optional start
date, optional days. Nothing about the child beyond the band.

The age question is a `<select>` and not a date input, because **a date field is a date of
birth however it is labelled**. "Not born yet" is a real option: families join waitlists
before the birth, which is exactly when a centre most wants to hear from them.

The centre's *current* form — Adobe Muse, posting to a 2018 PHP mailer — asks for the child's
full name and exact date of birth. Not carrying that forward is the point of this one.

### Three copies of the validation, on purpose

The table's CHECK constraints hold; `submit_enrolment_application` restates them so a caller
who is not the form gets a sentence rather than a constraint violation; `enquiryProblem` in
`@ece/core` restates them again so the form can say it next to the field. That is the same
arrangement `applicationProblem` documents, and 0027 exists because a version of it once
covered three fields out of six.

`enquiryProblem` has **no branch for a child's name**, and a test asserts the input shape does
not contain one — so a `childName` appearing there later is a visible change rather than a
quiet addition.

### The honeypot uses `.trap`, not `.visually-hidden`

A visually-hidden field is still in the accessibility tree, so somebody on a screen reader
might fill it in and have their enquiry silently discarded. **A trap that punishes blind
families is worse than no trap.** `display: none`, `aria-hidden`, `tabIndex={-1}`. The
reasoning is already in `globals.css` from the careers form; it is repeated here because the
next person to add a form will reach for `.visually-hidden`.

The honeypot returns the *same* sentence a real submission returns. Naming the centre back to
the family would be a nicety and would also let anything comparing two responses read off
which field was the trap.

### "Either centre" is two writes with no transaction

Copied wholesale from the careers action, including the reason the obvious `try` around the
loop is wrong: if the first lands and the second throws, the family is told "we could not save
that — please phone" while their enquiry is **already in the database** for one centre. They
phone as instructed, and staff hold one record and one call for the same event with no way to
know they are the same. There is no compensation to write either — `anon` has no DELETE. So
outcomes are collected and the truth is reported.

### The office screen has no "promote to child" button

Marking an enquiry `enrolled` is a label. Creating the child, the guardians and the enrolment
happens by hand on the other screens, after a conversation. 0052 refuses to automate the
moment a stranger's claim becomes the centre's record about a child — a button here would make
it a click.

The delete is **armed**, not immediate: a confirm step, the same pattern `/applications` uses.
Once removed, the audit row survives but holds no phone number, so the row is the only way to
ring the family back.

---

## Detail confirmations (0055)

*"How do you know these emergency contacts are current?"* — a reviewer asks it, and until this
migration nothing in the product could answer.

It held the details and the date they were **entered**, which is a different fact. A phone
number typed in 2023 and never touched is either correct or three years stale, and nothing
distinguished those two.

One row per confirmation, by one guardian, for one child. The newest answers the question; the
older ones answer *"how often does this family actually check"*, which is the follow-up.

### Append-only, and that is the point rather than a habit

UPDATE and DELETE are withheld from every role including `service_role`. **A confirmation that
can be edited answers nothing** — "last confirmed in March" is only worth saying if nobody
could have written it in April. Same treatment as `attendance_events`, `payments` and
`consent_events`.

No audit trigger, and it went into **both** exemption lists in the same commit —
`rls_isolation.sql` and `scripts/security-review.ts`. Earlier the same day `ai_requests` went
into one and not the other, and the second list was the only reason anybody noticed. See the
four-in-one-day pattern in [[conventions]].

### What it does not store, and what that costs

**No snapshot of what was confirmed.** The richer design copies the guardian's phone and
address into the row so the product can say *"confirmed, and nothing has changed since"*. That
is a real question and this table cannot answer it — stated here rather than discovered later.

It is refused because a snapshot is a second copy of a family's contact details living under a
different retention rule from the first, on an **append-only table that cannot be corrected or
purged**. `guardians` is purgeable when a child leaves; a frozen duplicate is not, and IPP 9
cuts against holding one.

The question is answerable without it. `guardians` carries the shared audit trigger, so an
update to a family's details is already recorded with a timestamp — "has anything changed since
the last confirmation" is a comparison against `audit_events`, not a column here. That
comparison is office-only, because a guardian cannot read `audit_events`, and that is the right
asymmetry.

**The screen says so.** The date is shown without a verdict: *"It does not mean nothing has
changed since."* A green tick reading "confirmed" over a phone number changed last week would
be worse than no tick — the same reasoning the sleep register uses when no interval is stated.

### Two halves in the insert policy, and both are asserted

- The child must be the caller's **ward** — `caller_ward_ids()`, which is guardianship, not
  visibility. An educator can see the child and has nothing to confirm about them.
- The guardian record must be the caller's **own**. A confirmation filed on a family's behalf
  is a record of an assurance they never gave.

Mutation-tested separately: dropping the second half is killed by *"a guardian CANNOT confirm
in another guardian's name"*, and granting the append-only verbs back is killed by *"NOBODY can
back-date a confirmation"*.

#### A correction: the second half hand-rolls a predicate that already exists

Found 2026-08-09 while updating this page, which is late — it should have been found while
writing it. The second half is written as a bare `exists`:

```sql
and exists (select 1 from public.guardians g
             where g.id = guardian_id and g.user_id = auth.uid())
```

`caller_guardian_ids()` answers exactly this question and answers it **more narrowly**: it
additionally requires a live membership *at the guardian's own centre* and
`archived_at is null`. The hand-rolled version checks only "this guardian row is mine", so two
things get through that the predicate would refuse:

- **A guardian record at another centre.** A caller who is a guardian at two centres passes
  `child_id in (select caller_ward_ids())` with a child at centre A while naming their own
  guardian record at centre B. `detail_confirmations` carries no `centre_id` — by design, it
  reaches its tenant through the child — so nothing else catches the mismatch.
- **An archived guardian record**, where the caller also holds a live one for the same child.

Neither is a cross-tenant *read*: the select policy is still `caller_may_see_child`. It is a
row that pairs a child with a guardian who has no business being named on it.

[[conventions]] already says this, under *"A policy that reads another table inherits that
table's RLS"* — **use the predicates** — and it was written down the day before this policy
was. Recorded here rather than quietly amended, because the interesting fact is that a
convention one day old did not survive contact with the next migration.

### A placement bug that looked like a policy bug

The first run failed on the very first insert with `new row violates row-level security policy`,
which reads as a broken policy. The policy was fine. The block had been placed near the end of
the suite — **after the offboarding sections revoke Priya's membership and archive Ana** — and
`caller_ward_ids()` requires a *live* membership by design, which 0004's own header states.

So every assertion in the block failed for a reason that had nothing to do with the thing under
test. The block now sits above the purge section with a note saying why, because the next person
to add a guardian-scoped assertion at the bottom of the file will hit exactly this.


---

## Related

[[tenancy-and-rls]] · [[funding-and-billing]] · [[kiosk-and-pins]] · [[conventions]] ·
[[unverified-claims]]

*Last updated: 2026-08-09*
