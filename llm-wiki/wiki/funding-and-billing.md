# Funding and billing

Attendance into money, in two directions that pull against each other — and one thing this product
deliberately cannot do.

## Overview

Phase 5 turns recorded attendance into a funding claim and held bookings into an invoice. Those are
two different sources, and keeping them apart is the point of the phase.

A **funding claim** comes from `attendance_events`: the Crown pays for hours actually delivered, and
a claim built on what was *planned* would be a claim for hours nobody observed.

> **HALF-RIGHT, and corrected 2026-09-04 rather than deleted, because the reasoning behind it is
> sound.** §9-2 of the Funding Handbook, read that day, calculates the subsidy from **enrolment**
> hours for a permanently enrolled child — step 1 is *"List the daily number of hours of enrolment
> for each permanently enrolled child"* — and from **attended** hours only for a casual or
> conditional one: *"list the number of hours each of these children attended"*.
>
> So the source depends on the enrolment type, and this product uses attendance for both. The
> hazard this sentence names is real — a claim for hours nobody observed is exactly what §6-4
> forbids for a casual child — but the Handbook's answer for a *permanent* child is that the
> observation which matters is **the agreement plus the absence rules**, not the turnstile.
>
> That is not "attendance plus absence funding" wearing a different hat. Starting from the
> agreement and deducting unclaimable absences is a different computation from starting at
> attendance and adding claimable ones, and the two diverge the moment a child attends *more* than
> their agreement. [[unverified-claims]] item 55 is the entry; `0085` is why the product can now
> hold the agreement at all.

An **invoice** comes from bookings: a family is charged for the days they held, because a centre
cannot resell a Tuesday somebody did not turn up for.

Because hours become a claim on the Crown, the single most important property in this phase is that
**nothing is estimated**.

## Key Points

- **A day whose record is broken is excluded and named, never guessed.** Not estimated up, not
  silently zeroed.
- **A period the records do not cover is a different failure, and it used to be invisible.**
  `complete` was true and the total was zero. See *Silence reads as zero* below.
- **Every rounding decision goes down.** `toHours` floors to two decimals.
- **Corrections supersede what they correct**, transitively — otherwise a fixed sign-in time is
  counted twice.
- **The daily cap is applied before the weekly one.** The other order over-claims.
- **RS7 submission is impossible** and every label says "preparation".
- **No funding rates exist anywhere in the product.** See [[unverified-claims]].
- Bookings are not attendance and neither substitutes for the other.

## Details

### Silence reads as zero — the period the records do not cover

Added 2026-08-29, and it is the counterpart to the section below rather than a variation of it.

`childFunding` splits a child's days into `complete` and `unresolved`. A child with **no
attendance rows at all** in the period yields an empty `inPeriod`, so both lists are empty:
`fundedHours` is 0 and `unresolvedDates` is `[]`. `unresolvedChildCount` is therefore 0, and
**`complete` is true**. The period reports zero hours and declares itself final.

That is correct arithmetic on the rows that exist and a false picture of the period. The
"excluded and named" treatment below **cannot fire**, because a period with no records is not a
broken record. It is silence, and silence reads as zero.

`FundingSummary.complete` already carried the warning that names the consequence — *"a summary
that looks final while three children have missing sign-outs is a summary that gets keyed into
ELI Web"* — and the failure was one step to the left of where its author was looking.

**When it bites:** the moment a centre starts using this product partway through a funding
period, which every centre does exactly once. RS7 periods are four-monthly, so the first return
after adoption necessarily spans days the record does not reach. It also bites permanently under
the [`Infocare copy arrangement`](../../docs/importing-infocare.md), where attendance history
deliberately stays in the other system.

**What was added.** `summariseFunding` takes an optional `AttendanceRecordStart` and returns
`recordStartsOn` plus `periodPrecedesRecord`. `readFundingPeriod` supplies it from the centre's
earliest `attendance_events.at`, converted through `todayInZone(centre.timezone)` — not sliced
off an ISO string, which would give the UTC day and report an 8am start as the previous date.

**Three states, and null is not false.** `true` = the record does not cover the period. `false`
= it does. `null` = nobody supplied a record start, so nothing is claimed either way. The
`overdue: null` contract from `drillStatuses`, and the banner renders the third state as *"whether
the attendance record covers this whole period was not checked"* rather than silently as coverage.

`{ startsOn: null }` is deliberately a **stronger** statement than omitting the argument: somebody
looked, and the centre has no attendance events at all. Every period precedes a record that does
not exist, so that case reports `true`, not `null`.

**`complete` was left alone**, and that is the same argument `ineligibleChildCount` already makes
for itself: it is a different kind of problem. An incomplete record cannot be calculated; this one
calculates fine over a period the records do not cover. One boolean carrying both would conflate
two failures needing different actions — *fix the record* versus *do not use this period at all*.
So the page now requires both conditions before it reads as usable, and the disclaimer leads with
this one, ahead of the unresolved-days sentence: an unresolved day announces itself in the total,
while this produces a total that looks finished and is simply too small.

Mutation-drilled, all three branches: `>` to `>=` failed the boundary assertion; the no-events
branch reporting `false` failed two; and `null` reporting `false` failed the two that keep the
third state apart.

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

With a 6h daily and 30h weekly cap, an 8-hour Monday and a 4-hour Tuesday:

- **Daily first:** `min(8,6) + min(4,6) = 10`, then `min(10,30) = 10`. Correct.
- **Weekly first:** `min(12,30) = 12` — two hours nobody was entitled to, because Monday's excess is
  not transferable to Tuesday.

Tested directly. The weekly cap is applied per **ISO week**, so a fortnight is not capped at 30.

#### The caps were wrong in both directions until 2026-09-04

~~Caps apply only where the 20 Hours ECE attestation is in force. Without it there is nothing to cap,
and applying one anyway would understate an ordinary fee-paying enrolment.~~

That was two defects in one sentence, and the second is the serious one.

**The weekly figure was 20, and the subsidy runs to 30.** §9-3: *"A maximum of 6 hours per day and
30 hours per week of funding can be claimed per child"*, of which *"20 Hours ECE hours must only be
claimed for up to 20 hours per week"*, and *"The remainder (up to 30 hours) may be claimed as Plus
10 ECE hours."* So 20 is the cap on a **component**, not on the week, and hours 20–30 were being
discarded for every attested child.

**And gating the caps on the attestation meant applying none at all to an unattested child.** The
ECE Funding Subsidy is claimable for an ordinary fee-paying enrolment; §9-2 caps it at *"a maximum
of 6 hours … each day for each licensed child-place"*. So a nine-hour day produced nine funded hours
where six were claimable — an **over**-statement, on the one figure this page promises never
over-states. [[unverified-claims]] item 54.

**Both fixed together, because they are one model.** The caps are now 6 a day and 30 a week for
every child, and for an attested child the week splits into `twentyHoursHours` (up to 20) and
`plusTenHours` (the rest) — the two figures RS7 asks for by name. `ChildFunding` carries both, the
CSV has a column for each, and the screen shows the split in the funded cell where there is a Plus
10 remainder.

**One good side effect worth recording.** `scripts/reconcile-funding.ts` asserted its main figure as
a bound — `fundedHours <= 28` — because a 20-hour weekly cap made the answer depend on which ISO
week each relative day landed in. At 30 it cannot bite on 28 hours however they fall, so that
assertion is now an equality. Raising a cap to the number the Handbook states removed the source of
the nondeterminism, rather than a looser assertion papering over it.

### Rounding, deliberately downward

`toHours(59)` is `0.98`, not `1`. A hundredth of an hour per child per day is still over-claiming,
and the direction of a rounding error in a Crown claim should never favour the claimant. The total
is floored again after summing so it cannot creep above the sum of its parts.

### What cannot be built: submission

Submitting a funding return requires being a Ministry-approved student management system integrated
with ELI.

**CORRECTED 2026-08-14 — this paragraph asserted two things as settled that are not.** It read:
*"The Ministry is not accepting integration applications, and approval requires supporting 50
services before you may apply. That is the one thing the regulatory position genuinely
forecloses."*

Both halves came from one reading of one page, and the page says something narrower.

1. **The closure had an expiry date that has passed.** The Ministry's integration page says *"We
   are not accepting integration applications in 2025. We will review our capacity to support
   new integration applications in July 2026."* It is now August 2026. Whether the review
   happened, and what it concluded, is **unknown** — the page may simply be stale. "Not
   accepting applications" is no longer a fact this wiki can assert.

2. **"50 services" is ambiguous and was read in the pessimistic direction.** The page says the
   system *"must support a minimum of 50 services"* across centre-based, home-based, sessional
   and all-day licensed models, listed among development requirements alongside *"must have all
   intended functionalities"*. That reads at least as naturally as a **capability** requirement
   — the system must be able to serve 50 services across those licence types — as it does a
   customer count. This repo assumed the customer count, which is the reading under which the
   whole thing is foreclosed.

The distinction decides whether ELI integration is a year away or unreachable, so it was
resolved by asking rather than by re-reading: an enquiry to `ELI.queries@education.govt.nz`
covering both points, plus a request for the ELI and NSI specification documents, which are
available on request only. Sent by the owner on 2026-08-14.

### ANSWERED 2026-08-18 — and the pessimistic reading was wrong

Three emails from Halaholo Mataele, Senior Advisor, Early Learning Information, Te Mahau |
Education Services. What was asked, and what came back:

| Asked | Answered |
|---|---|
| Has the July 2026 review happened; are applications open? | *"We are currently still in the review phase. Once the review process has been completed, we will provide an update on the outcome and any next steps."* **No date given** |
| Is "50 services" a customer count or a capability? | *"The product must be capable of supporting a minimum of 50 services across the relevant licence types."* **Capability** |
| Are there fees for integration, certification or ongoing participation? | *"The Ministry does not charge any fees for integration, certification."* |
| What security, privacy or assurance requirements must a vendor satisfy — a security assessment, penetration testing, a privacy impact assessment? | **Not answered.** The reply addressed fees only, and the question was one sentence in the same paragraph |
| May a service keep its Chapter 6 records outside an approved SMS and submit through ELI Web? | **Not answered as asked** — see below. Re-asked, and **answered 2026-08-31: yes, subject to four conditions** |

**"50 services" is a capability requirement, and the customer-count reading was the
load-bearing one.** There is no threshold of fifty paying services before a vendor may apply,
so ELI integration is not foreclosed by having one pilot centre. This repo asserted the
opposite in six places from Phase 5 onward — `README.md`, `packages/core/src/funding.ts`,
`packages/api/src/billing.ts`, the funding page, `docs/roadmap-phases-8-13.md` twice — and all
six are corrected in the same commit as this page. The wrong sentence stays recorded here
rather than being quietly deleted, because it decided a roadmap item: the roadmap listed an
ELI integration under *"what this plan deliberately does not do"* on exactly this reasoning.

~~**Applications are still closed**, so nothing can be applied for today.~~ **SUPERSEDED
2026-09-02 — the review concluded and applications are open. See *The review lifted* below.** The
sentence stayed true for fifteen days. What it got right is the part that mattered: the barrier was
*"a review with no published end date rather than a customer count that a two-centre pilot could
never reach. When it lifts, what stands behind it is an approval process, not fifty customers."*
It lifted, and that is exactly what stands behind it.

One consequence now confirmed rather than inferred: the capability requirement covers
**centre-based, home-based, sessional and all-day** licensed models, and `ratios.ts` models
all-day centre-based only. See [[unverified-claims]] item 1 — the tables are parameterised, so
that gap is data rather than logic, but it is a real gap against a stated requirement.

### The Chapter 6 question was not answered, and it is the one that matters

The question asked whether a licensed service may maintain its Chapter 6 enrolment, attendance
and absence records in a system that is **not** a Ministry-approved SMS, provided the service
meets Chapter 6's record-keeping and verification requirements — including the §6-3 criteria
for electronic verification — and submits to ELI through ELI Web.

The reply was: *"To integrate with ELI, a vendor must be an approved Student Management System
(SMS) provider."*

That answers a question about **vendor integration**. The question was about **where a
service's records may live**. They are different: this product does not integrate with ELI and
does not propose to. It produces figures a manager keys into ELI Web by hand, which is the same
act as keying them off a paper roll. Nothing in the reply says a service may not do that, and
nothing in it says a service may.

So the premise the whole product rests on is **unconfirmed** — not contradicted, not confirmed
— and must be recorded as neither. It has to be re-asked, narrowed to the service's obligation
rather than the vendor's, because as phrased it invited exactly the answer it got. Tracked as
[[unverified-claims]] item 37.

**It was re-asked, and it was answered. See the next section — the premise holds, and the answer
carries an obligation this product does not yet meet.**

### ANSWERED — the premise holds, and the answer is addressed to vendors as well as services

Received **31 August 2026, 6:53 am**, from `ELI.Queries@education.govt.nz`, marked
**`[IN-CONFIDENCE - RELEASE EXTERNAL]`**. The narrowed re-ask worked: the reply separates the two
perspectives the first one collapsed, and answers the question about the **service** rather than
the one about the vendor.

**Two things about the provenance are worth recording.** It comes from the **ELI Queries shared
mailbox and is signed by nobody** — unlike the 2026-08-18 reply, which came from a named Senior
Advisor. That makes it the team's position rather than one advisor's reading, which is arguably
the stronger form, but there is no individual to go back to.

And it carries a **New Zealand Government protective marking**. `RELEASE EXTERNAL` is the
endorsement that permits disclosure outside the originating agency, so quoting it here is within
the marking rather than in spite of it. Two consequences that are not obvious: this repository is
**public** (see [[security-review]]), so quoting it is publishing it — a decision taken knowingly
rather than by default; and the obligation in the next section should reach customers **in this
product's own words**, not by reproducing Ministry correspondence at them. A vendor telling a
customer what its own software does not do is a plain statement. The same sentence delivered as a
quotation from a marked government email invites the reading that the Ministry is speaking about
this product, which is exactly what the caution at the end of this section forbids.

**From the ELI side:**

> *"ELI does not prescribe how a service maintains its operational enrolment, attendance, and
> absence records. The ECE Funding Handbook explicitly states that providing data through ELI
> does not replace the enrolment, attendance, and absence records required for funding.
> Accordingly, a service may maintain its enrolment, attendance, and absence records in a system
> that is not a Ministry-approved SMS, provided the service continues to meet its ELI reporting
> obligations and submits the required information through ELI Web. Whether the records are held
> in a Ministry-approved SMS or another system is not, in itself, an ELI requirement."*

That last sentence is the one to keep. The approved-SMS question and the records question are
**not the same question**, which is exactly what this page argued on 2026-08-18 from the reply
that conflated them, and the Ministry has now said so itself.

**From the funding and compliance side**, four conditions, quoted rather than paraphrased because
they are the specification this product is now measured against:

> *"A licensed service may maintain its Chapter 6 records in a system that is not a
> Ministry-approved SMS, provided that:*
>
> - *the system enables the service to comply with all Chapter 6 record-keeping requirements;*
> - *electronic attendance records meet the section 6-3 electronic verification requirements,
>   where applicable;*
> - *records are available for audit and retained in accordance with Ministry requirements; and*
> - *the service submits the required information to the Ministry through ELI Web or another
>   approved ELI submission method."*

Records "can be maintained in a format that suits the service, but must be accessible when
requested by Ministry auditors."

**What this closes.** The premise the product rests on — a service may keep its Chapter 6 records
here, meet §6-3, and have a person key the figures into ELI Web — is **confirmed, conditionally**.
[[unverified-claims]] item 37 closes.

**What it does not close, and this is the part worth reading twice.** The four conditions are not
a finding about this product. They are a test this product must pass, and three of the four land
on work that is tracked here as open:

| Condition | Where this product stands |
|---|---|
| Enables compliance with **all** Chapter 6 record-keeping requirements | Not yet, and the gap is now one rule rather than a chapter. `0084` holds the enrolment type, §6-5's window, §6-6's suspension, §7-7's twelve weeks and §6-7's monthly check are implemented and mutation-tested. **§6-4's cross-child rule is not** — a service may not claim for both an absent permanent child and the casual child filling their place, and `childFunding` sees one child at a time. See [[unverified-claims]] item 6 |
| Electronic attendance records meet **§6-3** | Built across `0061`–`0065`, against twelve criteria a tool extracted from a web page rather than a person reading them. Item 36 |
| **Available for audit** and retained to Ministry requirements | The seven-year window is sourced; what it is measured *from* is not (item 3). And the restore drill is currently **red** — a CHECK constraint means a backup of the operational core older than fourteen days will not load (item 44). A record you cannot restore is not a record available for audit |
| Submitted through **ELI Web** or another approved method | Nothing here submits anything, deliberately. This is the condition the product was already designed around |

### The same answer names an obligation on the vendor, and this repo is the vendor

The last two paragraphs of the reply are not about services at all. They are addressed to
whoever writes the software:

> *"Where a vendor solution is used, the system may provide the capability to collect, store,
> manage, and summarise information to support the service's record-keeping obligations and
> manual ELI reporting. However, vendors should be clear with their customers that use of their
> system does not remove the service's responsibility to comply with Ministry funding,
> record-keeping, and reporting requirements.*
>
> *In particular, vendors should ensure customers understand that any RS7 information generated
> by their system is intended to support the service's completion of the RS7 return. The service
> remains responsible for reviewing, validating, and submitting the information provided to the
> Ministry. This includes understanding and addressing any over-claiming or under-claiming that
> may arise from attendance, enrolment, absence, or validation issues. There is no alternative
> pathway that avoids these accountability requirements; services remain responsible for the
> accuracy of the data submitted for funding purposes."*

**"Under-claiming" is the Ministry's own word, and this product already knows it under-claims.**
The funding disclaimer written on 2026-08-18 says the figures count attended hours only and the
total may be lower than what the service is entitled to claim. That sentence was written from
reading §6-4 to §6-7; it turns out to be the exact disclosure the Ministry expects a vendor to
make. Getting there first by reasoning does not make it a coincidence — it makes it the right
shape.

**What is missing is the other half.** Nothing in the product currently says that using it does
not remove the service's responsibility to comply, or that a person must review and validate the
figures before submitting them. The export is labelled a preparation export and every figure says
where it came from, which is close — but "this is preparation" is a statement about the document,
and the Ministry is asking for a statement about **who remains accountable**. Tracked as
[[unverified-claims]] item 45.

**The source the reply named has now been read, and it is the stronger authority.** §14-3 of the
Funding Handbook says services *"must send information to the ELI system through ELI Web, or a
Ministry-approved commercial student management system (SMS)"*, and describes ELI Web as *"a
free-of-charge Ministry application designed to collect the required data from licensed early
childhood services **that do not use a SMS**"*. It also carries the sentence Chapter 6 is quoted
for: *"Providing data through the ELI system does not replace the enrolment, attendance and absence
records required for funding which are defined in Chapter 6."*

That matters more than it looks. **The premise no longer rests on an email.** A published Handbook
section names not-using-an-SMS as a supported route in its own words, and a Handbook section is
versioned and public where correspondence can be superseded quietly. Read 2026-08-31 — *by a tool
rather than by a person*, which is item 36's caveat and is why item 46 stays open rather than
closing.

Two exemptions recorded while there: Casual Education and Care Services and Hospital Based Services
are exempt from regular ELI submissions but must still file RS7 Returns, and Te Kōhanga Reo
National Trust services are temporarily exempt from regular enrolment and attendance reporting.
Neither is Little Pearls, and this product models neither service type.

**One caution about scope.** This answers what a service *may* do. It does not certify that this
particular system does any of it, and no reply to an email ever will. Nothing on this page or in
the product may be worded to suggest the Ministry has approved, endorsed or reviewed this
software, because it has not — it has described the conditions under which any system qualifies.

### The Ministry told us, and nobody read the email for three days

**Recorded 2026-09-03.** Halaholo Mataele — the same Senior Advisor who replied on 2026-08-18 —
wrote to the ELI Queries thread on **~2026-08-31**, unprompted:

> *"This email is being sent to you as you have previously contacted the Ministry to inquire/express
> an interest in the Early Learning Information (ELI) integration process… Please follow the
> instructions on the above webpage if you wish to apply for an assessment."*

So the answer to *"has the review concluded"* arrived by email, addressed to us, days before this
repo worked it out by re-reading a webpage. The 2026-08-18 reply had said the review had no
published end date, which was true, and the conclusion this repo drew — nothing to do but wait —
was reasonable and wrong in one specific way: **it treated a question as blocked when the Ministry
had put us on a list of people it would notify.**

Worth keeping because the general form recurs. This page has an answer that came from asking rather
than re-reading (item 37), an answer that came from reading a public URL nobody had tried
([[eli-integration]]), and now an answer that came to us and sat unopened. **Not every open question
needs a poller; some need somebody to read the inbox.**

### The review lifted, and the barrier is now one place and eight weeks

**2026-09-02.** The Ministry's integration page, last updated 2026-09-01, no longer says the
review is under way. It says: *"We are now accepting applications from new early learning student
management system (SMS) vendors to undergo an assessment for the 2026 tranche."*

- **Closes 5pm, Friday 30 October 2026.**
- **One place.** *"We will support 1 successful commercial applicant for the 2026 tranche."*
  Decided on *"readiness for integration"*. Integration then runs 12–18 months.
- Two documents: a nine-field application form, and the ELI/NSI SMS Vendor Integration Application
  template 4.0 — **56 assessed items**, nine information items, three data-source mapping tables
  with no cell left blank, four data-flow diagrams *"specific to your SMS"*, and five development
  duration estimates.
- No fees, as confirmed on 2026-08-18.

**Everything about the application lives in
[eli-integration-2026-tranche](../../docs/eli-integration-2026-tranche.md), the answers in
[eli-application-answers](../../docs/eli-application-answers.md), and what the interface actually
requires in [[eli-integration]].** Three things belong on *this* page, because they are about
funding rather than about applying.

**One: the funding periods now have two independent sources.** The public ELI schema restricts
`RS7PeriodStartDate` to the pattern `[0-9]{4}-(02|06|10)-01`, with a comment naming
`yyyy-02-01`, `yyyy-06-01` and `yyyy-10-01`. `ministryFundingPeriods` returns exactly those, written
2026-08-18 from a specification document that is no longer available on the development machine.
A figure sourced once well is a figure that decays when its source does; this one no longer can.

**Two: RS7 is a daily count series, and this page's whole framing is per-child-per-period.**
`RS7DayCounts` wants, for each calendar date, the subsidy-funded under-two and two-and-over counts,
the 20 Hours funded and 20-Hours-plus-ten counts, and staff hours split into qualified and
not-qualified. `AdvanceMonthCounts` wants forward monthly counts of all-day, sessional and
parent-led days. **None of them is produced today**, and two need a staff qualification column
that does not exist.

> **Corrected 2026-09-03: the count was wrong, and it was never sourced.** This paragraph said
> *"none of the eleven"*, `unverified-claims` item 48 and the tranche doc said eleven, and
> `eli-application-answers` said **thirteen**. No document anywhere listed eleven items, so the
> number was quoted forward without ever being checked — the exact failure
> [AGENTS.md §5](../../AGENTS.md) is about, on a figure that went into a Crown-facing draft.
>
> Measured against the XSD at `https://eli.minedu.govt.nz/eli.xsd`, retrieved 2026-09-03:
>
> | Part of `RS7Return` | Fields |
> |---|---|
> | `RS7DayCounts`, per calendar date | **6** — `SubsidyFundedChildUnderTwoCount`, `SubsidyFundedChildTwoAndOverCount`, `TwentyHoursFundedChildCount`, `TwentyHoursFundedChildPlusTenCount`, `StaffHourQualifiedCount`, `StaffHourNotQualifiedCount` |
> | `AdvanceMonthCounts` | **3** — `AllDayDaysCount`, `SessionalDaysCount`, `ParentLedDaysCount` — **repeated for four months, so 12 values** |
> | `Declaration` | **6** — `RegisteredTeachersSalariesAttestation`, `RegisteredTeachersParityAttestation`, `RegisteredTeachersParityAttestationCode`, `SubmitterName`, `ContactNumber`, `Designation` |
> | Envelope | `RS7ReturnEntityId`, `PeriodStartDate` |
>
> So: **nine distinct counts** (six daily, three advance-monthly) plus **six declaration fields**.
> "Eleven" is most likely nine counts plus the two envelope fields, but that is a reconstruction,
> not a source.
>
> **And the type matters more than the count.** `RS7DayCount` is
> `xs:restriction base="xs:int"` with `minInclusive="0"` and `maxInclusive="9999"` — the daily
> figures are **whole numbers**, and Handbook §9-4 says round to the *nearest* hour (68h30m → 69,
> 68h29m → 68). `toHours()` in `hours.ts` rounds **down**, always, deliberately against the
> centre. That is correct for a preparation figure and **wrong for RS7**, so the two must not
> share a helper. Recorded as [[unverified-claims]] item 52. The arithmetic this page describes is not wrong for
RS7 — it is the wrong *shape*, and the transposition needs an age band evaluated as at each date,
which `childFunding` already does correctly for the 20 Hours band.

**Three: absence is an attendance event to ELI, which changes how the §6-4 gap looks.**
`ChildAttendance` carries an `IsAbsent` boolean. So the interface does not have a separate absence
collection — an absent booked day is an attendance event that says so. This product already records
which enrolled days a child was expected and did not come (`bookings` with the `absent` status and
its reason).

**As of 2026-09-04 the entitlement logic exists too**, and this paragraph used to say it did not:
the permanent/casual distinction (`0084`), the three-week window and its suspension (§6-5, §6-6),
§7-7's twelve weeks, and §6-7's monthly frequent-absence check with its four-month timeline.
`FUNDING_RULES_VERIFIED` stays `false` and item 6 stays open for **one** remaining rule — §6-4's
cross-child comparison — and for the two rounding questions, not for the absence rules as a body.

**And the caution from the section above applies with more force now, not less.** Applying is not
approval. Nothing in this product or its documentation may imply the Ministry has approved,
endorsed or reviewed this software, and that remains true on the day an application is submitted.

### The specification documents arrived, and nobody has read them

Seven, as password-protected attachments, listed here because their **names and versions** are
now a fact even though their contents are not:

| Document | What the covering email says it is |
|---|---|
| NSI GINS 6.19 | Technical spec for interfacing to the National Student Index; REST instructions in §5; must be read with the ECE NSI GINS Appendix |
| ECE NSI GINS Appendix 1.41 | General and functional requirements for Search, Add and Update of the NSI |
| InfoHub Specification 1.3 | Technical spec for interfacing to Info Hub |
| ELI Data Collection Specification 11 | Data collection **and validation** requirements for ELI Events and ECE Returns |
| ELI Event 10.0 | Appendix A of the above. **Mandatory XSD validation schema** for every message sent to ELI |
| RS7 Return Specification 6.0 | Technical spec for automating the four-monthly RS7 returns submitted by ECE services |
| Teacher Data Collection Specification 1.1 | Additional collection, for service types receiving the Waha Rumaki/PITA return only |

**The password is in the email and is deliberately not written down in this repository**, the
same reasoning that keeps the service-role key out of the mobile workspace: a credential in git
is a credential in every clone forever, and this one was sent in plain text to one mailbox.

Three things to take from the covering emails without opening a single attachment:

- **The "ELI/NSI SMS vendor integration and operational support approach document" is not a
  specification handed down — it is the vendor's own proposed integration design, submitted for
  the Ministry's review and approval.** The earlier note on this page called it a spec available
  on request. It is a deliverable, and writing it is work.
- **RS7 returns are four-monthly.** The Ministry's own wording. This product makes funding
  periods an operator-chosen parameter precisely because the boundaries were unknown; the RS7
  spec is where they are, and it is now on disk unread. See [[unverified-claims]] item 6.
- **The canonical sources were named**: the [ECE Funding
  Handbook](https://www.education.govt.nz/early-childhood/funding-and-data/funding-handbooks/ece-funding-handbook)
  and the Ministry's laws-and-regulations page for early learning services. Both were already
  public and neither has been read end to end — this changes nothing about items 1, 3, 6 and 36
  except that the Ministry has confirmed which pages it regards as authoritative.

What is **not** in doubt, and was not in doubt before any of these emails: this product cannot
submit today, and everything it produces is a preparation export.

### Reading them found a rule that was missing (2026-08-18)

The seven documents were opened the same day. Two things came out of them that changed code.

**The caps were right and the age band was absent.** The Ministry states 20 Hours ECE as 6 hours a
day and 20 a week **for a child aged 3 or older and under 6**. `DEFAULT_CAPS` had the hours and
nothing in this product had the ages: `twenty_hours_ece` is a boolean a centre ticks on the
enrolment, and it was trusted without question. Tick it on a two-year-old and the funding export
produced capped 20 Hours figures for a child with no entitlement — against a rule the Ministry
checks automatically and raises with vendors.

`childFunding` now returns `ineligibleDates`, and three decisions in it are worth not
re-litigating:

- **The age is computed as at each day, never as at today.** A child who turned three in March was
  not entitled in February. Using today's age would clear the whole period retrospectively, in the
  centre's favour — the same failure `replayDay` avoids with the ratio bands, and the mutation that
  swaps the date fails three tests.
- **The hours are still counted.** The hours are not in doubt; only the entitlement is. Excluding
  them would be the estimating this whole file refuses to do, and the attestation belongs to the
  centre, which is the party that can fix it. So the product names the problem and leaves the
  arithmetic alone — the same treatment a capped day gets.
- **An unknown date of birth flags nothing, and that is not the same as eligible.** It means no
  check was possible. An attested child with no date of birth is an unfinished enrolment, which
  shows up on the child's record rather than as a funding figure.

**The funding periods are known and are offered rather than imposed.** February–May,
June–September, October–January — four-monthly, three a year, one straddling the new year.
`ministryFundingPeriods(year)` returns them; the period stays a caller-supplied parameter, because
a centre may want an arbitrary window and a period that cannot be chosen is a screen somebody works
around. What has gone is the need to invent a date range on a document that looks official.

### The absence rules, read 2026-08-18 — and what this product did about them

**This heading read "and this product under-claims" until 2026-09-05.** It was a standing claim
about the product in a section about the *rules*, and it stopped being true on 2026-09-04. The
sections below are the reading as it was done; what was built from it is under
"§6-7 implemented" and "§6-4's cross-child rule" further up this page.

Chapter 6 was read the same day, and it changes what "funding from attendance" means.

**6-4.** Funding may be claimed for hours a **permanently enrolled** child did not attend, if the
absence falls under one of the absence rules. For a **casual or conditional** child, funding is on
attendance **only**, and a child who books a day and does not turn up must never be claimed — in an
audit that money is recovered. Nor may a service claim for both an absent permanent child and the
casual child filling their place.

**6-5, the Three Week Rule.** Claim every enrolled-but-absent session within three weeks of the
**first** day of absence; nothing from the fourth week onward; funding resumes when the child
returns. And it stops the moment a parent says the child is not coming back — **even mid-window**, or
the Ministry recovers what was claimed after that point.

**6-6, the extension for extended non-operation — added 2026-09-03, and it was missing from this
page and from `funding.ts` alike.** Read from the Handbook the same day the plan was written. *"Services
that do not operate for a continuous period of 2 weeks or more may claim funding for enrolled children
who are absent before and after the break."* The mechanism is a **suspension, not an extension of the
count**: the Three Week Rule *"will be suspended on the date of the child's last session before the
service closes"* and *"will restart from the first date the child is enrolled to attend after the
centre re-opens."* Named examples are Christmas holidays, end of term, and closure for renovations,
and the page tells a service to contact the ECE resourcing team if unsure.

This matters twice over. **It is a rule this page claimed to cover and did not** — `funding.ts`
transcribes 6-4, 6-5 and 6-7, and its disclaimer string nevertheless says *"sections 6-4 to 6-7"*,
which reads as coverage of four rules where three were read. And **it makes the Three Week Rule
stateful across closures**: a naive three-week window over calendar dates would expire during the
Christmas break and stop funding a child whose entitlement is suspended, not spent. So an absence
spell needs the centre's operating calendar, which is the same thing `EceServiceClosure` wants and
which `booking_status = 'closed'` does not provide — that status is per child-day, a different
statement.

**6-7, the Frequent Absence Rule.** A child's attendance must match their enrolment agreement for at
least half of each calendar month. Flagged in month 1, the agreement reconfirmed in month 2, month 3
claimable **only if** reconfirmed, month 4 not claimable and the agreement must be changed to match
reality.

**And "reconfirmed" is not a boolean — transcribed 2026-09-03.** The Handbook gives two acceptable
forms, and both carry a signature: either *"the enrolment agreement signed and dated by the child's
parent/guardian, confirming that the enrolment agreement remains valid"*, or *"change the child's
enrolment agreement to include new days and times"* also signed by the parent/guardian. So a
reconfirmation is a dated act by a named person, the same shape as the 20 Hours attestation gap —
and a `reconfirmed boolean` column would be the wrong schema for it.

#### What that means for this product

~~**It claims none of it.** `attendedHours` is the only source of funded hours, so an absent day
contributes zero.~~ **It claims all of it as of 2026-09-04** — §6-5, §6-6, §6-7 and §7-7 are
implemented and §6-4 is detected. What was written here as the product's behaviour is now the
behaviour of the **fallback**, and the distinction is worth keeping because the fallback is what
most rows still use:

- For a **casual or conditional** child, attendance-only is exactly what §6-4 requires. The
  calculation was always correct for them and still is.
- For a **permanently enrolled** child, attendance-only **under-claims** — and losing a centre
  funding it is owed is the same class of failure as over-claiming. It is the reason this phase
  names a broken day rather than silently zeroing it. **That path now applies only where no
  `child_booking_schedule` is recorded**, and `hoursBasis` names it `attendance-no-agreement` so a
  reader can tell it from a figure computed the right way.

~~**The blocker is the schema, not the arithmetic.** `enrolments` carries no permanent/casual
distinction; the word "casual" appears nowhere in this repo.~~

**Half of that blocker is gone as of 2026-09-03 — `0084`.** `enrolments.enrolment_type` now holds
`permanent`, `casual` or `conditional`, with the values transcribed from §6-4 itself and a CHECK
that refuses a fourth. It is settable on the enrolment form, shown as a flag on the enrolment row,
and asserted end to end in `journey.spec.ts`.

**Null is not "permanent", and that is the load-bearing decision.** Every enrolment filed before
`0084` is not-stated, and `createEnrolment` writes `null` rather than defaulting. Defaulting to
permanent would let absence funding be claimed for children nobody has classified — the one
direction these figures promise they never go, since [[unverified-claims]] item 6 and
`exportDisclaimer` both say the error only ever runs *low*. So a child whose type is unknown must
be treated as ineligible for absence funding, not eligible.

~~**What is still missing, and it is more than it looked.**~~ **All four were built on
2026-09-04**, and this paragraph is kept because the list is what the design was checked against:
a three-week window per absence spell (§6-5 — `classifyAbsences`), **the suspension of that window
while the service is closed for two weeks or more** (§6-6 — which this page did not know about until
2026-09-03; `suspendsTheWindow` plus `service_closures`), a monthly frequent-absence check against
the enrolment agreement (§6-7 — `assessFrequentAbsence`), and a record of reconfirmations that is a
**dated act by a named person**, not a boolean (`0092`, with `affirmed` and `revised` outcomes).

~~It also needs the enrolment agreement itself as an effective-dated weekday pattern, which is
`ChildBookingSchedule` and does not exist yet.~~ **Built 2026-09-04 — `0085`,
`child_booking_schedule`.** Effective-dated ISO-weekday blocks with times, keyed on the child,
allowing more than one block per weekday for a sessional service. So §6-7 now has something to
compare attendance *against*, and §6-5 has a definition of "enrolled to attend".

**And the contract-versus-actuals question was asked before the shape was cloned**, because item
50 is the record of getting it wrong on the staff side. The child side answers the other way and
the reason is a quotation rather than an inference: §6-5 says *"enrolled to attend"* and §6-7
says *"match their enrolment agreement"*. Both are about what was agreed, and the actuals they
are compared against already exist in `attendance_events`. A contract is the right thing here.

**And one rule that breaks the shape of the whole calculation.** §6-4: *"Funding must not be claimed
for both an absent permanently enrolled child under an absence rule and for the conditional or casual
child who fills the absent child's place."* Every funded-hours figure in this product is computed
**per child in isolation** — `childFunding` takes one child and cannot see the others. This rule is
about two children competing for one place, so a per-child implementation of absence funding would
breach it and **over-claim**. That is the constraint to design against before any of the three
absence rules is written.

**Superseded 2026-09-05.** The three rules are written, and §6-4 was not designed *around* — it was
implemented as `sixFourOverlaps`, a day-level pass that names the days a place is claimed twice and
the hours, without changing a figure. The constraint the sentence above describes is real and
unchanged; the instruction is what expired.

**One thing already in place helps more than it looks.** `bookings` (0018) and the `absent` status
with its reason (0063) already record *which enrolled days a child was expected and did not come* —
which is the input the Three Week Rule needs. The framing at the top of this page, "invoices come
from bookings, funding from attendance", turns out to be **incomplete rather than wrong**: funding
for an *absent* day comes from the booking, because there are no attended hours to come from.

`FUNDING_RULES_VERIFIED` stays `false` for this reason, and the export's disclaimer no longer claims
the caps are unchecked — it names the gap a manager can act on: these figures count attended hours
only, and you may be entitled to claim more. See [[unverified-claims]] item 6.

So the output is a **preparation export**: figures a manager keys into ELI Web. Every label says
"preparation" and none say "return", "submit" or "file". That is not pedantry — a screen that looks
like it filed something is a screen after which nobody files anything. `exportDisclaimer()` generates
the wording from the summary, so it cannot say "complete" when it is not, and lives in `@ece/core`
so a future emailed version says the same thing.

### `reconcile:funding` needed a human's password, and pointed at the wrong tenant

**Both fixed 2026-09-04, and the second was the dangerous one.**

The plan had carried "run `reconcile:funding`" as an owner-only task for weeks, with the note that
it *"has not been run against the two commits that changed its arithmetic"*. The reason was a
credential: it signed in as a named person and demanded `ECE_DRILL_PASSWORD`.

**A password cannot be fetched.** Supabase stores `auth.users.encrypted_password` as a bcrypt hash
and no anon key, service role or PAT returns it, so the only person who could run the drill was the
one whose account it was — and the only "fix" available to anybody else was resetting a real login
in order to run a test. `offline-drill.ts` had already worked this out and fixed itself; this script
never got the same treatment.

It now provisions its own account, exactly as the offline drill does: an RFC 2606 `.invalid` address
that cannot receive mail, a membership on the demo centre, and a fresh random password per run,
never stored. `ECE_DRILL_PASSWORD` survives as an optional override.

**A manager, not an educator** — which differs from the offline drill and the reason matters.
`readFundingPeriod` reads `absence_exemptions`, whose select policy is `caller_may_exempt`: owner or
manager. An educator would read no exemptions, every §7-7 window would silently be three weeks
instead of twelve, and the drill would reconcile a figure that was wrong for a reason it could not
see. Manager is the least privilege that can answer the question the drill asks.

#### And it was aimed at the live customer's tenant

The centre lookup was `.like('slug', '%albert%').single()`. Two problems, and the ambiguity was
hiding the serious one:

- **Ambiguous.** `demo-mt-albert` and `little-pearls-mt-albert` both match, `.single()` errors on
  more than one row, and the script reported *"Expected Little Pearls Mt Albert. Run `npm run
  onboard` first"* — a message pointing at the opposite of the real problem, which is how this
  surfaced at all.
- **Aimed at the real tenant.** The old error message says so in as many words. **This script seeds
  attendance events** — `ECE_ALLOW_DEMO_SEED=yes` exists to make the caller confirm exactly that —
  and the ambiguity was the only thing stopping it resolving to a live slug.

  **Corrected 2026-09-04:** the first write-up said it would have written invented attendance into a
  live centre's records. Both `little-pearls-*` tenants hold **zero children**, measured, and the
  script seeds only for `Demo-Seed` children in the centre it resolves — so it would have found none
  and stopped. The shape of the hazard is unchanged and so is the fix; the consequence named was not
  reachable here.

Now an exact match on `demo-mt-albert`, with `maybeSingle()` and an error that says to run
`seed:demo` rather than `onboard`. Measured before changing it: the three `Demo-Seed` children the
drill needs are in `demo-mt-albert`, and there were no attendance events anywhere in the project.

#### What it then proved

**16/16 reconciliation checks passed**, against hand arithmetic in the script's own comments rather
than a snapshot. That is the plan's Phase 5 verification — *"reconcile a month of attendance against
a manually calculated roll return"* — and it independently confirms the day's funding work,
including the assertion that reads *"funded is exactly 28.00 — deterministic since the weekly cap
became 30h"*, which is this morning's caps correction checked by a second method.

#### A footnote that explains something else

The failing run ended with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
src\win\async.c, line 94`. That is the **exact** libuv assertion `sweep-audit-tenants.ts` names in
its header as a thing that kills the Playwright CLI mid-run on this machine. Observed directly here
on `process.exit()`, which upgrades it from a documented rumour to a reproduced fact — and it is the
most likely explanation for the e2e run earlier today that reported 92 passed, 32 not run and exit
code 0.

### §6-5's notice date — the one over-claim, and closing it

**`0093`, 2026-09-04.** Every other gap recorded in this repo makes a funding figure too **low**.
This one made it too **high**, and it was the only one.

§6-5 stops the Three Week Rule the moment a parent gives notice that the child will not return —
*"even if the three week period has not ended"* — and the Ministry recovers anything claimed after
that point. `classifyAbsences` has taken a `noticeGivenOn` argument since the day it was written,
with an assertion proving a session **inside** the window is refused once notice is given. Nothing
could supply it.

**`enrolments.end_date` is not this, and the difference is the whole point.** Notice comes first: a
family says in March that the child is leaving at Easter, so the notice date is in March and the end
date is in April — and *between them the enrolment is still current while no absence may be
claimed*. The end date may also be absent entirely while notice has been given, which is the
ordinary case and precisely the one §6-5 is written for. Deriving either from the other is wrong in
both directions, and there is an assertion that reads both back independently rather than merely
proving both can be set.

**A guardian reference, for a weaker reason than §6-1's signatures, honestly stated.** There, a
signature attributed to the wrong family is a false record *supporting* a claim. Here, getting the
person wrong *stops* a claim that could have been made — it errs low, which is the safe direction.
It is a reference anyway, because "the family gave notice" with nobody's name against it is weaker
evidence than everything else on the row, and because `assert_signatories_are_guardians` cost three
characters to extend to a third column. That generic-over-`TG_ARGV` decision from `0087` has now
paid for itself twice.

**Notice is deliberately NOT a §6-1 gap.** `enrolmentRecordGaps` does not report it. Most children
have not been given notice, so listing it as missing would put a gap on every complete record —
the fastest way to teach somebody that the list is noise. It is a §6-5 event, not a record field.

**Withdrawing it has to work**, and there is an assertion for that too: a family may change its
mind, and a notice nobody can clear would cost a centre funding nothing could restore.

**What it does not do:** remove the over-claim on its own. A service that never records notice still
gets the full window — the same honest limit as §9-2 with an empty agreement. The capability is the
fix; the data is the service's. `exportDisclaimer`'s caution stays until there is something to
record.

### 2G — the disclaimer describes the period, and admits the one over-claim

**2026-09-04.** The disclaimer's absence sentence was **replaced, not deleted**, for the third
revision in three weeks. It read:

> These figures count attended hours only. Under sections 6-4 to 6-7 of the Funding Handbook a
> service may also claim funding for days a permanently enrolled child was booked but absent, and
> this system does not calculate that.

Both halves stopped being unconditionally true when the agreement basis landed — and both are still
exactly right for a child funded from attendance. So the sentence now **splits by what happened in
this period**, driven by `summary.basisCounts`:

| Period | What it says |
|---|---|
| Nobody on the agreement | the original sentence, with *"no child here has recorded days and times for that to be worked out from"* replacing *"this system does not calculate that"* |
| Some on the agreement | how many start from the agreement and include allowed absences, and how many count attended hours only |
| All on the agreement | the first half only — no phantom second group |

**A disclaimer that describes the product in general is a disclaimer that is wrong for half the rows
on the page.** That is the whole change.

**And it now admits an over-claim, which nothing here has had to do before.** Every other caveat in
`exportDisclaimer` warns a figure may be too *low*, and [[unverified-claims]] item 6 has promised for
weeks that the error only ever runs that way. The agreement basis breaks that promise in one place:
§6-5 stops absence funding when a family gives notice.

**The sentence below is the second version. The first said the product could not record notice, and
`0093` gave it exactly that — the day after.** It survived a day because a unit test asserted the
exact wording, so the fix would have failed the suite; found by a documentation sweep on 2026-09-05
rather than by any check. The risk did not disappear, it **moved from the schema to the data
entry**, and the caveat now points at the missing row:

> One caution in the other direction: these figures stop absence funding from the date a family gave
> notice that a child is leaving, but only where that date is recorded on the enrolment — so a child
> who has stopped attending with no notice date on file will still show claimable absences.

The test that held the old wording in place now asserts the two things actually required — that the
caveat appears, and that it names a missing *record* rather than a missing feature. **A test that
pins prose stops the prose from being corrected.**

**Conditional on the agreement basis being used**, because on an attendance-only period the
over-claim cannot happen and the sentence would be the false caveat this function has already had to
remove twice. There is an assertion for its presence and an assertion for its **absence**.

**`basisCounts` is seeded with all four keys at zero** rather than reduced into an empty object. A
missing key reads as `undefined`, which is falsy, so the "did anybody use the agreement" test would
answer *no* in precisely the case that matters. Asserted, and mutation-drilled.

**The CSV carries it too**, which is where 2G actually bites: the file is what gets keyed into ELI
Web, and this file's own principle is that *"the disclaimer travels in the rows"*. Four new columns —
`Hours basis` (the raw value, because a spreadsheet gets filtered and `attendance-no-agreement` is
greppable where "may be low" is not), `Claimable absent hours` (unconditional: `0.00` is a positive
statement that none of the claim rests on a day nobody attended), `Absences not claimable` with
their reasons, and `Attended outside agreement`.

### §9-2's two sources — `hoursBasis`, and the two ways of not knowing

**Added and wired 2026-09-04.** `childFunding` takes an optional `agreement`; `readFundingPeriod`
now supplies it, along with the operating calendar and the §7-7 exemptions, and the funding page
states the basis on any row that under-claims.

**No figure moves for any centre today**, and the reason is data rather than code:
`child_booking_schedule` is empty, so every child resolves to `attendance-no-agreement` and the
arithmetic is what it was. All 51 pre-existing funding assertions passed untouched, which is the
evidence for that rather than the claim itself. The figure changes for a centre the first time
somebody fills in the days and times — and that row then says so.

**The filter in `readFundingPeriod` was the trap it looked like.** It dropped children with
`attendedHours === 0 && unresolvedDates.length === 0`, which is exactly a permanent child whose claim
is entirely absence-based. Left alone, the whole change would have been invisible: the figure correct
and the child missing from the report. Same shape as the item 59 trap — a correction that looks
applied and is not.

§9-2 has **two** steps and this product used one source for both:

- Step 1, permanent children: *"List the daily number of hours of **enrolment**"*.
- Step 2, casual and conditional children: the hours each *"**attended**"*.

So the four states of `hoursBasis` are not degrees of confidence — they are different facts, two of
which are correct and two of which under-claim. `attendance` for a casual child is **right**;
`attendance-no-agreement` for a permanent one is the same number arrived at wrongly, and only the
basis distinguishes them. That is why it is a returned field and not something a caller derives.

**Three decisions inside it.**

**Enrolled hours, not attended hours, on the agreement basis** — including for a day the child was
present. A child collected an hour early was still enrolled for that hour, and §9-2 asks for the
hours of enrolment. It also makes this basis *less* sensitive to a broken attendance record: a
missing sign-out does not change what the agreement entitled the child to.

**Attendance outside the agreement is reported and never claimed.** §9-2 step 1 asks for enrolment
hours, so extra attendance by a permanent child is not claimable on that basis — and whether it
*should* be is not this module's decision. The dates are returned so a service can change the
agreement, which is what §6-7 asks for when attendance stops matching it.

**An agreement handed in for a casual child, or for one whose type is not stated, is ignored.** §6-4
is explicit: *"Services must not claim for conditional or casual children who book for a session or
day and do not attend."* A caller that fetched agreements for every child would otherwise silently
start claiming absences for exactly the children the Handbook says are attendance-only. Both cases
are asserted, and the second one exists because a mutation found it — see below.

**Seven mutations, seven caught, and one of them wrote a test.** Making `permanent` true for a
not-stated child survived every assertion, because no test passed an agreement for one. That
combination is reachable and is the dangerous one, so the survivor was a missing test rather than
dead code — the opposite of the survivor in `absence.ts` an hour earlier, which was dead code rather
than a missing test. Telling those two apart is the whole skill.

### The absence classifier — `absence.ts`, and why it is not wired in

**Phase 2F, first slice, 2026-09-04.** `classifyAbsences` answers one question per enrolled
session: *was this absence claimable?* It is pure, it consumes `service_closures` and the §7-7
exemptions, and **nothing calls it**.

That is the point rather than an omission. The arithmetic that would consume it still needs two
things — the §9-2 hours source for a permanently enrolled child, and §6-4's cross-child pass — and
shipping the classifier first means the hard part is testable before any published figure moves.
**`FUNDING_RULES.absence.verified` stays `false`**: the rules are read and sourced, and the product
still claims none of them, so a flag saying otherwise would be a claim about the law made by a module
nothing calls.

**A spell is the unit, and attendance is what breaks it.** Both windows are measured from *"the first
day of absence"* and both reset when the child returns, so the classifier cannot decide one session
at a time. A Monday-only child who misses four Mondays is in **one** spell twenty-eight days long,
not four spells — the intervening days are not enrolled and say nothing about whether the child came
back. That is why the input is the *enrolled sessions* rather than a calendar.

**The window is counted forward, skipping suspended days — not by subtraction.** The obvious
implementation is `daysBetween(start, date) - closedDays`, and it is wrong for a closure that starts
*before* the spell, because it subtracts days that were never inside the window. Counting forward is
also the shape of §6-6's own wording: the rule is *"suspended"* on one date and *"restart[s]"* on
another. There is a test for a closure entirely before the spell, which is the case subtraction gets
wrong.

**Day zero is the first absent day.** So `used < 21` admits twenty-one days, which is the reading of
*"within three weeks of the first day"* together with *"nothing from the fourth week onward"*: the
first day is inside, and day 21 begins week four. The boundary is asserted on the exact day rather
than on a count of claimable rows, because a classifier admitting a twenty-second day would still
pass "three of four are claimable".

**Notice beats the window**, and it is the only case where a session inside the window is refused.
§6-5 stops the claim *"even if the three week period has not ended"*, and the Ministry recovers
anything claimed after that point — so the notice test comes first in the code and has its own
assertion.

**Only closures of fourteen days or more suspend anything**, measured inclusively to match
`coversDate` and `0088`'s `[]` range bound. A one or two day emergency closure does not stop the
clock — which is consistent with §7-5 treating those as *fundable days* rather than as an
interruption.

**Six mutations, six caught.** Removing the suspension, widening the boundary to `<=`, dropping the
spell reset, demoting notice below the window, testing the exemption per session instead of at the
spell start, and lowering the two-week threshold to one day. Each one makes the suite red on the
assertion that names it.

**`enrolledSessions` is the bridge from `child_booking_schedule` to the classifier**, added the same
day. Without it the classifier took an input nothing could produce, which is how a pure function ends
up with no callers for reasons nobody wrote down. It walks a date range, matches each date's ISO
weekday against the blocks in force, and sums their minutes — because §9-2 asks for *"the daily
number of hours of enrolment"*, so a morning and an afternoon block are one session of both.

**A closed day produces no session.** §6-5 claims sessions a child was *"enrolled to attend, but was
absent from"*, and on a day the service did not operate there was nothing to be absent from. Leaving
those days in would spend a three-week window on days nobody could have attended — the same thing
§6-6 exists to prevent, arrived at from the other end.

**§7-5's claimable emergency closure is therefore still unbuilt**, and deliberately so: an approved
emergency closure is claimable on *"actual booked hours"*, but that is a different mechanism from an
absence — its own eligibility, no window to run — so those days are excluded here too rather than
misclassified as absences. Item 60 carries what remains.

### RS7's daily figures — built 2026-09-05, and what they are counts *of*

`rs7DayCounts` in `packages/core/src/rs7.ts`. Fourteen tests, **12/12 mutations caught** — nine on
the first pass, and the three survivors were missing boundary tests rather than surviving code.

**The six figures are HOURS, not children**, which the element names actively obscure —
`SubsidyFundedChildUnderTwoCount` reads like a headcount. Checked rather than assumed, and four of
the six are sourced directly:

- §14-4 names two of them *"daily total of 20 Hours ECE Funded Hours (20 Hours ECE)"* and *"…(Plus
  10)"*.
- §9-4 says of the staff figures *"Round the total to the nearest hour. For example: 68 hours and
  30 minutes would be rounded to 69 hours"*.
- §9-2's step 4 is *"Add together the claimable hours for each day"*.

The Glossary explains the naming: a **funded child hour** is *"an occupied child-place that is
funded for 1 hour"*. `StaffHourQualifiedCount` makes the construction obvious once seen — it is a
count of `StaffHour`.

**It takes `ChildFunding` results, not raw events**, so every rule already applied to them — the
caps, all four absence rules, §9-2's hours source — applies here without being reimplemented. What
this module adds is the transposition: per child per period becomes per date per category.

**Three things it produces that `funding.ts` deliberately does not**, all covered by item 63: a
per-date figure where a week was capped, a per-date 20 Hours / Plus 10 split, and the §6-4
deduction actually applied rather than reported.

**Two things it refuses.** Both staff figures are `null` and never `0` — a service reporting zero
staff hours would be making a different and false statement, and §9-4's input does not exist until
3B. And a figure past the schema's `0..9999` bound is **reported, never clamped**: clamping would
send a number the service cannot reconcile against its own records, and an overflow is far likelier
to be a defect here than a real day.

**Item 56 is implemented behind a stated default.** `plusTenTreatment` defaults to `deduct-both`,
which **under-claims** — of the two readings only that one cannot double-count on a Crown return.
The chosen reading is returned with the figures so a screen can say which produced them, and so the
return can be recomputed when the Ministry answers. On the test fixture the two readings differ by
**ten hours a week for one child**.

**One defect the tests caught during development**, kept in the drill as a regression: with
`twentyRemaining` at zero for an unattested child, the subtraction made *every* one of their hours
"Plus 10". An unattested child has neither entitlement — their hours are subsidy and nothing else,
which is what `childFunding` reports for the period. The tests saw it because they assert against
real `childFunding` results rather than hand-built fixtures.

### §6-4's cross-child rule — detected, attributed, and still not deducted

**2026-09-04.** `sixFourOverlaps({ children, licensedPlaces })`, rendered on `/funding` beside the
licence block. Eight mutations, eight caught — after the drill found one unasserted case and one
clause that turned out to be dead.

*"Funding must not be claimed for both an absent permanently enrolled child under an absence rule
and for the conditional or casual child who fills the absent child's place."* Every other figure in
`funding.ts` is computed for one child at a time, so this is the one absence rule a per-child
implementation is **structurally** unable to check.

#### It is not the place cap, and the difference is not cosmetic

A day can breach §6-4 without exceeding `6 × licensed places` at all: one absent permanent child
claimed, one conditional child attending, eight places standing empty. Two claims on one place, no
aggregate exceedance, and `placeCapExceedances` says nothing. So they are two checks and two blocks
on the screen.

#### The direction of the error is the opposite of §6-7's closure clause, which is why this got built

| Rule | Not implementing it | So |
|---|---|---|
| §6-7's *"may be extended"* across a long closure | claims **fewer** months | reported, not applied — item 62 |
| §6-4's cross-child rule | claims a place **twice** | had to be detected, and it now is |

The place cap and §6-7's extension can sit unapplied indefinitely because the error runs towards
under-claiming. §6-4 runs the other way. That asymmetry is the whole argument for doing this now
rather than after RS7.

#### And the attribution is known here, which narrows item 57

`placeCapExceedances` reports without adjusting because *whose* hours go is unknown —
[[unverified-claims]] item 57, and nothing read had answered it.

**§7-7 answers it for the absence case, in as many words:** *"Another child may attend the absent
child's place without claiming funding for that replacement child."* The replacement child's hours
are the ones not claimed. That is a quotation, not a reading, and the screen says so.

What still blocks deducting is the other half of item 57's warning, not the attribution: RS7 needs
the surviving hours split by age band and 20 Hours status, so a trim propagates into a Crown return,
and choosing *which* casual child among several is a judgement the Handbook does not make. So the
day, the amount and the basis are named, the wording tells the manager what to take off before
keying into ELI Web, and `fundedHours` is untouched.

#### Conditional and casual are not the same case, and the Glossary is why

| Basis | When | Source |
|---|---|---|
| `conditional-enrolment` | a conditional child attended a day an absence was claimed | the Glossary: a conditional enrolment is *"above the service's licensed maximum number of child-places"*, so that child is in a place they do not hold — **no capacity arithmetic needed** |
| `at-or-over-capacity` | a casual child attended and the day's **present** children reached the licence | "fills the absent child's place" only has content when the places are otherwise full |
| `capacity-unknown` | `centres.licensed_places` is null | reported, not skipped — a missing denominator must not be able to silence a rule about over-claiming |

That last row is the opposite treatment from `placeCapExceedances`, which returns `null` for the
whole question. There the arithmetic is impossible; here the day is suspect and can be named.

**A child of unstated enrolment type is not a replacement.** §6-4 names casual and conditional
children. Refusing hours because nobody has classified a child would be a guess about their
enrolment, and `hoursBasis` already reports that gap.

#### Two things the mutation drill found

- **The absent child must not count as a head.** `dailyCappedByDate` includes days a child was
  absent and the absence was claimed. Counting those as present says a day was at capacity when a
  place was standing open, and reports an overlap on a day where the casual child had a place of
  their own. The existing capacity test used ten places, where miscounting one head changes
  nothing — so the mutation survived until a two-place case was added.
- **A dead guard.** The first draft tested `claimedAbsenceHours <= 0`, and the drill could not kill
  it: the loop walks a map keyed only by dates that *have* a claimed absence, and `blockMinutes`
  cannot return zero. Removed. The same dead branch was found the same way in `enrolledSessions`,
  which is now two for two on "a branch no test can kill is a branch nothing can reach".

### §6-7 implemented — three triggers, four months, and what it refuses

**2026-09-04.** `assessFrequentAbsence` in `packages/core/src/absence.ts`, wired into
`childFunding` and read by `readFundingPeriod`. Eleven mutations, all eleven caught, and two of
them were test gaps this drill found rather than confirmed.

**It refuses absences, not months.** §6-7's sentences are about *"funding for absences in the third
month"* and, for the fourth, that they *"must not be claimed"*. Hours a child actually attended are
not in scope, so a refused month still funds every day the child was there. The alternative reading
— a month-wide refusal — would withhold funding for attendance nobody disputes, and it is the
mistake the fixture in `funding.test.ts` is built to catch: 60 funded hours where a blanket refusal
would give 48.

**§6-5 and §6-7 disagree here, and that is the point of running both.** In the test fixture a child
attends the first Friday of each month and misses the rest. Attending resets the spell, so every
remaining Friday sits inside a fresh three-week window and §6-5 allows the lot. §6-7 refuses
October's and November's. A product with only the window would over-claim two months.

| Trigger | Fires when | Input |
|---|---|---|
| same enrolled day | more than half of one weekday's sessions in the month were missed | the agreement's weekdays |
| fewer days per week | more than half the weeks in the month were short a day | `mondayOf`, week buckets |
| fewer hours per day | more than half the enrolled days were short of hours | attended minutes, and **not sessional** |

**"More than half", strictly.** §6-7 requires attendance to match for *"at least half (i.e. 50 per
cent or more)"*, so exactly half is a **match**. Implemented as `absent * 2 > enrolled` — integers,
no float, and the inclusive version would refuse a month the Handbook accepts. Trigger 1's boundary
was asserted from the start; **triggers 2 and 3 had no boundary test at all** and the mutation drill
is what found that.

**Trigger 3 needs a fact nobody has recorded.** It *"excludes sessional services"*, so it reads
`centres.service_model` (`0083`) — which is `null` on every centre in this project today. That
yields a named gap per month rather than a quiet "no trigger", and the fix is a person setting the
field on the settings screen, which already writes it. Measured, not assumed: five centres, five
nulls.

**The absent day counts as zero hours**, so triggers 1 and 3 overlap deliberately. The triggers are
three routes to one conclusion rather than a partition, and excluding absences from the hours test
would let a month of half-days-and-half-absences fail neither.

**An incomplete attendance record is a gap, never a shortfall.** A day with a missing sign-out
arrives as `null` attended minutes. Counting it as zero would invent a shortfall out of a paperwork
failure and make a month unclaimable on the strength of it.

**What is deliberately NOT applied: the closure extension.** §6-7 says the rule *"may be extended"*
across *"periods of two or more weeks of non-operation"*. "May" does not say by whom or on what
terms, and applying it would push months 3 and 4 later — making **more** months claimable on an
inference. So a long closure inside a triggered run is reported as a gap and the run keeps counting.
Same posture as the place cap: reported, never applied. [[unverified-claims]] item 62.

**Month 3's reconfirmation window is the run itself** — from the first day of the month the pattern
started to the last day of the month being assessed. A reconfirmation predating the pattern
reconfirms an agreement nobody had questioned; one dated after the month would be a claim made
before its own condition existed. Both `affirmed` and `revised` outcomes count, because §6-7's
definition names both.

**A §7-7 exemption does nothing here, and that is from the source.** §7-7 changes §6-5's window and
its text is about *"continuous absences"*. A pattern of half-attended months is not a continuous
absence, so `isExemptOn` is not a parameter of this function at all.

#### One `mondayOf`, after four copies

`attendanceTrend.ts` and `verificationChase.ts` each held a private `mondayOf`, `funding.ts` holds
`isoWeekKey` bucketing the same seven days into a different string, and `absence.ts` had an inline
weekday conversion. §6-7 needed a fourth. Extracted into `weekdayBlock.ts` — whose own header sets
the precedent, having been extracted on its second consumer — and the two identical copies now call
it. `isoWeekKey` stays where it is with a pointer: the weekly cap is built on its shape, and
re-bucketing a cap is not a side errand of adding an absence rule.

### §6-7, transcribed — the Frequent Absence Rule

Read from [6-7 The Frequent Absence
Rule](https://www.education.govt.nz/education-professionals/early-learning/funding-and-financials/chapter-6-recording-enrolment-attendance-and-absence/6-7-frequent-absence-rule)
and its companion [6-8
Examples](https://www.education.govt.nz/education-professionals/early-learning/funding-and-financials/chapter-6-recording-enrolment-attendance-and-absence/6-8-frequent-absence-rule-examples)
on **2026-09-04**. Reading both is what found [[unverified-claims]] item 61 — they disagree.

**The rule.** *"A child's attendance must match their enrolment agreement for at least half (i.e. 50
per cent or more) of each calendar month."*

**Three trigger situations**, and this product can express all three because `0085` holds the
agreement with times and `0083` holds the service model:

| | Trigger | Needs |
|---|---|---|
| 1 | absent on the same enrolled day(s) for more than half of those days in a calendar month | the agreement's weekdays |
| 2 | attends fewer days per week than enrolled, in more than half the weeks in a month | the agreement's weekdays, weekly |
| 3 | attends fewer hours than enrolled daily, on more than half of enrolled days in a month — ***"excludes sessional services"*** | the agreement's **times**, and `centres.service_model` |

That third exclusion is why `0083` matters here: `service_model = 'sessional'` is exactly the
distinction the Handbook draws, so the exclusion is checkable rather than a footnote somebody has to
remember.

**The timeline.** Month 1: note it and claim. Month 2: re-check, reconfirm if it continues, and
claim. Month 3: *"must only be claimed if the child's enrolment agreement has been reconfirmed"* —
**and §6-8's examples add a second route, see item 61**. Month 4: *"must not be claimed and the
enrolment agreement must be changed to match the child's attendance"*.

**The rule may be extended** across *"periods of two or more weeks of non-operation (holidays,
renovations, etc.)"* — the same clause as §6-6, and `service_closures` (`0088`) is what makes it
answerable.

**What a reconfirmation is:** *"signed, dated confirmation from parents/guardians either affirming
the agreement remains valid or documenting revised attendance days/times."* Two outcomes, and they
are not degrees of one thing — **affirmed** says the absences were incidental, **revised** says the
agreement was wrong and month 4's *"must be changed"* is satisfied by a new `child_booking_schedule`
block rather than by the reconfirmation row.

`enrolment_reconfirmations` (`0092`) is that record. Three things about its shape:

- **Keyed on the enrolment, not the child**, diverging from `attendance_verifications`. Month 4
  requires *that* agreement to change, and a reconfirmation of a previous enrolment must not unlock
  a month-3 claim against a later one.
- **No period**, also diverging. `attendance_verifications` stores both ends because it verifies a
  stretch of attendance that already happened; a reconfirmation is a forward-looking act on a single
  date, and what month 3 needs to know is whether one happened before it.
- **Repeated reconfirmation is allowed and asserted.** Every other dated table built this week
  refuses overlapping periods; this one must not, because §6-7 expects a persisting pattern to be
  reconfirmed again. An exclusion constraint copied out of habit would have refused the thing the
  rule asks for.

### §7-5, transcribed — emergency closure, and the closed days that ARE claimable

Read the same day as §7-7 and found by reading past it, from [7-5 Emergency
closure](https://www.education.govt.nz/education-professionals/early-learning/funding-and-financials/chapter-7-special-circumstances/7-5-emergency-closure).

*"An emergency closure occurs when circumstances beyond the control of individual services cause
temporary closures. Closures are normally for 1 or 2 days only."*

| | |
|---|---|
| **Qualifies** | *"extreme weather conditions"*, *"interruptions to essential services"*, *"non-controllable health and safety issues"*, *"civil defence emergencies"* |
| **Does not** | *"lack of staff (except when this is due to a non-controllable health and safety issue)"*, *"person responsible is absent"*, *"funerals in the community"*, *"A&P show"* |

**Approval, and it comes back in writing.** *"Contact ERO at the first available opportunity"* and
*"ERO will provide a letter to confirm approval/not approval"*. So approval is **three-state** —
requested, approved, declined — because *"not approval"* is an outcome the letter carries, and a
boolean would make a declined closure indistinguishable from a term break.

**And with approval the closed days are claimable.** *"Funding may be claimed for the hours that
children have a permanent enrolment subject to the funding maximums of the ECE Subsidy and 20 Hours
ECE"*, using *"actual booked hours for the day(s) of emergency closure"*.

**That is the sentence that changed the closures table.** A closed day is not uniformly
unclaimable: a term break and a snow day are both closed and only one is fundable. `0088` shipped
with no way to tell them apart, and `0091` added one — see [[unverified-claims]] item 60 for the
shape and the three decisions inside it.

**Note how far this is from §7-7, two pages away in the same chapter.** An absence-rule exemption
needs *no* approval — the service completes an EC12 and retains it against an audit. An emergency
closure needs a letter from ERO before a claim is defensible. Two sections, opposite processes, and
the only way to know that is to read both.

**For Phase 3D:** the paper RS7 uses an *"EC" code in the Staff Hour Count column* for emergency
closure days. Recorded here so it is not rediscovered.

### §7-7, transcribed — absence-rule exemptions, and the twelve-week rule

Read from [7-7 Absence rule
exemptions](https://www.education.govt.nz/education-professionals/early-learning/funding-and-financials/chapter-7-special-circumstances/7-7-absence-rule-exemptions)
on **2026-09-04**. Until then this page had a one-line summary of it in the enquiry draft, which
was not enough to design a table from — the section turned out to carry four things the summary
did not.

**The criteria.** A child qualifies if **either**:

1. they have an **ongoing learning support need**, supported by any one of
   - an Individual Development Plan from the Ministry's Learning Support team or an accredited
     early childhood special education provider, *"issued within previous 6 months"*, **or**
   - a completed **EC13** form, **or**
   - Child Disability Allowance documentation;
2. they have a **short-term illness or condition**, supported by *"an EC13 form specifying the
   exemption period"*.

**Not eligible**, and the section says so explicitly: *"Children without learning support needs or
health problems but who have parents or siblings with a learning support need/disability or health
problems are not eligible for an exemption from the absence rules."*

**What it does to §6-5.** *"Services may claim funding for all the sessions/days a child was
enrolled to attend, but was absent from, within a 12-week period. The 12-week period begins on the
first day of absence. No funding may be claimed for any continuous absences from the 13th week
onwards."* Same anchor as the Three Week Rule — the first day of the spell — and a different length.
So the window is a **parameter**, not a constant.

**It is not an approval.** *"Services must complete an EC12 form (and EC13 where applicable) with
supporting documentation, retained by the service and provided to the Ministry or Resourcing
Auditors upon request."* No application goes to the Ministry and no decision comes back, which is
why `absence_exemptions` (`0089`) has no status column and no `approved_at` — those would be four
lies at once. `ec12_completed_on` is the date the *service* completed its own form.

**Two limits beyond the window**, both of which land on this product:

- *"Exemptions apply only to specific enrolment agreements."* So the table keys on
  `enrolments.id`, not on a child — a child who leaves and returns has two agreements, and an
  exemption against the first must not carry to the second.
- *"Children enrolled at two services cannot receive funding for absences at both."* Unenforceable
  from here for the same reason as `hours_at_other_service_per_week` (`0087`): the second service is
  invisible to this database.

**And one that changes the day-level calculation.** *"Another child may attend the absent child's
place without claiming funding for that replacement child."* That is the same shape as §6-4's rule
against claiming for both an absent permanent child and the casual child filling their place — so
2F's day-level pass has two sources for it, not one.

**The six-month IDP recency is stored and not enforced.** `evidence_dated_on` is required for an
IDP so the condition is answerable, and no CHECK refuses an older one. A time-relative CHECK is what
`0078` had to undo, and *"within previous 6 months"* does not say previous to **what** — the
application, the claim, or the absence. There is an RLS assertion pinning that a two-year-old IDP is
**stored**, because the obvious future "improvement" is to add the constraint.

**Who can see an exemption: owner and manager only.** Narrower than `health_conditions`, which an
educator reads because they respond to an allergy at the door. An exemption is a purely financial
instrument and the row discloses that a child has an ongoing learning support need or a health
problem. A parent cannot see their own child's either — a real trade-off, since they supplied the
EC13, and the narrow default is the honest one when the balance is unclear. Both are asserted, so
widening either is a decision rather than a drift.

### §6-6 has its calendar now — `service_closures` (`0088`)

§6-6 suspends the Three Week Rule while a service is closed for two weeks or more. It was never
transcribed while the disclaimer claimed to cover *"§6-4 to 6-7"*, and it could not have been
implemented anyway: **nothing recorded which days the service did not operate.**

`0088` is that record — a period with a start, an optional end and a reason code, shaped by the
`EceServiceClosure` event because the XSD had already specified it. Four consumers, which is why it
came before the absence rules themselves: §6-6, RS7's `AdvanceMonthCounts`, the ELI event, and
`averageOverOpenDays`, which infers a closed day from nobody attending and therefore cannot tell one
from an open day nobody came to ([[unverified-claims]] item 59).

**It is not `bookings.booking_status = 'closed'`**, which already existed and stays as it is. That
value says *this child had no place on this day*; the new table says *the service did not operate*.
A service can be open while one child's booking is closed, and deriving either from the other makes
a child-level record answer a service-level question.

**`ends_on` is nullable** — a flood on Tuesday with no known reopening is a real closure, and
recording it as a one-day one would be false. The cost is named rather than hidden:
`EceServiceClosure` requires a `ClosureEndDate`, so an open closure cannot be serialised, and that
is a gap for the sender to report rather than a date for the table to invent.

**The reason ships unresolvable.** `ClosureReasonCode` is a `LookupCode` with no published list;
`0080` reserved a `closure_reason` domain in `code_sets` and left it empty. So the column is `text`
with the `LookupCode` length bound and **no foreign key** — the same treatment `0081` gave the
census codes, because a foreign key would make the column unwritable until the Ministry publishes a
list, and an unresolvable code belongs on a readiness report rather than in a rejected write.

**Where it is entered:** a *Closed days* card on `/settings`, beside the rooms and the licence
figure — centre-level configuration entered rarely, by the same two roles, and read by everything
else. `isClosedOn` and `closureOn` in `@ece/core` are the predicates; both go through `coversDate`,
which is now on its **third** consumer and whose inclusive-at-both-ends semantics match the `[]`
range bound the exclusion constraint uses, so the database and the TypeScript cannot disagree about
a boundary day.

**The code is rendered raw, with a caveat, and never as a guessed label.** The form says so in as
many words: there is nowhere yet to look one up, so whatever a service types is stored as typed and
shown as typed.

**A gap worth naming rather than letting the policy imply it.** `0088`'s read policy is plain centre
membership — every member, **parents included** — and the justification given for it was that a
family needs to know the centre is shut next Thursday. There is an RLS assertion proving the policy
allows that, and **nothing surfaces closures to families yet**. The boundary is right; the screen
does not exist. Do not read the policy as a delivered feature.

### The enrolment record — what §6-1 requires, and where each part lives

Complete as at 2026-09-04, and this table is the map. §6-1 is the rule; everything under it is
required, which is why the product reports **which parts are missing** rather than a completeness
percentage. Four missing fields is not "80% complete" — it is a record that does not meet the rule.

| §6-1 requires | Where it lives | Reachable from |
|---|---|---|
| official name, date of birth, preferred names | `children` (`0004`) | the child's Details |
| **home/residential address** | `child_addresses` (`0086`) | `AddressPanel`, Whānau tab |
| the date attendance commenced, and the finish date | `enrolments.start_date` / `end_date` (`0004`) | `EnrolmentPanel` |
| the days and times expected, and later changes | `child_booking_schedule` (`0085`) | `BookingSchedulePanel` |
| a signature on **each change** to the agreement | `child_booking_schedule.signed_on` / `signed_by` (`0087`) | the same panel's add form |
| **hours enrolled at another service** | `enrolments.hours_at_other_service_per_week` (`0087`) | `EnrolmentPanel`, both forms |
| **a dated parent signature on the record** | `enrolments.signed_on` / `signed_by` (`0087`) | `EnrolmentPanel`, both forms |
| National Student Number | `children.moe_nsn` (`0004`) | the child's Details |

`enrolmentRecordGaps()` in `@ece/core` answers "what is missing" for one enrolment, and the panel
renders it as a **Record incomplete** flag. It deliberately does **not** answer for the address:
that lives on `child_addresses` keyed to the child, so an enrolment row cannot speak for it, and a
test asserts the omission so it stays a decision.

**Three things about this that were decisions, not defaults.**

**Null is not zero for the other-service hours.** §6-1 wants the figure *"including none if
appropriate"*, so "the parent attested none" and "nobody has asked" are different answers.
`Number('')` is `0`, which is precisely how the two get collapsed by accident, so emptiness is
tested before conversion in both the API mapper and the server action. Two unit tests fail if that
becomes a falsy check.

**The signatory is a picker, because the database made it one.** `signed_by` is a `guardians`
reference and `assert_signatories_are_guardians` (`0087`) requires a **current guardian of that
child** — a foreign key alone would accept another centre's parent. `listGuardiansOfChild` already
filters revoked links, which is the same condition the trigger applies, so the picker offers exactly
the people Postgres will accept. Nothing preselects a guardian: a signature is a claim that a named
person signed something, and a default would manufacture it from a page load.

**Signatures are never required on the way in.** Not on filing an enrolment, not on changing the
days and times. Refusing to store a change until somebody has signed would mean either losing the
change or backdating a signature, and the second is worse than an honest gap. Unsigned blocks carry
an `unsigned` flag, and every block written before `0087` carries it permanently — a signature
nobody gave is not backfillable.

**What is not built:** a centre-wide readiness list. The gaps are named on each child's record, so a
manager checking one child sees them; a manager wanting to know which of eighty children have
incomplete records has no screen. That is a reporting feature rather than a compliance gap, and it
is named here so it is not mistaken for done.

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
ECE_ALLOW_DEMO_SEED=yes npm run reconcile:funding
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
- [[attendance-verification]] — the signature that makes those events evidence rather than
  a centre's own arithmetic
- [[unverified-claims]] — the caps, and the absence of rates
- [[compliance-and-evidence]] — the other thing attendance is evidence for

*Last updated: 2026-09-03*
