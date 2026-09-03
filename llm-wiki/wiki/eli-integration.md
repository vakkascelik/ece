# ELI integration

What the Ministry's interface actually asks for, and the fifteen minutes that turned a
password-protected dependency into a public URL.

## Overview

ELI is the Ministry of Education's Early Learning Information system. A licensed service must send
it enrolment, attendance and absence data, the annual ECE census and the four-monthly RS7 return,
either by hand through ELI Web or automatically from a Ministry-approved student management system.

This product does the first thing — it produces figures a person keys into ELI Web — and
[funding-and-billing](funding-and-billing.md) is where that position and its two Ministry
confirmations live. This page is about the *second* thing: what integrating would actually mean,
now that applications are open.

The plan and the gap table are in
[eli-integration-2026-tranche](../../docs/eli-integration-2026-tranche.md). This page is the
knowledge, which outlives whether the application succeeds.

## Key Points

- **The mandatory ELI schema is served publicly** at `https://eli.minedu.govt.nz/eli.xsd`. Two
  weeks were spent treating the message format as locked inside an attachment nobody can now open.
- **26 root elements, and most of them come in threes** — an event, a `Delete` and an `Undelete`.
  Correction by re-sending a superseding event is the interface's own model, which is the model
  `attendance_events` already uses.
- **`ChildAttendance` carries `IsAbsent`.** Absence is an attendance event to ELI, not a separate
  collection — which reframes the §6-4 absence gap as *closer* to the interface than it looked.
- **`RS7PeriodStartDate` is pattern-restricted to February, June and October.** It confirms
  `ministryFundingPeriods` from a public source, independently of the email it was written from.
- **The vendor mints the identifiers.** `EntityId` is a 1–255 character string the SMS assigns and
  must manage for the life of the record. Our UUIDs fit; the lifecycle rules do not exist yet.
- **The schema is a floor, not the specification.** The Ministry's own `AST40` asks about business
  rules *"beyond what is defined in the XSD"*, and every code list is typed as an unenumerated
  10-character `LookupCode`.

## Details

### The schema was public the whole time

`https://eli.minedu.govt.nz/eli.xsd` — HTTP 200, `text/xml`, 23,665 bytes, no authentication,
fetched 2026-09-02. A complete XML Schema: every element, every complex type, every enumeration,
every length bound.

The Ministry sent seven password-protected specification documents on 2026-08-18, one of which is
*"ELI Event 10.0 — Appendix A… Mandatory XSD validation schema for every message sent to ELI"*.
Whether the public URL is that same schema is **unconfirmed** and is question 5 of the
[enquiry](../../docs/eli-ministry-enquiry.md). It may be an older or newer version; it carries no
version stamp in the document itself.

**But it is a citable public source, and the attachments are neither.** They are not on the machine
this repo is developed on — searched to six levels across the whole user profile on 2026-09-02 and
found nothing. They were decrypted and read on 2026-08-18, changed the product for the better, and
left behind exactly two recorded facts: the 20 Hours caps with their age band, and the funding
period boundaries.

**That is the lesson worth keeping from this page.** The reading happened. The product improved.
And the interface knowledge evaporated when the session ended, because nobody wrote down what the
specification said — only what it changed. [unverified-claims](unverified-claims.md) item 38 spent
eleven days asserting the documents were unread; the deeper problem was that being read left almost
no trace. A specification you have read and not recorded is a specification you have not read.

### The event catalogue

Every event extends a common `Event` type carrying `ServiceId` (≤50 chars), `EventSource`
(≤100) and `EventDateTime`. Nine families, and the `Delete`/`Undelete` siblings are how a
mistake is withdrawn rather than edited.

| Event | Payload | Where it would come from here |
|---|---|---|
| `ChildIdentity` | `NationalStudentNumber` (long), `OfficialFamilyName`, up to three official given names, `ChildBirthDate`, `GenderCode` | `children` — `moe_nsn`, `last_name`, `first_name`, `date_of_birth`, `gender`. **`gender` is a four-value CHECK, not a Ministry code**, and there is no second or third given name |
| `ChildEnrolment` | `PrimaryResidentialAddress` (**required**), optional nillable secondary, `EnrolmentStartDate`, `EnrolmentEndDate` | `enrolments` for the dates. ~~**The address is a problem: this product holds addresses on `guardians`**~~ **Built 2026-09-04: `child_addresses` (`0086`)**, structured as `ChildEnrolmentAddress` asks — `Address1Line` and `AddressCity` required, line 2, country and postcode optional, all `String100` and bounded in the database. At most one primary and one secondary, so the two-household case the schema allows for is expressible |
| `ChildDemographics` | `EthnicGroupCodes` (1–3, first mandatory), `IwiCodes` (0–3), `HomeLanguageCodes` (1–3, first mandatory) | `children.ethnicities` (free text, capped at 3 — the cap matches), `children.iwi` (**one only, where ELI takes three**), `children.first_language` (**one only, where ELI takes three**). All free text against code lists |
| `ChildBookingSchedule` | `EffectiveDate` plus a `ChildBookingScheduleDetailList` of `DayTimespan` (`WeekdayCode`/`StartTime`/`EndTime`), `maxOccurs="unbounded"` | ~~**Nothing maps.** … the clearest structural gap in the child data~~ **Built 2026-09-04: `child_booking_schedule` (`0085`).** Effective-dated ISO-weekday blocks with times, keyed on the child — which is what the XSD does too, carrying `ChildEntityId` and no enrolment reference. Multiple blocks per weekday are allowed, because the schema allows them and a sessional service needs them. What remains is the serialiser and the screen |
| `ChildAttendance` | `AttendanceTime` (a start/end `dateTime` pair), **`IsAbsent`**, optional attendance address | `attendance_events` — but as *paired* in/out rather than two rows, resolved per centre-day. `bookings.status = 'absent'` is the `IsAbsent` case. The optional address is for care delivered elsewhere |
| `TwentyHoursSchedule` | `AttestationDate` and hours for each of the seven weekdays, 0–24 decimal | `enrolments.twenty_hours_ece` is a **boolean with no attestation date and no per-day hours**. `funded_hours_per_week` is a weekly total. Neither shape fits |
| `ConfirmationData` | `ConfirmationDataEntityId`, `StartDate`, `EndDate` | **Unknown.** A date-range confirmation of something. It is tempting to map it to the §6-3 attendance verifications in `0061`, and that guess is not made here — it needs the Data Collection Specification |
| `EceServiceClosure` | `ClosureStartDate`, `ClosureEndDate`, `ClosureReasonCode` | **Nothing.** No closure record exists. `booking_status` has a `closed` value per child-day, which is not the same statement |
| `EceReturn` | `ServiceDetails` — five age-banded wait-time codes and one to five languages with usage percentages — plus a `StaffInformationList` | **Nothing.** See the census gap in the tranche document |
| `RS7Return` | `PeriodStartDate`, `DailyData` (per-date counts), `AdvanceMonthCounts` (four months), `Declaration` | Funded hours exist; **none of the counts do**. No delete sibling — RS7 is corrected by resubmission |

### What is built, as at 2026-09-04

The catalogue above says what each event *would* come from. This says what has actually been done
about it, because the two drifted apart within a day of the table being written.

| Event | Then | Now |
|---|---|---|
| `ChildBookingSchedule` | Nothing mapped | **`0085`** — effective-dated weekday blocks with times, keyed on the child as the XSD is. Serialiser and screen outstanding |
| `TwentyHoursSchedule` | A boolean with no attestation date | **`0084`** — `twenty_hours_attested_on` and `_by`, paired by a CHECK. Per-weekday hours still absent |
| `EceReturn` (service details) | Nothing | **`0083`** — `licence_type` and `service_model`. The service-level wait times and languages are still absent |
| `RS7Return` | "None of the counts" | Still none. But the **field count is now sourced** (six per-date, three advance-month over four months, six declaration) where three documents had said "eleven" and one "thirteen", and none had a source |
| `ChildEnrolment` | Address is the blocker | **`0086`** — `child_addresses`, structured to the schema's own five fields. **And the reason it had to be structured is the finding worth keeping**: `ChildEnrolmentAddress` requires `Address1Line` and `AddressCity` as *separate* elements, so the free-text shape `guardians.address` uses could not be serialised without splitting a New Zealand address by guesswork — which puts the suburb in the street field on a Crown return, and validates |
| `EceServiceClosure` | Nothing | Still nothing — and it is now **load-bearing**, because §6-6 suspends the Three Week Rule while a service is closed for two weeks or more, so absence funding needs an operating calendar |

**The most useful thing this page can tell a reader is not in that table.** It is that the ELI schema
was used to design the census and got one thing wrong — item 50 — because a message format cannot
tell you what a field *means*. `0085` is the first table built after asking the Handbook first, and
the answer came out the opposite way to the staff side: the child booking schedule is a **contract**
because §6-5 says *"enrolled to attend"* and §6-7 says *"match their enrolment agreement"*, whereas
the staff contact hours may need **actuals** because §14-2 says *"actual contact hours"*.

Two tables with the same shape and different meanings, and only the Handbook distinguishes them.

### What RS7 actually wants, and why the current shape does not fit

`RS7DayCounts` is **per calendar date**: `SubsidyFundedChildUnderTwoCount`,
`SubsidyFundedChildTwoAndOverCount`, `TwentyHoursFundedChildCount`,
`TwentyHoursFundedChildPlusTenCount`, `StaffHourQualifiedCount`, `StaffHourNotQualifiedCount`.

This product's funding page is organised the other way round — **per child, summed over a period**.
Both are correct views of the same events, but the transposition is not free: the daily counts need
an age band evaluated *as at that date* (which `funding.ts` already does correctly for the 20 Hours
band, and `splitByAgeBand` already does for the live ratio), and the two staff-hour counts need a
qualification the schema cannot express because the column does not exist.

`AdvanceMonthCounts` wants `AllDayDaysCount`, `SessionalDaysCount` and `ParentLedDaysCount` for up
to four months ahead, each 0–99. Those are **forward** counts of operating days by service model —
the model this product does not record.

The `Declaration` carries **six** fields, not three — corrected 2026-09-03 after re-reading the
schema, because this paragraph listed only the attestations and the three contact fields are
required too:

| Field | Note |
|---|---|
| `RegisteredTeachersSalariesAttestation` | The salaries attestation |
| `RegisteredTeachersParityAttestation` | The pay-parity attestation |
| `RegisteredTeachersParityAttestationCode` | Enumerated `NOSTEP`, `STEP1`, `STEP1-6`, `STEP1-11`, `STP1-11P`, `STP1-11F` — pay parity steps |
| `SubmitterName` | |
| `ContactNumber` | |
| `Designation` | |

The last three are exactly what Funding Handbook §14-4 asks for — *"name, contact number,
designation"* — which is a useful independent corroboration that the public XSD and the published
Handbook describe the same return.

Nothing in this product knows what the parity steps mean, and **nothing here should guess**: an
attestation is a legal statement by the service about teacher salaries, and
[AGENTS.md §4.5](../../AGENTS.md) forbids inventing regulatory content exactly here. The three
contact fields are the opposite case — they are facts about a person, so they get recorded from
whoever submits, and are equally not derivable.

**And the day counts are integers.** `RS7DayCount` is `xs:restriction base="xs:int"` with
`minInclusive="0"` and `maxInclusive="9999"`. That settles a question this page had left open: the
six per-date figures are whole numbers of funded child hours, not decimals, and §9-4 rounds to the
**nearest** hour. `toHours()` floors. See [[unverified-claims]] item 52 — this is the first thing
found that requires RS7 *not* to reuse an existing helper.

### The period boundaries now have two sources

```xml
<xs:simpleType name="RS7PeriodStartDate">
  <xs:restriction base="xs:date">
    <!--  Period start dates restricted to yyyy-02-01 or yyyy-06-01 or yyyy-10-01  -->
    <xs:pattern value="[0-9]{4}-(02|06|10)-01"/>
```

`ministryFundingPeriods(year)` returns February–May, June–September, and October–January. Written
2026-08-18 from a specification document that is no longer available, and confirmed 2026-09-02
against a public schema.

**It is the first funding figure in this product with two independent sources**, and it is worth
naming as the pattern rather than the exception: the way to make a figure durable is not to source
it once well, it is to source it twice from things that can be checked separately later.

### Correction by supersession, which this product already does

Most events have `Delete` and `Undelete` siblings, and `AST54` says of the teacher return: *"Users
cannot update an event. If submitted in error, the user must resubmit. A new event needs to be
created with a new ID."*

That is the contract `attendance_events` has enforced since `0009`: no UPDATE policy, no DELETE
policy, and a correction is a new row whose `corrects` points at what it supersedes — transitively,
so a fixed sign-in time is not counted twice. The append-only ledgers in
[tenancy-and-rls](tenancy-and-rls.md) withhold UPDATE and DELETE from `service_role` itself.

**So the hardest thing about an event interface is the thing this product already got right**, for
its own reasons, four phases before anyone read the schema. What is missing is not the model but
the plumbing: an outbound queue, an `EntityId` lifecycle, and validation before transmission.

### The queue already has a shape, and it should be reused

`AST34` asks about transmission approach, event storage, triggers and schedule. `AST37` asks what
happens to a `400 invalid_auth` — where the error is held, how long, who can see it, what the user
sees, and how the offending events are resent.

That is the [offline-outbox](offline-outbox.md) contract, pointed the other way. It already has
the three things a Crown-facing queue needs and that are easy to get wrong:

- **The key is generated once, at enqueue, never per attempt.** Regenerating on retry is the exact
  bug idempotency exists to prevent, and it is the same bug as minting a new `EntityId` on a resend.
- **Failures are classified three ways, not two** — permanent, transient, and *retry-later*. The
  third exists because a device clock running fast is self-healing, and treating it as permanent
  buried real sign-ins. An `invalid_auth` is transient; a schema violation is permanent; a Ministry
  system under load is retry-later. A queue with two classes gets one of those wrong.
- **A flush stops at the first transient failure** rather than grinding the whole queue against a
  dead endpoint — which is also what *"whether the scheduled transmission can be adjusted to avoid
  Ministry system overload"* is asking about.

`classifyWriteFailure` is shared by both clients already. An ELI sender is a third caller of the
same idea, not a new one — [AGENTS.md](../../AGENTS.md) rule 4.

### The schema is a message format, not the requirement — and §14-2 proves it

**Added 2026-09-03, and it is the most important caveat on this page.**

Everything above was derived from the XSD, which is a *wire format*. §14-2 of the Funding Handbook
is the *requirement*, and reading it after building against the schema found three things the
schema's shape actively misled us about:

- **`ContactHoursDetailList` is weekday + start + end with no dates**, which is the shape of a
  contract. §14-2 calls the same field *"**Actual** contact hours for teachers/staff (start and end
  dates and **actual** contact start and finish times spent teaching children)"*, and asks
  separately for *"Total Hours worked during the ECE Census week"*. Those are measurements.
  `0081` built a contract. Tracked as [[unverified-claims]] item 50, and it is the one open item
  here that would change a table rather than a label.
- **Two pairs of staff dates.** §14-2 asks for start and end dates *"working at service"* **and**
  *"in role at service"*. The schema carries one pair, inside `EducationalStaffRole` — so it is
  probably the in-role pair, and the at-service pair comes from the staff record. The schema alone
  cannot tell you that, because it has one pair and no name for which.
- **Three flags are conditional.** *Previously worked as teacher*, *arrived from another service*
  and *leaving teacher destination* are marked *"(permanent staff only)"*. The schema marks them
  `minOccurs="0" nillable="1"` — optional for everybody, which is a weaker statement than the
  Handbook's.

**The general rule this establishes for the rest of this integration:** the XSD bounds what a field
may contain; only the Handbook says what it means. Every field mapped from the schema alone is a
mapping with an unread requirement behind it, and the ones on this page are now flagged rather than
trusted. The service-level `ServiceDetails` block — five age-banded wait times and one to five
languages with usage percentages — is a case in point: nothing in this product records a waiting
time by age, and the schema's cardinality tells you nothing about whether that matters.

### What the schema does not give, and must not be guessed

- **Transport.** No endpoints, no authentication, no Destination Header. That is InfoHub
  Specification 1.3 and the ESL machine-credential flow, and `AST24` wants a process flow diagram
  covering SMS → ESL → NSI → ELI.
- **The NSI interface.** Search, allocate and create an NSN; what happens when the NSI's name
  disagrees with the SMS's; the unverified-date-of-birth path. Four data-flow diagrams
  (`AST27`–`AST30`), all needing NSI GINS 6.19 and its ECE appendix.
- **Business rules beyond the XSD.** The Ministry says so itself in `AST40`. A schema-valid message
  can still be wrong.
- **Every code list.** `LookupCode` is `minLength 1, maxLength 10` and enumerates nothing. Ethnicity,
  iwi, home language, qualification, staff role, gender, wait-time and closure-reason values are all
  elsewhere. Some are published on Education Counts, which answered two fetch attempts on
  2026-09-02 with a Cloudflare challenge and was not retrieved.
- **The Waha Rumaki/PITA return.** Not in this schema at all — it is the separate Teacher Data
  Collection, and whether it applies to a standard education and care service is
  [enquiry](../../docs/eli-ministry-enquiry.md) question 7.

Four enumerations *are* public here and are worth having written down, because they are small and
they are the kind of thing that otherwise gets invented: `WeekdayCode` is `Mo Tu We Th Fr Sa Su`;
staff `AgeBandCode` is twelve five-year bands from `UN_20` to `OV_70`;
`LeavingTeacherDestinationCode` is `D01`–`D04` plus `UNK`; and the parity attestation codes are the
six listed above. Nothing else in the schema is enumerated.

## Related

- [funding-and-billing](funding-and-billing.md) — the two Ministry replies, the four conditions, and
  why this product produces a preparation export rather than a submission
- [offline-outbox](offline-outbox.md) — the queue contract an ELI sender should reuse
- [tenancy-and-rls](tenancy-and-rls.md) — the append-only ledgers that already model supersession
- [unverified-claims](unverified-claims.md) — items 38, 47 and 48
- [eli-integration-2026-tranche](../../docs/eli-integration-2026-tranche.md) — the application, the
  deadline and the gap table
