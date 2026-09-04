# ELI/NSI SMS Vendor Integration Application — draft answers

**Draft. Not submitted.** Against template **version 4.0, published 11/09/2025**, downloaded
2026-09-02. Deadline 5pm Friday 30 October 2026. Context and the gap analysis are in
[eli-integration-2026-tranche.md](eli-integration-2026-tranche.md).

**How to read the markers.** Every answer here is either sourced from this repository or marked:

| Marker | Meaning |
|---|---|
| `[OWNER]` | A decision or fact only the owner holds. Not guessable, and must not be guessed on a form |
| `[BLOCKED — spec]` | Needs one of the seven specification documents, which are **not on this machine**. Do not draft past this marker; an invented endpoint or message flow submitted to the Ministry is worse than a blank |
| `[GAP]` | The honest answer is "not built". The draft says so, and says what would change it |
| `[FIX FIRST]` | Small, real, and fixable before submission. Doing so changes the answer from a weakness to a strength |

**The rule for this document.** The Ministry publishes its expectation beside every question, which
makes it very easy to write the answer the expectation wants. Every claim below is one this
repository can evidence, and where it cannot, the answer says so. A vendor caught overstating in an
assessment document has spent the one thing it cannot rebuild — and this product's whole argument
is that it does not assert what it has not checked.

---

## Header

| Field | Value |
|---|---|
| Name of Organisation | `[OWNER]` — the repo names the vendor *Salix*; whether the applicant is Salix or Pearl of the Islands Foundation, and whether it is a registered NZ company, is not recorded here |
| Name of SMS | **Doorway** — `[FIX FIRST]` the name has never been trademark- or domain-checked (recorded in `unverified-claims`). Worth five minutes before it goes on a Crown application |
| Document Completed By | `[OWNER]` |
| Date Submitted for Review | `[OWNER]` |
| Primary Contact Person / Contact Details | `[OWNER]` |

---

# General Information

## SMS Platform and Roadmap

**AST01 — software and framework; bespoke, COTS, or COTS customised.**

Bespoke, built on standard, widely supported open-source frameworks. Web console and public site:
Next.js 15.3.9 (App Router, server-rendered React 19.2), TypeScript 5.9 in strict mode. Mobile:
Expo 57 / React Native 0.86, one binary serving every service. Data layer: PostgreSQL 17 on
Supabase, accessed through PostgREST and `SECURITY DEFINER` SQL functions; no ORM. Styling is plain
CSS with custom properties generated from a single shared token source. Error monitoring is Sentry,
dynamically imported and inert without a DSN. Hosting is Railway; mobile builds go through EAS.

The code is organised as six npm workspaces with an enforced dependency direction: `packages/core`
holds pure logic and has **zero runtime dependencies** — its TypeScript `lib` is `ES2022` with no
DOM and no Node types, so platform-specific code cannot compile into it — and `packages/api` is the
only place either application talks to the database.

**AST02 — product roadmap and upgrade management.**

Phased delivery, documented publicly in the repository with per-phase engineering estimates.
Node is pinned by `.nvmrc`; `next` and `react-native` are pinned to exact versions and the
remainder use caret ranges against a committed lockfile. A documented version-coupling constraint
is recorded in the manifest itself: Expo 57 / RN 0.86 is the first pairing that runs React 19,
which is what lets both applications share one logic layer.

`[GAP]` **There is no automated dependency-update tooling** — no Renovate, no Dependabot — and no
written upgrade policy. What stands in its place is a nine-command verification gate that must pass
before any change is considered done (typecheck, lint, unit tests, the RLS isolation suite, token
generation, documentation links, performance budgets, a live-schema security review, and a
production build), plus conditional gates for the mobile bundle, the offline queue, many-row reads
and schema changes. Adding Renovate is a day's work and would strengthen this answer materially.

**INF01 — other integrated software.**

Supabase (database, authentication, file storage), Railway (hosting), Sentry (error monitoring,
wired but inert without a DSN), Expo/EAS (mobile build and push transport), and an SMTP mailbox on
the customer's own mail host for one enrolment-enquiry notification.

**There is no accounting-package integration.** Billing produces a one-way CSV in Xero's
sales-invoice import shape; there is no OAuth, no API call and no stored third-party credential.
That was deliberate — a per-service refresh token is a new secret surface in a database that
currently holds no third-party credentials — and the export deliberately leaves `AccountCode` and
`TaxType` blank rather than guessing at a service's chart of accounts. No real Xero import has been
run, which is recorded as an open item.

An Anthropic API integration exists in code, is off by default per service, and has **never run**
against the live API. It can only send integers and booleans — the redaction type has no string
branch — so it cannot carry a child's name.

## SMS Application

**AST03 — database set-up and location.**

PostgreSQL 17 hosted by Supabase, single database, pooled multi-tenancy: one row in `centres` per
licensed service, with **Row Level Security as the tenant boundary rather than application
filtering**. The application layer contains no tenant filter at all, deliberately — see AST07.

**Location — answered 2026-09-02.** Two regions, and they are not the same. The database and file
storage are in **Sydney, Australia (`ap-southeast-2`)**, read from the provider's own project
record rather than assumed. The application tier that reads it runs in **Southeast Asia**.
**Neither is in New Zealand.**

The Ministry's expectation on this item is explicit — *"Where information is stored offshore, the
Ministry expects that this has been communicated and accepted by each service"* — so both regions
are now named in the customer-facing privacy statement, in the words a service reads, with the
plain sentence that its children's records are stored in Australia and that IPP 12 permits this
with comparable safeguards rather than requiring domestic hosting.

`[OWNER]` **The remaining half of that expectation is acceptance, not disclosure.** Naming the
region in a document is us communicating it; the Ministry also expects it *accepted by each
service*. That needs the pilot service to acknowledge it in writing, which is an email, not an
engineering task — and it should exist before this form is submitted.

Recorded honestly because the Ministry can read the repository: **this paragraph was a blank until
2026-09-02**, and the privacy statement said so, asking whether the records were in *"Sydney,
Singapore or Oregon"*. It was one authenticated API call to find out. A question that is cheap to
answer and stays open for a month is not blocked; it is unowned.

**AST04 — user interface and supported browsers.**

Browser-based, server-rendered; no locally installed client. The console is one Next.js process
serving React Server Components — there is no separate API tier beyond a health check.

`[GAP]` **No browser support matrix is documented.** There is no `browserslist` entry anywhere in
the repository, so the effective target is Next.js 15's default. What is *tested* is narrower and
deliberate: the automated accessibility and end-to-end suite runs on Chromium only, at 1440×900,
`en-NZ`, `Pacific/Auckland`, against a production build, with the reasoning recorded — the layout is
one grid and one flex row, and running the same rules three times measures the test runner rather
than the application. The public site is separately audited at 390px and 1440px.

Stating a matrix and testing against it is a small, honest improvement and should precede
submission.

**INF02 — supported devices, and whether a parent may sign a child in or out.**

Web console: any modern browser, responsive to a phone (the desktop side rail collapses to a
drawer below 768px). `[FIX FIRST]` the console does not export an explicit viewport declaration,
where the public site does and carries a comment calling it the single most important line in the
app. One line, and it should be added before anybody demonstrates the console on a phone.

Mobile: Android and iOS from one binary, portrait-locked, iPad supported, following the system
light/dark setting. Minimum OS versions are Expo 57 / RN 0.86 defaults and are not pinned or
documented. The app requests no location, camera, microphone, contacts or storage permission at
all. A tablet can sideload an APK without Play.

**Yes, a parent can sign their own child in and out**, at a shared entrance tablet, and the design
is deliberately asymmetric: signing *in* needs only a valid PIN; signing *out* additionally
requires the `can_collect` flag on that guardian's link to that child, because bringing a child in
is not taking one away. PINs are bcrypt-hashed with a per-row salt at work factor 10 and compared
inside the database, so the hash never crosses the wire; the table holding them has RLS enabled and
**not one policy**, so it is reachable by no application role — the test suite asserts that even a
service owner cannot read a hash. Five wrong attempts locks the PIN for fifteen minutes.

The kiosk is modelled as a **device, not a person**: it holds no capability, reads no table
directly, and everything it can do is a `SECURITY DEFINER` function that returns three columns per
child — id, display name, and present-or-not. No date of birth, so it cannot display a ratio; no
photograph, deliberately.

One limitation we state on the screen itself and repeat here: custody arrangements are free text
for a human to read, so **the tablet cannot enforce a parenting order.** A service that has left
`can_collect` at its default for a guardian who must not collect has a kiosk that will permit the
collection. That is documented, disclosed to the service, and the reason `can_collect` is enforced
at all.

**AST05 — how the product was made to meet sector needs, and who you engaged with.**

**This is the question where we are weakest, and the answer should not pretend otherwise.**

One service, engaged directly and continuously: **Little Pearls Educare Centre**, a two-site
not-for-profit education and care provider in Auckland — Mt Albert (MoE service number 46365) and
Mt Roskill (47407). A services agreement is in place; the pilot is free.

What came out of that engagement, concretely:

- The manager's own inventory of the five systems the service actually runs, which set the
  development programme and led us to §6-3 of the Funding Handbook and its twelve criteria for
  electronic attendance verification — and to the finding that the product recorded attendance but
  had never recorded that a family agreed with it. That gap was closed first, because it is the
  legally load-bearing one.
- Three batches of screenshots of the service's incident-and-checklist system, worked into a
  15-row module-by-module gap table, from which seven migrations and a work-queue feature were
  built. It also found a module we had not known existed.
- 22 screenshots of the service's learning-story platform, which produced a navigation map, a
  comment-and-moderation feature, and two findings that changed the plan rather than filling it
  in — including that one of their sites spans both licences, which our `centre_id`-per-service
  model deliberately does not.
- Specific dated requests, tracked with their reasoning — including one we have *not* built,
  because it reverses an earlier decision whose argument has to be answered rather than quietly
  overwritten.
- Two rounds of written enquiry to the Ministry's ELI team, in August 2026, both answered.

**And the honest limit: nobody at the service has used the product in production yet.** The
manager was invited on 6 August 2026 and has not accepted; both services hold a name, a service
number and a timezone, and zero child records. Migration from the incumbent system is blocked on an
export from that vendor.

So the truthful shape of this answer is: **designed with a service, against its real systems and
its real documents, and not yet operated by it.** We would rather say that than have the Ministry
discover it.

**INF03 — macrons, special characters and language support.**

Every text column is PostgreSQL `text` (UTF-8) with no collation override, no `citext` and no
`unaccent`; macrons round-trip through storage, the API and both clients. CSV exports emit a UTF-8
byte-order mark by default, because without it Excel on Windows renders `Tāne` as `TÄne` — three
bytes between a child's name being spelled correctly and not, asserted in the end-to-end suite
against a fixture child with a macron in their name.

There is exactly one place macrons are deliberately stripped, and it is download **filenames**,
because a filename crosses shells, mail clients and Explorer. File *contents* keep every macron.

Interface language: English, with te reo Māori interface *plumbing* built and proven end to end on
one page (locale by cookie rather than URL routing, because the middleware mints a per-request CSP
nonce and a second middleware would break it silently). **The te reo Māori message file contains no
real translation** — every value is the English string with a literal `[mi] ` prefix, and that
prefix is the safeguard. We will not ship machine-generated te reo Māori as though it were
translated; closing it needs a fluent speaker, and it is recorded as an open item rather than
presented as done.

Te reo Māori that *is* real in the product is hand-written interface copy and the five Te Whāriki
strand names, which carry a `name_reo` column and are flagged as needing a character-by-character
check against a verified copy of the curriculum before they are printed for a reviewer.

## SMS Environments

**AST06 — describe each of your environments.**

`[GAP]` **This is the answer that fails hardest against the Ministry's stated expectation of three
environments, and it cannot be dressed up: there is one environment, and it is production.**

There is no test or staging environment. There is a single Supabase project. Local development runs
against that same project — there is no local PostgreSQL and no container — and the RLS isolation
suite is *designed* to be safe against a live project (it runs inside a transaction that always
ends in `ROLLBACK`) precisely because that is where it runs. The repository's own continuous
integration configuration carries the note that this is worth moving to a dedicated database
"before this holds real children's records".

**And as of 2026-09-03 this is no longer only a policy gap — it measurably limits our ability to
test.** Two things surfaced on the same day. Our continuous integration has a job that asserts
tenant isolation and a job that drives the application through a browser; because both point at the
one project, **they cannot run at the same time**. The isolation suite deliberately asserts absolute
row counts across the whole database — that is what catches a policy leaking rows from anywhere —
and the browser suite seeds a service and writes to it, so run together the isolation job fails with
a message indistinguishable from a real tenancy breach. They are now run one after the other, and
the change is commented as the workaround it is. Separately, a browser run that leaves seeded data
behind breaks the isolation suite until it is removed, which happened and is recorded with its cause
still under investigation rather than assumed. Neither problem exists once there are two databases.

Building the Test environment the Ministry expects is a second Supabase project and a second
Railway service. The migration runner already tracks applied migrations with checksums and refuses
to run against a database whose files have changed, so standing up a second environment is
mechanical rather than architectural. **It is the single highest-value thing to do before
submitting**, because it converts a failed assessed item into a passed one, it is a prerequisite
for the Ministry's own testing (AST56 asks for remote access to a *test* environment), it removes
the testing constraint described above, and it is correct regardless of this application.

**AST07 — production access control model.**

*User identity provisioning.* Accounts cannot self-register; signups are disabled on the project.
A service is created by an operator-run script using the service key, because there is deliberately
no `INSERT` policy on `centres` and no `INSERT` grant on `memberships` — a self-serve version of
that is how a stranger joins a service and reads children's records. That script attaches only the
first owner or manager; educators and whānau are invited from inside the app by the service's own
staff.

Invitations store **only the SHA-256 of the token**; the issuing manager cannot read the hash back,
enforced by a column-level grant rather than a policy, because a policy restricts rows and only a
grant restricts columns. The invited email address must match the signed-in one. The account is
created before the invitation is claimed. `[GAP]` No mailer is configured for the console, so the
invitation link is shown to the manager once and passed on by hand.

*Authentication.* Email and password via Supabase Auth (GoTrue). Password minimum length is
enforced in the application and pushed to the project by a deploy script, because the project
default was six. Password reset is a GoTrue recovery link with a route that detects a
recovery-origin session from the JWT `amr` claim so a recovery link cannot be used as a general
session. `[GAP]` Reset emails have never been sent, and Supabase Auth's rate limits, session
lifetime and refresh-token rotation are unexamined defaults — recorded as an open item.

Guardian PINs at the entrance tablet are a separate factor with their own storage and lockout, as
described at INF02.

*Authorisation.* **Two independent layers, and only one of them is the boundary.**

The boundary is PostgreSQL. Every tenant-scoped table has RLS enabled, an explicit `GRANT`, and
policies whose predicates resolve the caller through `SECURITY DEFINER` functions against **live
membership rows** — so revoking a member closes their access immediately rather than at their next
sign-in. The role enum is `owner`, `manager`, `educator`, `parent`, `kiosk`. Both halves of every
policy (`USING` and `WITH CHECK`) are required, and `service_role` is granted explicitly rather than
by omission, because it bypasses RLS but not grants.

The second layer is a capability map in shared code that decides what the interface *offers*. It is
documented in its own source as **not the security boundary**, because the mobile app is a client
and a client can be modified. It fails safe: capabilities list the roles that hold them, so a newly
added role arrives holding none — which is how the `kiosk` role was introduced with its doors shut
before there was a key.

**There are two tenant boundaries, and the second is the dangerous one.** Service against service
is the obvious one. Guardianship *inside* a service is harder, because `parent` is a role within
the tenant: a parent at Mt Albert is a legitimate member of that service and must see their own
child's anaphylaxis plan and never the child sitting next to them. A policy keyed on the service
alone passes every naive test and hands one family another family's medical records. Guardianship
therefore has its own predicates, and a third gate exists for media: a photograph of a child
without recorded whānau consent is refused at upload, and if consent is withdrawn the photo becomes
*unreadable* rather than merely hidden, because the signed URL can no longer be issued.

Custody arrangements are visible to staff only and **never to any parent, including the parent they
concern** — a screen that shows one parent what has been recorded about the other makes the service
a party to a dispute.

**AST08 — access control for non-production environments.**

`[GAP]` Not applicable today, because there are none — see AST06. When the Test environment is
built the model is: a separate Supabase project with its own keys, its own service records, no copy
of production data, and access limited to the same short list of people who hold production
credentials plus the Ministry's testers.

**AST09 — source of data and separation between environments.**

`[GAP]` Honest answer: there is no separation, because there is one environment. Two specific
consequences we would rather disclose than have found:

1. Development and the automated suites run against the production project. The suites are built
   not to leave data behind — the RLS suite rolls back, the demo seed refuses to run without an
   explicit environment variable, tags everything it creates, uses the reserved `.invalid` TLD for
   email addresses so a stray notification cannot reach a real person, and can purge exactly what
   it made — but "safe" is not the same as "appropriate".
2. `[FIX FIRST]` The project's authentication schema still holds six accounts from an unrelated
   application that previously occupied it. They have no membership and land on a no-access screen,
   but they should be cleared as a deliberate act before this database holds real records.

On the Ministry's second expectation — that ELI production is never exposed to test data — the
control we would rely on is the same one that governs the demo seed: writing to ELI would be
environment-gated on an explicit configuration value, absent by default, with the destination
recorded on every event we send. That is a design commitment, not a built feature.

## SMS Database Security

**AST10 — database security.**

Access is by RLS-enforced, per-role grants as described at AST07; `anon` has no table grants at
all, and the automated review asserts it. Column-level grants narrow write access below what a
policy can express — for example `centres` permits updates to name, service number and timezone
and nothing else; `memberships` to role and revocation only; `messages` to a read receipt only.
Views run as the invoker, asserted from the catalogue rather than behaviourally, because the
behavioural test was passing for the wrong reason. Functions that must be `SECURITY DEFINER` have a
pinned `search_path`, asserted for all of them.

Transport: HTTPS only, with `Strict-Transport-Security` set for two years including subdomains,
`upgrade-insecure-requests` in the content-security policy, a per-request CSP nonce with
`strict-dynamic`, `nosniff`, and a permissions policy denying camera, microphone and geolocation.
The headers are set by the application as well as the host, because "the host does it" is an
assumption about a deployment.

`[GAP]` **Encryption at rest is not documented in this repository and we will not assert it on the
Ministry's form on the strength of what a platform probably does.** Supabase's encryption posture
must be read from its documentation and its contract, recorded, and cited here — `[FIX FIRST]`,
an hour's work, and the Ministry has stated the expectation explicitly.

`[GAP]` Also disclosed: the service key that bypasses RLS is required in the hosting environment
because invitation acceptance calls the authentication admin API, and the platform's build system
bakes environment variables into image layers — so image access is key access. It has never been
rotated, and the account-wide token used by the migration runner has never been rotated either.
Both are known, recorded, and should be addressed before this answer is submitted rather than
after.

## SMS Record Auditability

**AST11 — Privacy Act principles implemented, and how.**

The Privacy Act 2020 position starts from who the agency is: **the service** collects the
information and carries the obligations; the vendor holds it as agent. That is written into the
customer-facing privacy statement and needs to be matched in the services agreement. `[FIX FIRST]`
the section reference for the agent rule has not been read against the current Act — the substance
is not in doubt, the citation is, and it is flagged as such in our own document rather than
presented as checked.

- **IPP 6, access.** Load-bearing on the schema: a staff member can always read their *own*
  compliance records, because a police vetting result is personal information about the person it
  concerns and a policy hiding it would put the software in the way of a statutory right. They
  cannot edit it — a different question. Asserted in the test suite.
- **IPP 7, correction.** The correction model is supersession rather than overwrite throughout, so a
  corrected record and what it replaced both survive.
- **IPP 9, retention.** The whole retention design, including a sweep for guardians whose last child
  has left, because the contact details of a family who left seven years ago sitting in the table
  indefinitely is exactly what IPP 9 is about. See AST12 and the retention answer below.
- **IPP 12, cross-border disclosure.** The Act permits offshore storage with comparable safeguards
  rather than requiring domestic hosting — but a service should be told plainly. This is the same
  gap as AST03 and is `[FIX FIRST]`. It is also why automatic translation of posts about named
  children was **refused**: sending them to an overseas API is a cross-border disclosure made by
  default on behalf of a family who consented to a learning journal and not to that.
- **Part 6, breach notification.** A runbook exists. The service is the agency that notifies; the
  vendor's duty is to tell it immediately and help establish what happened. `[FIX FIRST]` the exact
  sections and the maximum penalty are flagged unchecked in our own document.

**A correction we record rather than hide, because it changed the design:** an earlier version of
our documentation stated the Privacy Act gives a right to request deletion. **It does not** — that
is GDPR Article 17 and does not apply here. New Zealand law gives access and correction; what it
imposes is a retention limit, which is an obligation on the service discharged by following a
schedule, not an endpoint an individual triggers. So the mechanism is a review somebody performs,
not a request somebody makes. The correction is carried in the migration header, the wiki and the
privacy statement.

What is deliberately **not** collected: no payment card details, no biometrics, no location (a
sign-in records a time, not a place), and **no analytics, advertising identifiers or tracking of
any kind — there is no third-party analytics script in either application.** Sub-processors are
named to the service: the database and storage host, the compute host, the error monitor (which
scrubs emails, phone numbers, dates of birth and quoted database values before sending, with its
own tests, because a bug there does not produce a wrong screen — it sends a child's medical
information to a third party), and the optional AI feature, off by default.

**AST12 — audit history: what is captured, in what detail, and what is available to Ministry
auditors.**

`audit_events` records the service, the actor (from the authenticated session), the verb, the table,
the row id and a timestamp. On update it diffs the new row against the old and stores **the names of
the columns that changed — never the values.** An update that changed nothing writes nothing.

That is a deliberate and consequential choice. A generic trigger logging the whole row would copy
every allergy and every custody order into a table nobody thinks of as holding them, and audit rows
outlive the records they describe. It is also **the only reason a child's record can be destroyed
while the evidence that it existed, was deliberately deleted, by whom and why, survives.** Had the
trigger logged contents, the duty to delete when no longer needed and the duty to keep a record of
what you did would be in direct conflict. Both halves are asserted: that the purge is recorded, and
that no name or medical detail survives in the recording.

It is append-only, and enforced twice — no `UPDATE` or `DELETE` policy, *and* those verbs withheld
at the grant layer from every role **including the service key**. The service key is otherwise the
credential that defeats every protection in the schema; it does not have to be able to rewrite the
record of what it did. The only credential that could alter the table is the database owner, which
is in no application's environment. That is the difference between a log and evidence. Asserted for
both an owner and the service key, by SQLSTATE.

The same append-only-by-grant treatment covers attendance events, consent decisions, adult counts,
staff attendance, messages, payments and comments. Attendance carries the reasoning explicitly:
backdating attendance is how a funding claim becomes fraud.

Retention: **indefinite**, and by design it could not be otherwise without a migration that grants
`DELETE` with a stated window — a deliberate, reviewable act rather than a capability that was
always quietly there.

*What a Ministry auditor can see, and this is where the answer weakens.* Through the product: a
printable evidence binder, ratio history, per-register views and six CSV exports. The binder
**deliberately never says "compliant"** — it opens by stating what it is derived from and what it
cannot show: ratio history comes from sign-in events, so a child present but never signed in does
not appear, and "no breach recorded" is not a guarantee ratios were kept; adult counts are figures
typed by staff; and where a certificate is listed as sighted, a named person recorded that they saw
it.

`[GAP]` **The audit log itself has no interface.** It is readable only by an owner or manager of the
service, and only through SQL or the database console — there is no audit page and no export route.
So "clear and unambiguous information available to Ministry auditors" is true of the compliance
evidence and **not** currently true of the audit trail. A read-only audit view, scoped to the
service and filterable by date and entity, is a small piece of work and the right answer to this
question; it is not built today.

`[FIX FIRST]` Our own customer-facing privacy statement tells families that "176 automated
assertions test this on every change". The suite is at **607**. The number understates the product
and is still an unmaintained figure in a document a family reads.

**AST13 — data integrity, and which users can alter records.**

Nobody can alter the append-only ledgers, including the service key. For everything else, writes
are granted per table and in several cases per column, and gated by role: owners and managers for
office data; educators for daily practice, health recording and posts they author; parents for
their own guardian record, their own children's consent decisions, marking a booked day absent, and
confirming their details are current — and nothing else.

Corrections are supersessions. A wrong sign-in time is two rows, not an edited row, with the
correction pointing at what it replaces and required to carry a reason of at least three
characters; resolution is transitive, so a twice-corrected event is not counted twice. After an
incident the question is always what was recorded at the time. There is no stored "present" flag
and there will not be one — a cached counter drifts, and drift in a ratio is not a display bug, it
is a compliance failure that reports itself as compliant.

Two integrity defects we found in our own product and fixed, which are worth stating because they
are the reason the general guards exist:

- **An issued invoice did not freeze, and our documentation said it did.** The line-item policy did
  require draft status; nothing stopped the *invoice* being set back to draft, edited, and
  re-issued — three ordinary statements, no privilege escalation, and a family billed a different
  amount from the one they hold. Fixed with a transition-enforcing trigger, because "was this
  already issued" is a question about the transition and only a trigger sees both tuples.
- **A narrowing condition placed only in `WITH CHECK` is not enforced on `DELETE`.** A `FOR ALL`
  policy is asymmetric to begin with: PostgreSQL checks `USING` for delete. So a line could be
  deleted from an *issued* invoice — and because a credit is a negative line by design, deleting the
  credit makes a family owe more than the invoice they hold. Found by querying the catalogue, which
  is the only thing that could have found it. Fixed, **and generalised**: a migration-time check and
  a runtime assertion now require every delete policy to match its insert counterpart, with an
  allow-list of the two tables where the difference is legitimate and the reason recorded inline.

Generated columns cannot be written by anyone, service key included. Published checklist versions
and completed runs cannot be edited. Posts cannot be deleted by any application role — a pānui a
family has read should not be able to vanish. Attendance and adult counts carry a client-supplied
idempotency key that is unique, so a retried offline flush is a no-op rather than a duplicate
sign-in.

Deletion is genuinely available in exactly one place — job applications — and it is framed as
retention rather than erasure: the service choosing not to keep the history of somebody it did not
employ. The audit log records that a deletion happened and keeps no copy of the row, asserted in
the suite, so "we removed your application" is checkable rather than reassuring.

## SMS Record Usability

**AST14 — usability of the records.**

*Located and retrieved:* every register has a screen; children, staff, attendance, billing and
funding have CSV exports; incidents have an individual printable view.

*Preserved:* append-only ledgers, supersession rather than overwrite, no delete grant on
compliance evidence — a lapsed certificate quietly removed is indistinguishable from one that never
existed, and "we held a current first aid certificate in March" is what a review asks.

*Interpreted:* the surfaces state their own limits. Occupancy is not capped at 100% and the page
explains why an over-100 day is not necessarily a breach. Averages divide by **open days, not
calendar days** — ninety children across five calendar days is 18, across the three days the
service was actually open it is 30, and that is exactly the number that ends up in a board paper.
Where nothing was recorded the value is `null`, not `0`, and the type system makes a caller handle
the case where there is no percentage rather than reading one that does not exist. The funding
export carries its own disclaimer *in the rows* — an unresolved-days column naming the dates —
because a CSV emailed to an accountant loses every banner it came with.

What the exports deliberately omit: no health conditions, no allergies, no custody notes. A
spreadsheet of children's medical information is the most damaging file this product could produce,
and "it would be convenient" is not a reason to produce it. The emergency list that genuinely needs
allergies is a printed page, not a file.

`[GAP]` PDF is the browser's own print dialogue rather than a server-side renderer, so nothing can
be generated and emailed on a schedule. And there is no whole-service self-service export — see
AST46.

## SMS Version Control

**AST15 — version control on production.** Git, single `main` branch, linear history, hosted on
GitHub. Every schema change is a numbered, forward-only SQL migration — 79 to date, no gaps, none
ever removed. `[OWNER]` **the repository is public**, which is a deliberate decision and one the
Ministry should hear from us rather than discover: no credential is in it, but every policy, our
complete catalogue of what nobody has checked, our breach runbook and a named customer are.

`[GAP]` There is no branch protection, no review requirement, no code owners and no pull-request
template; the project has had one author.

**AST16 — process and triggers for moving code between environments.** Push to `main` triggers the
CI workflow and the hosting platform builds from the same repository. **Migrations are applied from
a laptop by a runner script, never by the deploy** — the rule is migrate first, then deploy. The
runner records each applied file with a checksum, refuses to proceed if a file changed after it was
applied ("this database and this repo now disagree about the schema — refusing to guess"), records
success only after the migration succeeds so a failure leaves it pending, and has read-only status
and baseline modes.

`[GAP]` **There is no CI gate in front of the deploy.** The platform will deploy a commit no check
has seen. Our own deployment document names this as the thing to fix next, and it should be fixed
before this form is submitted: a deploy pipeline in front of an untested boundary is a faster way
to publish a mistake.

**AST17 — how deployments are reversible.** The platform redeploys a previous build from its
deployment list, which rolls back **the code and nothing else**. Migrations are forward-only with
no down scripts; since they only add or tighten, an older build against a newer schema generally
runs, but that is not guaranteed. The honest answer is: code rollback is a click, schema rollback
is a new migration, and the status command tells you what you are rolling back onto.

## SMS Vendor Testing

**AST18 — testing methodology.**

| Suite | Scale | What it proves |
|---|---|---|
| Unit | **678 tests across 47 files**, Vitest — measured by running them on 2026-09-03, not counted from source, across five workspaces (core 554, web 67, site 40, api 11, ai 6). The previous figure here was 631 across 46 files on 2026-09-02; the difference is the census suite | Ratios, funding, hours, roll, CSV, redaction, the offline queue, capabilities, date handling, the ECE Return's staffing section |
| **RLS isolation** | **634 assertions**, one self-contained 8,880-line SQL script — the count is the one the runner prints, measured 2026-09-03 (previously stated as 607 over 8,435 lines) | Two services and two members, each impersonated exactly as the API layer would by setting the role and the JWT claims; neither can read *or write* the other's rows, in both directions; guardianship inside a service; and six catalogue-driven class assertions that cover tables which do not exist yet |
| End-to-end and accessibility | Playwright + axe-core. **119 passing as at 2026-09-03** — see the disclosure below | 21 screens across owner and parent sessions against **WCAG 2.2 AA with all six axe tags**, on a production build, with data seeded — because auditing an empty page measures nothing. The role matrix in the same suite proves an educator cannot open the office screens and a parent cannot open another family's child by URL: the second tenant boundary, checked at the HTTP layer as well as in Postgres |
| Live-schema security review | 17 checks | RLS enabled everywhere; a policy on every reachable table; append-only grants; definer functions with pinned search paths; the consent gate restrictive; invitation hashes unreadable; no public storage bucket; `anon` holding no grants |
| Purpose-built drills | 4 | The offline queue against live PostgreSQL (10/10); the PostgREST row cap (1,200 events, exactly 50.00 hours); a full extract-and-reload restore (6/6 over 12,930 rows and 72 tables); documentation link integrity |
| Budgets | gzipped bytes | First-load JS, CSS and middleware, per app |

Two methodology commitments matter more than the counts. **Mutation testing is mandatory**: our
first isolation suite passed 63/63 on the first run and was not trusted, so the child policy was
deliberately weakened to service-only, the suite failed on the assertion it should have failed on,
and the policy was restored. A test that cannot fail is not a test. And **suites fail loudly rather
than skipping** when no connection is configured, because a green run that silently tested nothing
is worse than a red one.

`[GAP]` **The disclosure that has to accompany all of it: continuous integration has never passed —
137 runs, zero successes.** The first job fails on a performance budget, 113.0kB first-load
JavaScript against a 106kB limit, recorded as pre-existing and still unattributed. The other two
jobs fail at their credential guards, because the database URL and service key are not in
repository secrets — so **the RLS suite, the restore drill, the security review and the entire
accessibility audit have never run in CI at all.** Every gate this product has is run by hand on one
machine, and reported that way, which is how it stayed honest and also why nobody noticed.

A CI that has been red for its whole existence carries no signal; the 137th failure is
indistinguishable from the first real one. `[FIX FIRST]` — the credentials belong in secrets and the
7kB belongs attributed, not waived. Raising the limit to make it pass is the move our own
contributor rules forbid by name.

**A disclosure worth reading, and it resolved the same day.** On 2026-09-03, trying to verify a new
screen, we found the end-to-end and accessibility suite had been failing entirely for six days —
every navigation timing out at 60 seconds, 42 tests, on screens unrelated to any recent change. We
diagnosed it to a single line: a health-check `fetch` in the application shell resolved its headers
and never read its response body, which leaves the request in flight in Chromium and meant the
test runner's "network is idle" condition could never be satisfied. **The suite is now at 117
passing, 1 failing.**

We include this because of what it says about the four checks it also exposed, each of which had
been invisible while nothing could run: three test locators broken by an unrelated feature naming
the same screens twice; one test asserting a funding banner state that a shipped improvement had
replaced with a stronger one; and — the one that matters — **two incident writers that inspected
only the error from an update and not whether any row changed.** Under row-level security a refused
update matches nothing and the database driver reports that as success, so those two paths could
report a saved correction on a compliance record that had not been saved. Fixed, with the check
that three sibling functions already had.

~~**One failure remains and we are not glossing it:** a corrected incident draft is not appearing on
the screen that reports it saved. The write provably succeeds and the page is revalidated, so the
cause is not yet known.~~

**Closed 2026-09-03, and the sentence above was wrong in a way worth stating rather than deleting.**
*"The write provably succeeds"* was not a finding, it was an inference from the wrong signal: a
newly-added zero-row check was not firing, and we read that as proof the write had landed. It was
silent because the **error** branch fired first — the write was raising
`42501 permission denied for table incidents` every time. A passing zero-row check only means an
update did not silently match nothing; it is not evidence that anything was written.

The cause was a missing column privilege. Migration `0066` added `incidents.room_id` without adding
it to the column-scoped UPDATE grant, so **no incident draft could be corrected between 2026-08-28
and `0082`** — on a compliance record. The end-to-end suite is now **119 passing, 0 failing**, and
the RLS suite carries an assertion that fails against a database without `0082`.

**Two honest lessons, and both are arguments for the test environment `AST06` asks for.**

First, a suite run by hand from one laptop against the single live database produced six days of
failures that looked exactly like an environment problem, and hid four real defects behind them. A
vendor that cannot tell those apart is a vendor whose green run means less than it appears to.

Second, and more concrete: on 2026-09-03 we found that our two credentialled CI jobs **cannot run at
the same time**, because the RLS-isolation job asserts absolute row counts across the whole database
and the end-to-end job seeds a tenant and writes to it — and both point at the one project, because
there is only one. They are now serialised, which is a workaround and is commented as one. The same
single project also means an end-to-end run that leaves anything behind breaks the isolation suite
until it is cleaned up, which happened and is recorded with its cause still open. **A shared
production database is not merely a policy gap; it is now a measured constraint on our ability to
test at all.**

**AST19 — defect management.**

`[GAP]` Honest answer: **there is no defect tracker.** What exists is three dated narrative
registers — a session log, an append-only wiki change log where correcting an earlier entry means a
new entry saying so, and a 46-item numbered register of everything the product asserts that nobody
has verified, each item carrying its state and what would close it. Defects are traced to a
commit and, for schema issues, to a migration number, and our contributor rules require that a
found defect be written up **with its mechanism** in the same commit as the fix, before the commit.

That has caught real things — including three tables whose audit triggers fired and wrote nothing
for months, because the rows carried no resolvable tenant key, while both the test suite and the
security review reported them covered. Nothing was backfilled, because the rows were never written
and inventing plausible actors would be worse than the gap.

But it is prose. There is no severity taxonomy, no defect-to-release traceability and no queryable
state. Adopting an issue tracker is a day and would make this answer defensible instead of candid.

## Disaster Recovery and Business Continuity

**AST20 — backup method, frequency, location and coverage.** The platform takes a **daily logical
backup**, retained per the project's plan. `[GAP]` **Point-in-time recovery is not enabled** — it is
a paid feature and the decision has not been taken. The recovery point is therefore **up to 24
hours**. This is documented as a decision rather than an oversight, with its business consequence
stated: a lost Tuesday has to be excluded from the funding claim, not estimated. It is the right
thing to buy before a second service is onboarded.

`[GAP]` No independent off-site copy is taken by us, and the platform's own dumps have never been
verified by restoring one. File storage — every photograph — is outside the database and **has no
backup drill at all**.

**AST21 — process and timeframes for a database restore.** `[GAP]` There is a seven-step written
runbook and **it has never been executed**. There is no measured recovery time and we will not
invent one.

What *has* been executed, and repeatedly, is a restore **drill**: it enumerates every table from the
catalogue — so a table added by a future migration is covered without anyone remembering — extracts
every row, reloads it into a shadow schema, and compares row counts and a content fingerprint per
table. Currently green at 6/6 over 12,930 rows and 72 tables. It is mutation-tested: appending one
character to one field of one row out of 485 was caught and the table named.

**That drill found the most serious defect in this product's history, and the story is the reason
to trust the drill rather than the runbook.** Six tables covering the operational core carried a
`CHECK` constraint requiring the event be less than fourteen days old — a guard against backdated
attendance. It meant **a backup of those six tables more than a fortnight old could not be loaded at
all**, by our drill, by `pg_restore`, or by any recovery. Nothing on any screen would have shown it;
the guard would simply have been discovered to be unusable at the moment it was needed. The
mechanism is that a dump emits table definitions, then rows, then triggers — so a `CHECK` is in
force while rows land and a trigger is created afterwards and never sees them. All six moved to
triggers, with an explicit restore mode, and a following migration makes the trigger name itself so
the offline queue can distinguish an aged event from a drifted clock.

We record that our first written explanation of *why* the fix worked was wrong, and the correction
sits in the migration header. "Retained" and "restorable" are the same requirement read carefully.

**AST22 — business continuity for services while the system is down.**

The genuinely designed-for case is a network outage during sign-in, which is the moment that
matters: an educator needs to know who is in the room. Both clients hold an **append-only outbox**.
A tap writes locally and returns — no spinner, no disabled button, because on a bad connection those
make a working app feel broken and the write has genuinely succeeded, locally. The row carries a
"not sent yet" badge. A flush runs on mount, on returning to the foreground and after each tap;
there is no connectivity library, because the flush attempt *is* the connectivity check.

Three properties that took getting wrong to learn: the idempotency key is generated **once, at
enqueue**, never per attempt; **queued events count toward the ratio**, because an invisible offline
sign-in means an educator sees fewer children than are in the room, which is wrong in the dangerous
direction; and failures are classified **three** ways — permanent, transient, and *retry-later* —
because a device clock running fast is self-healing and calling it permanent buried real sign-ins.
Verified 10/10 against live PostgreSQL through the same code path the app uses, including a forced
duplicate flush that wrote nothing.

`[GAP]` Two honest limits. The web console is server-rendered with no service worker, so **work made
offline survives only while the tab stays open** — a reload with no connection gives the browser's
error page, which is what a wall tablet shows after a power cut. The mobile app is a binary and does
survive a restart. And the entrance tablet has **no offline queue at all**, deliberately: a PIN
cached on an unattended tablet defeats the reason the PIN exists.

`[GAP]` Beyond that there is **no documented business-continuity procedure and no paper fallback**,
and no uptime monitoring, alerting or log retention beyond the platform's default — so the
mechanism by which we would learn of an outage is a service telling us. That happened once, six
days after the fault. Monitoring and a one-page paper fallback are both cheap and both belong before
submission.

## Operational Support

**AST23 — support process for ECE services.**

`[GAP]` **There is no documented support process, no service level agreement, no channel and no
helpdesk.** Support today is a direct relationship with one pilot service, informally. There is no
transactional email at all in the console, which is why invitation links are passed by hand.

What exists in place of support is **contextual help inside the product**: a `?` beside every screen
heading and a help page, both rendered from one array, adding 186 bytes of JavaScript, and every
entry carries a third field — *what this screen will not tell you*. Coverage is enforced by a test
that derives the screen list from the layout, so an undocumented route fails a check.

A support plan is a document, not an engineering project, and the Ministry has asked for one. It
should exist before this form is submitted: hours, channel, target response times by severity, an
escalation path, and who is on it.

**INF04 — resolving data quality issues.** `[OWNER]` a named contact is required. The mechanisms
that exist are preventative: refusal rather than coercion at every import boundary (a name that
disagrees with its NSN is a refused row, not a merged one), completeness banners on the funding
screen that name the specific dates a record is broken rather than a count, and the three-state
`null`-is-not-`false` convention so "not checked" never renders as "fine".

---

# MINISTRY Credentials

**AST24 — ESL authentication process flow for ELI and NSI.** `[BLOCKED — spec]` Requires the
InfoHub specification and the NSI GINS. A flow diagram must be specific to our SMS and cannot be
drawn from the public schema, which defines message content and nothing about transport or
authentication.

**AST25 — how ESL machine account credentials will be handled.** Partially answerable, and the
honest answer includes a current weakness. The commitment: credentials in the hosting platform's
secret store, never in the repository, never in the mobile workspace or a browser bundle (the
mobile build system inlines every public-prefixed variable into the shipped binary), and never in
the client. `[GAP]` The weakness to disclose is that our platform's build system bakes environment
variables into image layers, so image access is credential access, and our existing service key has
never been rotated. A rotation schedule and a decision about where ESL credentials live —
plausibly not in that platform at all — are prerequisites, not details.

**AST26 — transport encryption and cipher used to communicate with ESL.** The Ministry states the
requirement: NZISM, TLS 1.2 or above, endorsed cipher
`ECDHE-RSA-AES256-GCM-SHA384`. `[BLOCKED — spec]`/`[FIX FIRST]` We can commit to it, and we should
*verify* rather than commit: what our runtime negotiates has never been measured, and no TLS
version or cipher is documented anywhere in this repository. Measuring it against the ESL test
endpoint is the real answer, and that needs the endpoint.

---

# SMS Integration with National Student Index

**AST27–AST30 — four data-flow diagrams: search and create an NSN with an identity document
present; without one; update date of birth and identity for an unverified child; update the name of
a verified child.**

`[BLOCKED — spec]` All four. These are the heart of the technical assessment and they cannot be
drafted from public material — the public schema carries `NationalStudentNumber` as a field on
`ChildIdentity` and says nothing about how it is obtained.

What can be stated now, because it is about our data rather than the interface:

- `children.moe_nsn` exists, is nullable and is **unique per service**.
- `[GAP]` There is **no identity-document verification anywhere in the product** — no
  birth-certificate or passport field, no sighted-by/sighted-at pair on the child record, though
  that exact pattern is used for immunisation and staff records. AST28's "identification document is
  not present" path is therefore the *only* path we could implement today, which is the wrong way
  round.
- On whether an NSI record overrides ours (AST27's second half): our position would be that the NSI
  is authoritative for legal name and date of birth and the SMS record is updated from it, with the
  change recorded in the audit trail and the *preferred* name — a separate column — left alone,
  because what a service calls a child is not a legal-name question. **That is a design intention,
  not a decision, and it needs the appendix before it is written on a form.**
- Our import tooling already refuses a row whose name disagrees with its NSN rather than merging
  it, which is the same class of judgement AST30 is about.

**AST31 — database changes required to comply with NSI data fields.** `[BLOCKED — spec]` for the
field list. Known already from the public ELI schema: we hold one family name and one first name
where the interface takes up to **three official given names**, and no middle name at all. ~~And the
child record has no residential address — addresses are held on guardians — which `ChildEnrolment`
requires as a mandatory primary address with an optional secondary.~~ **Built 2026-09-04:
`child_addresses` (`0086`)**, at most one primary and one secondary per child, `Address1Line` and
`AddressCity` required and the rest optional, matching `ChildEnrolmentAddress`. The names remain a
migration, and it is certain irrespective of the NSI specification.

**AST32 — how the SMS ensures compliance with NSI business rules.** `[BLOCKED — spec]`

**AST33 — how a business rule validation error is caught, handled and corrected.** Answerable as an
architecture, and it is one we already run: validation failures are classified into permanent,
transient and retry-later; permanent failures dead-letter with the offending record and the reason
attached to the row a person is looking at, rather than to a log; and the queue stops at the first
transient failure rather than grinding against a failing endpoint. The specific rules and their
error codes are `[BLOCKED — spec]`.

---

# Early Learning Information

**AST34 — transmission approach, storage of events, triggers and schedule.**

Answerable as a design, and it reuses machinery already in production rather than proposing
something new. Events would be rows in an append-only outbound table carrying the payload, the
target, the attempt history and the classification of the last failure — the same contract as the
client outbox described at AST22, pointed outward: the message identity fixed at enqueue and never
regenerated on retry, three-way failure classification, and a flush that stops at the first
transient failure. That last property is also the answer to the Ministry's parenthetical about
adjusting the schedule to avoid overloading its systems: the send interval and batch size are
configuration, and the queue is already built to back off rather than hammer.

`[BLOCKED — spec]` The transport, the endpoints, the batching rules and any Ministry-imposed
schedule constraints.

**AST35 — how the SMS recognises events in order to create the message.**

Partly answerable, and this is where our architecture genuinely helps. Attendance, adult counts,
consent decisions and staff attendance are **already append-only event ledgers with supersession**,
which is the same model the ELI interface uses: a correction is a new event pointing at what it
replaces, and most ELI events have `Delete` and `Undelete` siblings for exactly that. So attendance
and consent events are recognisable directly.

`[GAP]` The others are not, and the reasons are specific:
~~`ChildBookingSchedule` needs an effective-dated weekday pattern and we store one row per
calendar date with no pattern~~ — **built 2026-09-04 as `child_booking_schedule` (`0085`)**, keyed
on the child as the XSD is, with a screen and three consumers in the funding calculation;
`TwentyHoursSchedule` needs an attestation date and per-weekday hours, and **`0084` added the
attestation date and signatory** so what remains is the per-weekday split rather than the whole
shape; ~~`EceServiceClosure` has no counterpart at all~~ — **`service_closures` (`0088`)**, with
`0091`'s emergency-closure fields, built because §6-6 suspends the Three Week Rule across a closure
of two weeks or more; `ChildDemographics` needs up to three iwi and three home languages where we
hold one of each.

**AST36 — event logs: location, retention, detail, access and security.**

The pattern is established and would be followed: append-only at the grant layer so no application
role can alter or delete an entry, the service key included; readable by an owner or manager of the
service; indefinite retention, changeable only by a migration that grants `DELETE` with a stated
window. Detail would record the message identity, the target, the timestamp, the response and the
classification — and, following the rule that governs our audit table, **not the payload values**,
because a log of every ELI message is a second copy of every child's identity data living under a
different rule from the first.

`[GAP]` That last point needs a decision rather than a default, because the Ministry may require
the payload be reproducible for dispute resolution. It is worth asking.

**AST37 — system and business process for errors, using `400 invalid_auth`.** `[BLOCKED — spec]` for
the error catalogue and semantics; the handling architecture is AST33 and AST34.

**AST38 — database changes required to comply with ELI data fields and event records.**

**Answerable now, from the public schema, and this is the most useful thing in this document.** The
field-level mapping is in [the wiki page](../llm-wiki/wiki/eli-integration.md). Summary of what
must change:

| Change | Why |
|---|---|
| Up to three official given names on the child | Schema takes three; we hold one |
| ~~A residential address on the child or the enrolment, with primary/secondary~~ | **Done — `0086`.** `child_addresses`, one primary and one optional secondary per child |
| Three iwi and three home-language slots | We hold one of each |
| Ethnicity, iwi, language, gender as **codes** against effective-dated reference tables | All are free text or local CHECK constraints today |
| ~~An effective-dated weekday booking pattern~~ | **Done — `0085`.** `child_booking_schedule`; `bookings` stays as the per-date layer, and the rule is that a block is authoritative where one exists |
| An attestation date and **per-weekday hours** for 20 Hours | **Half done — `0084`** added `twenty_hours_attested_on`/`_by`, paired by a CHECK. The per-weekday split is still absent |
| ~~A service closure record~~ | **Done — `0088`**, plus `0091`'s `claimed_as_emergency` and three-state ERO approval, because §7-5 makes an approved emergency closure claimable and a term break not |
| ~~A service type on `centres`~~ | **Done — `0083`.** `licence_type` and `service_model`, settable in Settings. RS7's advance counts now have their axis; the **ratio schedules** for sessional and home-based are still untranscribed, which is a different gap |
| The entire staff/census surface | Eleven of fifteen fields have no column |
| `EntityId` columns for children and enrolments | See AST42 |

**AST39 — XML message creation and validation before sending to InfoHub, and informing the user of
failures.**

Validation against the schema before transmission, refusing to enqueue an invalid message rather
than discovering it at the far end. This is a pattern the product already applies at every import
boundary: parse, validate, match, **refuse**, report — with a dry run that writes nothing as the
default and an explicit flag required to commit.

The schema is available: `https://eli.minedu.govt.nz/eli.xsd` is served publicly, and every string
length bound, enumeration and cardinality in it can be enforced locally. **`[BLOCKED — spec]` is
narrower than expected here** — it is confirmation that the public schema is the normative one, and
the InfoHub transport. Enquiry question 5.

**AST40 — business rules beyond the XSD.** `[BLOCKED — spec]` The Ministry's own phrasing confirms
the schema is a floor. Requires the ELI Data Collection Specification.

**AST41 — how the user is notified of a business rule violation.** The convention the product
already follows: the failure is attached to the record it concerns and named specifically. The
funding screen is the working example — it lists the *dates* a record is broken, not a count,
because a manager fixing three missing sign-outs needs to know which three; and a period the records
do not cover renders differently from a period they do, with a third state for "nobody checked"
rather than defaulting to reassurance.

**AST42 — how `ChildEntityId` is created and managed through its lifecycle.**

`EntityId` is a 1–255 character string the vendor assigns. Our children carry a database-generated
UUID as primary key, which fits and is stable for the life of the row. The intended answer:
**the child's UUID is the `ChildEntityId`, assigned at creation, never reused, never changed** —
including through a name change, an NSN allocation, archival or a purge, because an identifier that
changes when the record changes is the bug the identifier exists to prevent.

`[BLOCKED — spec]` One question we will not guess at: what a *purge* means to ELI. Our retention
process destroys a child's record after seven years while the audit trail survives. Whether that
requires a `ChildIdentityDelete` event, and what happens to the entity id afterwards, is a
specification question with a compliance consequence, and it is the sharpest one on this list.

**AST43 — how `ChildEnrolmentEntityId` is managed: started then ended then corrected; started then
deleted.**

Same principle: the enrolment row's UUID, assigned at creation, never reused. An enrolment ended
and then corrected is the *same* entity re-sent with a changed end date; an enrolment created in
error is `ChildEnrolmentDelete` against the same id and the id is retired rather than recycled.
Our schema helps here — a GiST exclusion constraint makes overlapping enrolments for one child
impossible at the database level, so the "started then ended then corrected" sequence cannot
produce two live enrolments. `[BLOCKED — spec]` for confirmation that re-sending is the correct
correction mechanism rather than delete-then-recreate.

**AST44 — the initial data load to ELI Compliance and then ELI Production.** `[BLOCKED — spec]`
Architecturally this is the same queue with a different target and no rate limit concern, and our
restore drill already demonstrates a full extract of every table from the catalogue.

**AST45 — importing a service transferring from another SMS.**

Three importers exist and share a deliberate design: they parse **our** documented format rather
than a vendor's, so a human maps the file once and the importer never guesses; `source` is a
required field; a dry run that writes nothing is the default and an explicit flag is needed to
commit; and refusal is the substance — a name disagreeing with its NSN is refused, zero or several
name matches is refused, a child with no guardian link is refused, and a re-import prints a
before/after report for every field it would overwrite.

`[GAP]` Two real weaknesses to state. **The `source_system`/`source_ref` integration key is
documented in two places and built in none** — so matching today falls back to name and date of
birth, which is a merge risk with siblings and changed surnames. It is one migration and should
exist before this answer is submitted. And two of the three importers were written against formats
we defined because no real export was available, which they say in their own headers; the third
was built against a real account whose export files turned out to contain **zero records** despite
claiming 243 — diagnosed as a dump of the browser's offline cache rather than the account.

**AST46 — exporting a service's data when it leaves.**

`[GAP]` **There is no self-service export-everything path.** What exists: six per-domain CSV
exports, each re-checking authorisation itself (and two deliberately *stricter* than the screen
they sit beside — a parent reads the children screen and sees one child, but a *file* leaves the
product and sits in a downloads folder), printable views, and an operator-run whole-database extract
that writes one JSON file per table, enumerated from the catalogue.

That extract is a developer command requiring the service key, not a feature, and **it does not
cover file storage** — every photograph is an object outside the database. A service leaving today
would be supported by a person, not a button. The Ministry's expectation is explicitly that we
"provide support for a service who wishes to be removed", which we can commit to; a self-service
export is the right answer and is not built.

**AST55 — supporting updates to reference lists with effective start and end dates.**

`[GAP]` **Nothing in this product has effective-dated reference data.** Enumerations are expressed
three ways — 36 PostgreSQL enum types, CHECK constraints, and TypeScript unions — and **none can
carry an effective date**; a PostgreSQL enum structurally cannot. Ethnicity and iwi are free text,
and qualification codes do not exist at all.

The one precedent is the licensing-criteria table, which carries an effective-from date, a
current flag, a mandatory source citation and a supersedes-code column for renumbering — and which
is **deliberately seeded empty**, because a plausible-looking invented criterion is worse than none.

That is the pattern the Ministry's reference lists should follow: a table per code set with value,
label, effective start and effective end, a source citation, and an importer that requires the
source. **We will not seed invented code values** — it is forbidden by our own contributor rules
and it is exactly the failure mode this product exists to avoid. Enquiry question 6 asks where the
authoritative lists are published and whether they carry effective dates already.

---

# ECE Return Data

**AST47 — the ECE Return data-source table.**

**Rewritten 2026-09-03. This answer said the table could not be completed; it can now, and the
first draft is below.** What changed: `staff_census_details` and `staff_contact_hours` were built,
along with the logic that assembles the staffing section and the screen a manager fills it in on.
The original answer is worth recording rather than deleting, because it named eleven of fifteen
fields as having no column anywhere — which was true on 2 September and is the measurement that
prompted the work.

| Parameter | Source | Editable in | Comment |
|---|---|---|---|
| Wait times, per age | **N/A — not held** | — | `ServiceDetails` wants five age-banded wait-time codes. Nothing in this product records a waiting time by age; the waitlist holds enquiries, not a per-age wait |
| Language code / percentage | **N/A — not held** | — | `ServiceLanguageList` wants one to five languages with usage percentages for the *service*. Not modelled |
| Gender code | Staff census record | ECE Return screen | **Cannot be filled in yet** — an unenumerated Ministry code list, not loaded. The input is disabled and says so |
| Staff role code | Staff census record | ECE Return screen | As above |
| Highest qualification code | Staff census record | ECE Return screen | As above |
| Highest Playcentre qualification code | Staff census record | ECE Return screen | As above. Also not applicable to our service type as far as we can tell |
| Ethnicity | Staff census record | ECE Return screen | As above. Up to three, matching the schema's cardinality |
| Is paid / Is permanent / Is full time | Staff census record | ECE Return screen | Three-state on the screen: *not recorded*, yes, no. A blank stores null rather than false, so an unanswered question cannot be submitted as "unpaid" |
| Is registered | **Derived** — a `practising_certificate` compliance record | Compliance records, not the Return | Not editable on the Return screen on purpose: it comes from the same row the licensing binder reads, so the two cannot disagree. A null expiry counts as *not* current. **Where no certificate is linked the value is null, not false**, and the person is reported as incomplete — we will not assert that a named individual is unregistered on the strength of a missing row |
| Start date / End date **working at the service** | Staff member record | Staff screen | `started_on` / `finished_on`. These also decide who is on the roster at the return date |
| Start date / End date **in role at the service** | **N/A — not held.** See the correction below | — | §14-2 asks for both pairs and we hold only the first. We read the schema's `EducationalStaffRole.StartDate`/`EndDate` as the *in-role* pair, given where it sits — enquiry question 2 |
| Age band | Staff census record | ECE Return screen | One of the twelve bands the schema enumerates, so this one is a real dropdown. **We store the band, not a date of birth** — the band is the minimum that answers the question |
| Weekday code | **System generated** | — | From the contracted contact hours; mapped to the schema's `Mo`–`Su` at the boundary |
| Contact start / end time | Staff contact hours | ECE Return screen | An effective-dated weekday contract, distinct from the dated roster. Superseding hours ends one block and opens another; the database refuses overlapping blocks on a weekday. **Whether this field wants the contract or the actual hours is open — enquiry question 1** |
| Hours worked (census week) | **Derived** — the sum of the contracted blocks | Not editable | Floored to the whole number the schema takes, with the exact minutes retained alongside so the truncation is visible rather than silent. **Same open question:** §14-2 calls this *"Total Hours worked during the ECE Census week"*, which reads as measured rather than contracted |
| Min / max age taught | Staff census record | ECE Return screen | Months, 0–72, as the schema specifies |
| Previously worked as teacher / Arrived from another service / Leaving destination | Staff census record | ECE Return screen | Three-state, three-state, and one of the five codes the schema enumerates — shown as raw codes because the schema does not define them and we will not invent a label |

**Corrected 2026-09-03 against §14-2 of the Funding Handbook**, which lists the census fields in the
Ministry's own words and which we had not read when this table was first drafted from the schema
alone. Three things came out of it, and they are the reason a schema is not a specification:

1. **There are two pairs of staff dates, and we hold one.** *"Staff start and end dates working at
   service"* and *"Staff start and end dates in role at service"* are separate items. The schema
   carries one pair, inside the role block, which we now read as the in-role pair — enquiry
   question 2. One migration either way.
2. **The Handbook says "actual" where we built "contracted".** *"Actual contact hours … actual
   contact start and finish times spent teaching children"* and *"Total Hours worked during the ECE
   Census week"*. Our `staff_contact_hours` is an effective-dated weekly **contract**, and the
   hours total is derived from it. The schema's field has no dates and looks contract-shaped; the
   Handbook's wording is unambiguously measured. **This is enquiry question 1 and it is the most
   consequential open item in this application**, because if the answer is "actual" the source is
   recorded staff attendance and a service without per-person staff sign-in cannot answer at all.
3. **Three flags are conditional.** *Previously worked as teacher*, *arrived from another service*
   and *leaving teacher destination* are each marked *"(permanent staff only)"*. We collect all
   three unconditionally and do not enforce the condition.

**The honest summary of this table:** every cell has a source, **six of them cannot yet hold a
value** because the Ministry code lists they draw on are not in our hands, **one field is not held
at all** (in-role dates), and **two are held in a shape whose correctness depends on an answer we
do not have**. The service-level items — five age-banded wait times, and teaching languages with
usage percentages — are not modelled at all.

That is a longer list than the first draft of this answer gave, and it is longer because we read
the Handbook section rather than inferring the requirement from the XSD. Worth stating in an
application: we would rather hand the Ministry an accurate gap list than a short one.

**AST48 — ECE Return generation, transmission and storage.** `[GAP]`/`[BLOCKED — spec]`

**AST49 — editing or viewing a previously submitted ECE Return, and managing two sets of reference
data.** `[BLOCKED — spec]`, and worth noting that the Ministry's expectation names the hard part
itself: editing a prior return must not alter the current year, which means returns store their own
snapshot rather than re-deriving from staff profiles, and reference data must be resolved as at the
return's date. Our supersession model and the effective-dated reference tables of AST55 are the
right shapes for both; neither is built.

---

# RS7 Return Data

**AST50 — the RS7 data-source table.**

`[GAP]` **None of the return's parameters is currently produced.** What exists is per-child funded
hours over an operator-chosen period, with caps, an age band and completeness reporting. The return
wants **per-calendar-date counts** — subsidy-funded under two, subsidy-funded two and over, 20
Hours funded, 20 Hours plus ten, and staff hours split qualified and not qualified — plus forward
monthly counts of all-day, sessional and parent-led days, and a declaration including the pay
parity attestation code.

**The count, measured rather than recalled (2026-09-03).** This answer previously said *"thirteen
parameters"* while three other documents said *"eleven"*; neither was sourced. Against the schema at
`https://eli.minedu.govt.nz/eli.xsd`, `RS7Return` carries **six per-date counts**, **three
advance-month counts repeated over four months**, and **six declaration fields**
(`RegisteredTeachersSalariesAttestation`, `RegisteredTeachersParityAttestation`,
`RegisteredTeachersParityAttestationCode`, `SubmitterName`, `ContactNumber`, `Designation`), inside
an envelope of `RS7ReturnEntityId` and `PeriodStartDate`. So **nine distinct counts and six
declaration fields.** We are stating this correction rather than quietly amending the number,
because a figure quoted forward three times without being checked is the thing this application is
being assessed on our ability not to do.

**One further measurement, and it is a defect rather than a gap.** `RS7DayCount` is
`xs:restriction base="xs:int"` bounded `0`–`9999`: the daily figures are whole numbers, and Funding
Handbook §9-4 directs rounding to the **nearest** hour (68 hours 30 minutes → 69; 68 hours 29
minutes → 68). Our existing `toHours()` helper rounds **down**, always and deliberately, so that a
preparation figure never overstates what a service may claim. That is the right behaviour for the
current screen and the wrong behaviour for RS7, so the two cannot share a rounding helper. Recorded
before any RS7 code was written.

Three distinct blockers, worth separating because they are not the same size:

1. **A transposition.** Per-child-per-period to per-date-per-category. Our code already evaluates
   age bands as at a given day, both for the funding age band and for the live ratio split, so this
   is real work but not new thinking.
2. **The staff data does not exist.** The two staff-hour counts need a qualification column. Same
   blocker as AST47.
3. ~~**The service model does not exist.**~~ **Half built 2026-09-03 — `0083`.** All-day,
   sessional and parent-led day counts need a service type on `centres`, and `service_model` now
   holds exactly those three values, settable in Settings, so the RS7 advance counts have their
   axis. **What is still missing is not the column but the schedule**: the sessional ratio bands
   are deliberately not transcribed, so the product can record that a service is sessional and
   cannot assess it as one.

And one thing we will not do: the pay parity attestation codes are a legal statement by the service
about teacher salaries. We will build the mechanism to record and transmit the service's own
attestation; we will not derive or default it.

**What is worth saying alongside all of that**, because it is the reason to trust the arithmetic
when it is built: this product's funding calculation is deliberately conservative and states its
own limits. Every rounding decision floors. The daily cap is applied before the weekly one, because
the other order over-claims by making one day's excess transferable to another. A day whose record
is broken is **excluded and named, never estimated** — the dates are listed, not counted. A period
the records do not cover reports as *not covered* rather than as zero, in three states where null is
not false. The 20 Hours age band is evaluated as at each day, never as at today, because a child who
turned three in March was not entitled in February and using today's age would clear the whole
period in the service's favour. And the export discloses **under-claiming** — that it counts
attended hours only, and a permanently enrolled child's absences may be claimable under §§6-4 to
6-7, which we do not calculate.

**Superseded 2026-09-04, and the disclosure is now sharper rather than absent.** The export
disclaimer splits by what actually happened in the period: for a child funded from the agreement it
says the figures **include** the absences the Handbook allows under §§6-4 to 6-7, and the
attended-hours-only sentence is reserved for the children it is still true of — a casual child, or
a permanent one with no recorded booking schedule. It also now discloses the one thing that can run
**high**: §6-4 forbids claiming for both an absent permanent child and the casual or conditional
child who filled their place, and the product names those days and the hours without deducting
them, so a manager is told what to take off before keying the figures in.

That disclosure was written from reading Chapter 6, before the Ministry's 31 August reply used the
word "under-claiming" for the same thing. Our funding surfaces also state, unconditionally, that
use of this system does not remove the service's responsibility to comply and that a person must
review and validate the figures before submitting them.

**AST51 — RS7 generation, transmission and storage.** `[GAP]`/`[BLOCKED — spec]`. The period
boundaries are known and confirmed twice: the funding periods helper returns February–May,
June–September and October–January, and the public schema restricts the RS7 period start to the
pattern `[0-9]{4}-(02|06|10)-01`.

---

# Waha Rumaki/PITA Return Data

**AST52, AST53, AST54.** `[BLOCKED — spec]` and, before that, `[GAP]` — **nothing exists**, and
there is a prior question: the Ministry's page describes this return as teacher allowances for
"specific education & care service types", and our pilot service would never file it. Enquiry
question 7 asks whether it is in scope for every applicant or only for vendors serving those service
types. We would rather describe it accurately than plausibly.

One design point we can state, because the Ministry states it: resubmission must not affect the
prior submission, and a user cannot update an event — a new event with a new id is required. That is
the supersession contract our append-only ledgers already enforce.

---

# Approach — estimated durations

**INF05–INF09.** `[OWNER]`, and **not fillable until enquiry question 1 is answered.** These
estimates are the load-bearing commitment in the whole application: they are what the Ministry
plans a 12-to-18-month programme against.

Two things must be settled before a number goes in a box. First, whether the interface work
precedes or follows selection — the page says the SMS must already be developed to the
specifications and the template asks for development durations, and those cannot both mean what
they say. Second, the durations for the ECE Return, RS7 and Teacher Data components are dominated by
work that is **not** interface work at all: the staff and census surface, the service-type model,
and the sessional and home-based ratio tables. Estimating the interface without them would produce
a number that is wrong in the direction that matters.

**What we can say with a straight face:** our own roadmap estimates the staff surface at 15–20
engineering days, and we have delivered 79 migrations and a working multi-tenant product with a
607-assertion isolation suite over roughly a month of concentrated work. That is the basis on which
we would estimate, and we would rather give the Ministry a defensible estimate a fortnight late
than a comfortable one now.

---

# Additional Information

**Prerequisite document versions.** `[OWNER]` The versions named on the Ministry's page are NSI GINS
v6.19, ELI NSI GINS Appendix v1.41, ELI InfoHub v1.3, ELI Data Collection v11.0, ELI Events v10.0,
RS7 Return v6.0, Teacher Data Collection v1.1. **We must state the versions we actually worked
from, and today that is honestly "none of them"** — copies were received on 18 August 2026 and are
not available on the development machine. Enquiry question 5 requests fresh copies. This table
cannot be filled truthfully until they are in hand and read, and it is the table that tells the
Ministry whether we did the reading.

**AST56 — remote access for Ministry testing.**

`[GAP]` The Ministry expects easy remote access to a **test** environment, and there is no test
environment — see AST06. This is the second place that gap surfaces as a failed assessed item, and
it is the reason to close it first.

Once it exists: the console is a web application reachable over HTTPS with no VPN or client
software, so access is an invited account. Accounts are provisioned by invitation with the invited
email pinned, so Ministry testers would each hold their own credential rather than sharing one, and
a demo service with tagged, invented data already exists behind an explicit environment guard.

`[FIX FIRST]` One current limitation to fix regardless: the platform's authentication redirect URL
is a single project-wide value, so every service's invitation and reset links currently land on the
pilot service's hostname. That needs to be a hostname of our own before a second organisation — the
Ministry included — is invited.

**INF09 — what the Ministry would need to provide for access.** An email address per tester, and
whether they need owner, manager, educator or parent visibility. Nothing else.

---

## Before this is submitted

In dependency order, not importance order. The first two change assessed answers from *fail* to
*pass*; the rest change *candid* to *defensible*.

| # | Do | Changes |
|---|---|---|
| 1 | ~~**Send the enquiry.**~~ **Sent 2026-09-03.** The form requires it, and question 1 decides whether any of this is worth doing | Everything |
| 2 | **Build the Test environment** — second Supabase project, second service, seeded demo data. **Now also the fix for a CI defect found 2026-09-03**: the RLS-isolation and e2e jobs cannot run concurrently because they share the one project, so they are serialised as a workaround — see `AST18` | `AST06`, `AST08`, `AST09`, `AST56` |
| 3 | ~~Read and record the Supabase region~~ **Done 2026-09-02: Sydney, `ap-southeast-2`, now named in the privacy statement.** What remains is the *acceptance* half — the service acknowledging offshore storage in writing | `AST03`, `AST11` (IPP 12) |
| 4 | ~~**Get CI green**~~ **DEFERRED by the owner 2026-09-04, and demoted on the merits.** The bundle budget and the job serialisation are done (2026-09-03). What remains is putting credentials into GitHub Actions, which buys **evidence** and not capability: every gate already runs locally on every commit, so `AST18`/`AST19` are answered with a disclosure rather than a failure. Weighed against a `service_role` key readable by anyone who can push a branch, and an `e2e` job writing five `auth.users` accounts into production per push, the value is low and the risk is real. Revisit with a second contributor, a specific Ministry request, or an isolated project. See [ci-secrets-and-second-project.md](ci-secrets-and-second-project.md) | `AST18`, `AST19` |
| 5 | **Read and cite the platform's encryption-at-rest position** | `AST10` |
| 6 | **Write a support plan** — hours, channel, response targets, escalation, names | `AST23`, `INF04` |
| 7 | **Adopt an issue tracker** | `AST19` |
| 8 | Clear the six foreign accounts from the auth schema; rotate the service key and the migration token | `AST09`, `AST25` |
| 9 | Fix the retention runbook's argument-less function call; correct the assertion count in the privacy statement; add the console's viewport declaration; document a browser support matrix | `AST04`, `AST12`, `AST14`, `INF02` |
| 10 | Build the `source_system`/`source_ref` migration | `AST45` |
| 11 | Trademark- and domain-check the product name | Header |

**Items 2, 3, 4 and 6 are the ones that would embarrass us in an assessment**, and none of them is
more than a few days. Items 9 through 11 are each under a day and all of them are corrections to
things this repository already knows are wrong — which is the cheapest kind of work there is and
the kind that gets skipped.

*Drafted 2026-09-02 against template v4.0. Nothing here has been sent.*
