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
| Enables compliance with **all** Chapter 6 record-keeping requirements | Not yet. The absence rules of §6-4 to §6-7 are not modelled at all — no permanent/casual enrolment type, no three-week window, no frequent-absence check. See [[unverified-claims]] item 6 |
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
its reason). What is still missing is the *entitlement* logic — the permanent/casual distinction,
the three-week window, the frequent-absence check — not the observation. `FUNDING_RULES_VERIFIED`
stays `false` and item 6 stays open, but the gap is narrower than this page has been describing it:
the data is there and the rules are not.

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

### The absence rules, read 2026-08-18 — and this product under-claims

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

**It claims none of it.** `attendedHours` is the only source of funded hours, so an absent day
contributes zero. Two consequences, and the second is the one that matters:

- For a **casual or conditional** child, attendance-only is exactly what 6-4 requires. The
  calculation is already correct for them.
- For a **permanently enrolled** child it **under-claims** — and losing a centre funding it is owed
  is the same class of failure as over-claiming. It is the reason this phase names a broken day
  rather than silently zeroing it.

**The blocker is the schema, not the arithmetic.** `enrolments` carries no permanent/casual
distinction; the word "casual" appears nowhere in this repo. 6-4 turns on exactly that axis, so
there is no way to ask the question the rule asks. Building absence funding needs an enrolment type,
a three-week window per absence spell, a monthly frequent-absence check and a record of
reconfirmations. That is a feature with real decisions in it, not a patch, so it is named rather
than half-built.

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
- [[attendance-verification]] — the signature that makes those events evidence rather than
  a centre's own arithmetic
- [[unverified-claims]] — the caps, and the absence of rates
- [[compliance-and-evidence]] — the other thing attendance is evidence for

*Last updated: 2026-09-03*
