# Funding and billing

Attendance into money, in two directions that pull against each other — and one thing this product
deliberately cannot do.

## Overview

Phase 5 turns recorded attendance into a funding claim and held bookings into an invoice. Those are
two different sources, and keeping them apart is the point of the phase.

A **funding claim** comes from `attendance_events`: the Crown pays for hours actually delivered, and
a claim built on what was *planned* would be a claim for hours nobody observed.

An **invoice** comes from bookings: a family is charged for the days they held, because a centre
cannot resell a Tuesday somebody did not turn up for.

Because hours become a claim on the Crown, the single most important property in this phase is that
**nothing is estimated**.

## Key Points

- **A day whose record is broken is excluded and named, never guessed.** Not estimated up, not
  silently zeroed.
- **Every rounding decision goes down.** `toHours` floors to two decimals.
- **Corrections supersede what they correct**, transitively — otherwise a fixed sign-in time is
  counted twice.
- **The daily cap is applied before the weekly one.** The other order over-claims.
- **RS7 submission is impossible** and every label says "preparation".
- **No funding rates exist anywhere in the product.** See [[unverified-claims]].
- Bookings are not attendance and neither substitutes for the other.

## Details

### Why a broken day is excluded rather than estimated

A child signed in at 8:00 with no sign-out attended *something*, and an unknown amount of it. Three
options, and only one is defensible:

| Option | Consequence |
|---|---|
| Estimate to a normal day | Over-claims. A false claim to the Crown |
| Silently count zero | Understates, loses the centre funding it is owed, and **hides the record error** |
| **Exclude it and name the day** | The centre fixes the record and re-runs. Conservative, and the error becomes visible |

`attendedHours` returns `claimableMinutes` (complete days only) alongside `unresolvedMinutes` and
`unresolvedDays`, so the export can show what resolving a day is *worth* without claiming it. The
funding page lists the dates rather than a count, because a manager fixing three missing sign-outs
needs to know which three.

A **duplicate sign-in** is reported and does *not* make a day unclaimable — withholding a day's
funding over a double-tap would be punishing a centre for a UI slip. The first sign-in is taken,
because that is when the child arrived.

### The cap ordering, which is easy to get backwards

Daily cap first, then weekly, on what survives.

With a 6h daily and 20h weekly cap, an 8-hour Monday and a 4-hour Tuesday:

- **Daily first:** `min(8,6) + min(4,6) = 10`, then `min(10,20) = 10`. Correct.
- **Weekly first:** `min(12,20) = 12` — two hours nobody was entitled to, because Monday's excess is
  not transferable to Tuesday.

Tested directly. The weekly cap is applied per **ISO week**, so a fortnight is not capped at 20.

Caps apply only where the 20 Hours ECE attestation is in force. Without it there is nothing to cap,
and applying one anyway would understate an ordinary fee-paying enrolment.

### Rounding, deliberately downward

`toHours(59)` is `0.98`, not `1`. A hundredth of an hour per child per day is still over-claiming,
and the direction of a rounding error in a Crown claim should never favour the claimant. The total
is floored again after summing so it cannot creep above the sum of its parts.

### What cannot be built: submission

Submitting a funding return requires being a Ministry-approved student management system integrated
with ELI. The Ministry is not accepting integration applications, and approval requires supporting
**50 services before you may apply**. That is the one thing the regulatory position genuinely
forecloses.

So the output is a **preparation export**: figures a manager keys into ELI Web. Every label says
"preparation" and none say "return", "submit" or "file". That is not pedantry — a screen that looks
like it filed something is a screen after which nobody files anything. `exportDisclaimer()` generates
the wording from the summary, so it cannot say "complete" when it is not, and lives in `@ece/core`
so a future emailed version says the same thing.

### Rejected: Stripe, for now

The plan said "invoicing with Stripe". The invoice is built and the collection is not, for three
reasons:

1. **Nobody pays yet.** The pilot is free, so payment collection is speculative work against an
   unknown flow — and the flow is the part that turns out to be wrong.
2. **Most centres already collect**, through their accounting system or their bank. An invoice they
   can produce and reconcile is worth more than a second payment rail nobody asked to run.
3. **Stripe is a large surface** — keys, webhooks, disputes, refunds, PCI questions, a live account
   in the centre's name. None of those are decidable while the price is NZ$0.

`payments` records money that arrived, entered by whoever reconciled it. Wiring Stripe later means
adding a source column and a webhook, not restructuring anything.

**`recordPayment` dated it in UTC until 2026-08-07.** The default for `paid_on` was
`new Date().toISOString().slice(0, 10)` — forbidden by name in [[conventions]] and in AGENTS §4.3,
and written anyway, in a file added four phases after the rule. For the whole New Zealand morning
that is yesterday, so a payment reconciled at 9am on the 1st would have landed in the previous
month and disagreed with the bank statement it was keyed from. It never produced a wrong figure,
because nothing calls `recordPayment` yet — the invoice is built and the collection is not, per
the section above. Fixed to `todayInZone()`, and the rule is now enforced by a source-scanning
test rather than by remembering it. See [[conventions]] for the guard and for the three
`default current_date` columns still outstanding in SQL, one of which is on a medication authority.

### Rejected: a stored invoice total

`invoice_totals` is a view over the lines. A cached money figure drifts from its own detail the first
time a credit is added inside a transaction that fails halfway, and a total that disagrees with its
lines is worse than a slow query.

**A credit is a negative line, not a second table.** One table means the total is a sum and cannot
disagree with itself; two would mean an invoice total and a credit total that a reader has to
reconcile, which they will do wrongly.

### Issued invoices freeze — which took three mechanisms, not two

The write policy on `invoice_lines` requires `status = 'draft'` — on **every** verb, which took
until `0025` to be true. See the correction below. Changing what a family was billed
after they were billed it is not an edit — it is a different invoice. 
**CORRECTED 2026-08-07, and this is the second time this exact claim has been wrong.** The page
said "the write policy on `invoice_lines` requires `status = 'draft'`" and the enforcement had a
hole in it for five phases: the policy was declared `FOR ALL` with the status condition in its
**WITH CHECK only**, and PostgreSQL checks USING for DELETE, not WITH CHECK. So a line could be
DELETED from an issued, paid or void invoice by any owner or manager of that centre with a JWT.

Because a credit is a negative line by design, that moves the total in either direction: remove
the "centre closed" credit and the family owes MORE than the invoice they hold, after issue, with
no void-and-reissue and no reason recorded. `invoice_totals` is a view, so the app would show the
new figure while the family's copy showed the old one — the outcome `0021` and the trigger were
built to prevent, reached in one statement instead of three.

`0022` is not to blame. It split fourteen `FOR ALL` policies into insert/update/delete by reading
the expressions out of the catalogue and re-issuing them verbatim, precisely so a transcription
error was impossible — and it preserved this asymmetry exactly as it found it. What it could not
see is that `FOR ALL` was **already** asymmetric. The general hazard, now asserted in
`rls_isolation.sql` for every table rather than reasoned about per table: *a narrowing condition
placed only in WITH CHECK is not enforced on DELETE.* `0025` carries the fix, an assertion on the
verb, an assertion on the class, and an allowlist for the two tables where the difference is
legitimate.

Voiding requires a reason and
keeps the reference, because a deleted invoice takes its number with it and the next one reuses it,
so two different amounts end up sharing one reference in a family's records.

**That policy alone did not achieve it, and this page said it did for two days.** `invoices.status`
carries a column UPDATE grant, because an owner has to be able to issue an invoice — so the sequence
was: set the status back to `draft`, edit the line (now permitted), re-issue. Three ordinary
statements, no privilege escalation, and no audit trigger on `invoices` to record any of it.

`0021` adds a transition trigger: no return to draft, no reinstating a void, and the reference,
recipient, period, centre and issue date fixed once issued. A note can still be added, because a rule
that blocks ordinary work is a rule somebody removes. A CHECK constraint could not do this — a CHECK
sees one row and cannot see the row it replaced, and "was this already issued" is a question about the
transition. See [[security-review]].

Payments are append-only in the policies *and* the grants. Correcting a receipt means recording the
reversal, as with attendance and consent.

### Why bookings are not `enrolments.days`

An enrolment carries the contracted pattern; a booking is what is planned for a specific date. They
diverge constantly — a swap for one week, a family holiday, a public holiday. Rolling them together
would mean editing a funding-relevant contract every time a parent asks for a Thursday, and losing
what the contract actually says.

`booking_status` distinguishes `absent` (booked, did not attend, usually still charged) from
`cancelled` (withdrawn in time) from `closed` (the centre was shut, so nobody owes anything). That
distinction is the difference between a correct invoice and an argument.

### The waitlist is not a child record

A waitlist entry is a name, a phone number and a hoped-for start date. Creating a child record for it
would put somebody who may never attend into the roll, the ratio and the retention schedule.

It is owner and manager only, and **invisible to every parent** — it is a list of who is ahead of
them, which is not theirs and is how an ordinary wait becomes a complaint. No DELETE: "were we ever
offered a place" is a question families ask.

### The reconciliation

```bash
ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=… npm run reconcile:funding
```

Writes a fortnight whose correct answer is worked out **by hand in the script's comments** — a day
over the cap, a split day, a correction, a missing sign-out, and a child without the attestation —
then compares. Expected values are arithmetic a reader can check, not a snapshot, which would only
prove the code agrees with itself. 13/13 as at 2026-08-04.

It refuses to run twice against the same child, because attendance is append-only and a second run
would double the figures. Clearing it needs `seed:demo -- --purge`, which cascades from the children —
attendance cannot be deleted by the app or the service role at all.

That constraint also broke a first version of the assertion: it expected `unresolvedChildCount === 1`
and got 4, because other demo children carried unpaired events from earlier probe runs that could not
be cleaned up. The fix was to assert on the child under test, not to loosen the schema — and it
incidentally demonstrated the calculation working on genuinely messy data.

### Arrears (0045): derived, and it trusts the money rather than the label

A view, under the same rule as the section above — a stored balance drifts from its own detail,
and this one moves every time a payment arrives.

**`invoices.status` may say `paid`. That is a label somebody set; the payments are the fact.** So
`paid` invoices are *included* in the view rather than filtered out, and if the payments do not
cover the total, the balance shows up regardless of what the status claims. An invoice marked paid
that is not paid is precisely the row a centre needs to see, and a view that filtered on the label
could never show it. Asserted directly, and mutation-tested by narrowing the filter to
`status = 'issued'` — which fails on exactly that line.

`draft` and `void` are excluded: nothing issued, or withdrawn.

**No ageing in SQL.** The view returns two integers and a date; `summariseArrears` in `@ece/core`
decides what is late, against a date the caller resolves with `todayInZone(centre.timezone)`. Every
date bug in this repo has come from computing a calendar day in the wrong zone, and this is the
same split `ratios.ts` makes between the maths and the numbers.

Three judgements in that module, each tested by name:

- **An invoice with no due date cannot be aged**, and gets `no-due-date` rather than being folded
  into "current". A centre that never sets due dates would otherwise read a clean report and
  conclude nobody is late — the same failure shape as an unstated sleep-check interval.
- **Credits are never netted against arrears.** One family $200 in credit does not make another
  family's $200 debt disappear, and a single "net owing" figure would say exactly that.
- **Nothing owed is not in arrears**, whatever the date says. A settled invoice three months past
  its due date is not a debt, and listing it as one is how a report stops being read.

The buckets are 30/60/90 and there is no `ARREARS_VERIFIED` flag, deliberately: ordinary accounting
convention, no rule asserted, no consequence claimed. That is the difference between this and the
ratio bands.

### Claimed against received (0046), and the figure this product refuses to compute

`reconcile:funding` reconciles the **calculation** against arithmetic worked out by hand in its own
comments. It has never compared a claim to money, and could not: there is no Ministry figure
anywhere in this repo.

`funding_receipts` is the other half. The reason it is worth building is one sentence — *a centre
that finds an under-claim renews without a conversation.*

**Both figures are entered by the centre, and neither is computed.** The obvious design takes the
funded hours this product already calculates, multiplies by a rate, and compares. **There are no
rates here**, deliberately, and publishing one nobody has checked would make every variance on the
screen a fiction with a dollar sign on it. So the centre enters what it keyed into ELI Web and what
its bank shows, and the product does the subtraction and nothing else. A smaller feature than it
first appears, and the only version that is true.

Three judgements, each asserted:

- **A null claim is "not stated", not zero.** Zero would make every unfilled period look like a
  total overpayment and bury the real ones. The screen says *cannot compare*.
- **Shortfall and overpayment are never netted.** They are two different phone calls, and a single
  figure hides one behind the other.
- **Money with no date is refused** by a CHECK constraint — a receipt that cannot be matched to a
  bank statement is not a reconciliation.

**One row per period, and what that costs.** ECE funding is paid in instalments with a wash-up, so a
period can be paid more than once. This holds a running total and the individual payments are *not*
itemised — stated rather than hidden. What survives is the audit trail: the table carries the audit
trigger, and the suite asserts a wash-up produces an `update` row naming the period. If itemising
turns out to matter it is a child table, not a rewrite.

The variance sits at the foot of `/funding` rather than on its own page, because the figures above it
are what this product calculated and these are what the Ministry actually paid. Reading them apart
is how an under-claim goes unnoticed for a year.

### The accounts screen, and the first money this product has rendered

`/billing`, behind `manageCentre`. It exists before any screen that *creates* an invoice, because
a centre reconciling payments in its own accounting system still needs to know who is behind, and
that is answerable from what the schema already holds.

**Read-only, deliberately.** Nothing here issues, edits or voids. Those are guarded by a transition
trigger and a policy that freezes an issued invoice, and putting a button on this page would mean
reproducing that reasoning in a form. A screen that only reports cannot break the ledger.

`formatCents` in `@ece/core` is the first money formatter in the repo — `packages/api` has had
invoices since Phase 5 and no page imported them, so no cents value had ever reached a display. It
**neither rounds nor floors**: `toHours` floors on purpose because the direction of a rounding error
in a Crown claim should never favour the claimant, but cents are exact and a formatter that adjusted
one would disagree with the invoice the family is holding.

### An e2e fixture cannot seed a payment, and that is the guarantee working

Seeding a part-paid invoice for the accounts screen broke the **teardown**, twice, in two different
ways:

1. `payments.invoice_id` is `on delete restrict`, so a payment pins its invoice and the cascade from
   `centres` dies with a foreign-key violation.
2. Deleting the payments first is `permission denied for table payments` — DELETE is withheld from
   **`service_role` as well as `authenticated`**, because money that arrived is append-only.

Every prior run had invoices with nothing paid against them, so neither had ever been reached. A
failing teardown is worse than a failing test: it strands accounts and centres in a live project,
which is how fifty-six users once accumulated.

The fix was to stop seeding the payment, not to route around the restriction. The alternative —
reaching for the Management API in the teardown, which runs as `postgres` and would work — hands the
e2e suite a credential it deliberately does not have, and would make CI need a project-wide token to
clean up after itself. Part payment is covered where it costs nothing: in unit tests, and in the RLS
suite, which inserts a payment inside a transaction it rolls back and therefore never has to delete.

### The view mutation that changed nothing, and the class check it produced

Turning `security_invoker = off` on `invoice_arrears` and running the **entire** isolation suite
changed nothing — 350/350, including an assertion labelled *"security\_invoker carries the
boundary"*.

It does not. `invoice_arrears` joins `invoice_totals`, which is itself an invoker view, and the
nested one kept enforcing the boundary. The assertion was passing for a reason other than the one
its label claimed, and would have gone on passing until somebody rewrote the join to read
`invoice_lines` directly — at which point the boundary would have rested entirely on a setting
nothing was checking.

Verified rather than assumed, on both sides: a probe view with `security_invoker = off` over
`centres` returns **5 rows to a caller with a random `sub`** who is a member of nothing.

The fix is a class-level assertion reading `pg_class.reloptions`: **every view in `public` must
declare `security_invoker = on`.** It cannot be satisfied by accident, it names the offender when
it fails, and it covers every view added after it. The behavioural assertion was relabelled to
claim only what it actually proves.

## See Also

- [[attendance-and-ratios]] — where the events come from
- [[unverified-claims]] — the caps, and the absence of rates
- [[compliance-and-evidence]] — the other thing attendance is evidence for

*Last updated: 2026-08-09*
