# Unverified claims

Everything this product asserts that nobody has checked, in one place.

## Overview

This is the most important page in the wiki, and it exists because of what the product is.
A compliance tool that is confidently wrong is worse than no tool: a manager who is told
they are within ratio stops counting. So every figure, duration and threshold that was
written from reasoning rather than from a source is listed here, with what it would take to
close it.

Two of these are wired into the product as machine-readable flags rather than only prose,
so the UI cannot present an unchecked number without saying it is unchecked. That is the
pattern to follow for anything added later: **if a claim cannot be sourced, make the
product say so, and put it on this page.**

Nothing here is a bug. They are known gaps with known closures.

## Key Points

- **The adult-to-child ratio bands are unverified.** `RATIO_TABLES_VERIFIED` is `false` in
  `packages/core/src/ratios.ts`, and the web ratio banner, the mobile ratio bar and the
  **roster forecast** all render a notice while it is. This is the highest-priority item in
  the repo, and the forecast raised its cost: a live banner is read by somebody already in
  the room, while a forecast is acted on a week early by *not* calling a reliever.
- **No licensing criteria are loaded, and none are seeded.** The criteria-gap feature
  cannot function until somebody imports a checked set. Deliberate — see
  [[compliance-and-evidence]].
- **The seven-year retention default is an assumption**, not a citation.
- **No airplane-mode drill has been run on a real device.** The contract the outbox relies
  on is tested; `expo-sqlite` is not.
- **Push notification delivery has never run once.** The data model and the quiet-hours logic
  are built and tested; delivery needs an EAS build on a real device.
- **The funding caps and period boundaries are unverified.** `FUNDING_RULES_VERIFIED` is `false`,
  and the funding export says so on every render. There are deliberately **no funding rates**
  anywhere in the product.
- **Two legal citations in the user-facing documents are unchecked.** The agent rule that
  makes the *centre* the responsible agency, and the section numbers and fine in the breach
  runbook. The substance of both is sound; the citations have not been read.
- **No screen reader has ever been used on this product.** axe passes on every page, which
  is a floor and not a pass.
- **The mobile workspace has no unit tests and no runner**, so `npm test` reports three green
  workspaces while covering none of the app that runs in the room. Item 20.
- **`drill:offline` has now run against live Postgres and passed 10/10 — item 21, closed
  2026-08-09.** Caught a real bug doing it: the drill's own centre lookup broke the moment
  this project held two centres with "albert" in the slug. What is still open is narrower:
  the `expo-sqlite` queue on a real device, which was always item 15's claim, not this one's.
- **The mobile app has never run on a device.** Not the airplane-mode drill, not the sign-out
  refusal, not the chunked session storage. Two bugs in that path were already found by reading it.
- **Three store-submission blockers are not code**: the ratio flag puts a disclaimer on the hero
  screenshot, Apple wants a Support URL that does not exist, and a personal Play account needs
  twelve testers for fourteen days.
- **No adversarial security testing of any kind.** Sixteen automated checks pass; nobody has
  attacked it. Auth rate limits and session policy are unread Supabase defaults, and the
  service-role key has never been rotated.
- **Four claims this repo made in writing were not true.** Two were about mechanisms the
  database did not enforce; one was about where a file lived. All four are listed in item 14,
  because a compliance product that overstates itself is the exact failure this page exists
  to prevent.
- Anything asserted about ERO taking over regulation, or the April 2026 criteria
  renumbering, came from an earlier research session in the `salix` repo and has not been
  re-checked here.
- **Neither switcher importer parses a real export.** `import-storypark.ts` and
  `import-discover.ts` define their own intake shapes rather than a sourced vendor format —
  this repo has never seen a real export from either product, and "Discover" is not even a
  specifically identified one. Items 31 and 32.
- **The five Te Whāriki strand names have not been diffed against a primary source, and
  `messages/mi.json` is entirely placeholder text.** The i18n infrastructure exists and is
  proven against one real page; no te reo Māori translation exists anywhere in the product.
  Items 33 and 34.

## Details

### 1. Ratio bands — highest priority

| | |
|---|---|
| **What is asserted** | Under-2: 1 adult per 5 children, stepped. 2-and-over: 1–6→1 adult, 7–20→2, 21–30→3, 31–40→4, 41–50→5, then 1 per 10 |
| **Where** | `packages/core/src/ratios.ts` — `UNDER_TWO_TABLE`, `TWO_AND_OVER_TABLE` |
| **Basis** | A good-faith reading of Schedule 2 of the Education (Early Childhood Services) Regulations 2008, from memory. **Not read against the regulation.** |
| **How the product behaves** | `assessRatio()` returns `verified: false`; the web banner and mobile bar show "not yet checked against the regulations"; the evidence binder footnotes it |
| **To close it** | Read Schedule 2. Correct the bands if wrong, then set `RATIO_TABLES_VERIFIED = true` in a commit that records who read what and when |
| **Risk if left** | A manager relies on "Within ratio" and is not. This is the failure the whole feature exists to prevent |

Two mitigations already in place. The maths is tested independently of the numbers — a
green suite means the bands are *applied* correctly, not that they are right, and the tests
say so. And the two age bands are computed separately and summed, which is the
conservative reading: if the combined figures turn out lower, the product is generous
rather than wrong.

**Do not flip the flag to remove the notice.** The notice is the only thing standing
between an unchecked number and a compliance decision.

### 2. Licensing criteria — absent, on purpose

The criteria run to several dozen numbered items and were renumbered in 2026. This repo
contains none of them, and `0012_compliance.sql` seeds nothing.

Inventing plausible criterion numbers would let a centre assemble an evidence binder
against a list that looks official and is not — a worse outcome than an empty feature. So
the dashboard states the gap and `npm run import:criteria` loads a set from a file that
must carry a `source`.

**To close it:** obtain the current criteria, write the JSON, import with `--make-current`.
Include `supersedesCode` per entry — the old-to-new mapping is what keeps evidence filed
under the previous numbering findable. This is content work, not code.

### 3. Retention period — seven years is a guess

`children_due_for_purge(p_retention_years integer default 7)` in
`supabase/migrations/0008_retention.sql`. The assumption is that funding-relevant records must
survive a Ministry funding audit and that the window is seven years from the date a child
leaves.

It is a **parameter rather than a constant** precisely so it can be corrected without a
migration. **To close it:** check the current ECE Funding Handbook and either confirm 7 or
change the default, recording the source in the migration comment.

See [[privacy-and-retention]] for the surrounding design, including a correction already
made to an earlier wrong claim about the Privacy Act.

### 4. Offline: no device drill

`npm run drill:offline` replays exactly what the outbox does — keys fixed up front, reused
on retry, a forced double flush — against the real database, and passes 10/10. What it does
**not** exercise is the `expo-sqlite` layer, which needs a tablet or a simulator.

**To close it:** put a device in airplane mode, sign three children in, restore the
connection, confirm exactly three events landed and the times survived. See
[[offline-outbox]].

### 5. Push notifications: built, never executed

| | |
|---|---|
| **What exists** | `push_tokens`, `notification_preferences` with quiet hours, a `notifications` queue, `apps/mobile/lib/push.ts`, and quiet-hours logic with 17 tests |
| **What has never happened** | A single notification being delivered to a device |
| **Why** | Expo push needs a token from a real build, and this project has not been through EAS. There is also no worker: nothing reads the queue and calls Expo's API |
| **To close it** | An EAS build, a device, a token, and a worker. Then send one and watch it arrive. `apps/mobile/eas.json` now exists with the profiles chosen and commented — it has never been executed, so it is configuration and not progress |

The quiet-hours arithmetic *is* verified, including the case that is normally written wrongly — a
window that wraps midnight (20:00 → 07:00), evaluated in the centre's timezone across both sides of
the daylight-saving switch. That part is real; delivery is not.

Two design decisions were made on the assumption they are right and have not been tested against a
real device: that suppressing foreground banners is the correct behaviour, and that a `DEFAULT`
importance Android channel with no sound override is right for notices about a child's day. Both are
judgement calls about not training people to silence the app.

### 6. Funding caps and period boundaries

| | |
|---|---|
| **What is asserted** | 20 Hours ECE capped at 6 hours per day and 20 per week |
| **Where** | `packages/core/src/funding.ts` — `DEFAULT_CAPS` |
| **Basis** | Commonly stated figures. **Not read against the ECE Funding Handbook.** |
| **How the product behaves** | `FUNDING_RULES_VERIFIED` is `false`; `summariseFunding` carries the flag; `exportDisclaimer` states it; the funding page repeats it in its own section |
| **To close it** | Read the current Funding Handbook, correct the caps if wrong, then flip the flag in a commit recording who read what |

**Funding periods are a parameter, not a constant.** The Ministry publishes period boundaries this
product does not know, so the export makes the operator choose the dates and says why — putting a
guessed date range on an official-looking figure would be worse than asking.

**There are no funding rates anywhere.** Not one dollar-per-child-hour. A rate is a number the
Ministry publishes and changes, and inventing one would let a centre budget against a figure this
product made up. Rates live in a fee schedule the centre enters, or nowhere.

Two mitigations that make the maths safe even while the caps are wrong: nothing is ever estimated
(a day whose record is incomplete is excluded and named, never guessed), and every rounding
decision goes **down**, so an error in the caps cannot combine with a rounding error to over-claim.

### 7. Warning lead times for expiring documents

`WARNING_DAYS` in `packages/core/src/compliance.ts` — 120 days for police vetting and
safety checks, 90 for practising certificates, 45 for first aid. These are **judgements
about how long renewal takes**, not claims about how long a certificate is valid, and the
schema deliberately holds no validity periods at all.

Lower stakes than the others: being early is harmless, and being late is visible. Worth
adjusting from experience rather than from a source.

### 8. Regulatory context inherited from another repo

The product plan in `salix/llm-wiki/wiki/possible-projects/ece-early-learning-app.md`
asserts that the licensing criteria were renumbered on 20 April 2026 and that ERO takes
over as regulator on 1 September 2026. Both were researched in that session and neither has
been re-checked here. The second has not happened yet as at 2026-08-04.

They matter because they are the timing argument for the whole product. **To close it:**
confirm both, and if the ERO transfer is real, note that the evidence binder's framing may
need to change with the regulator.

### 9. Things believed on one customer's word

Phase 1 built enrolment, which the product plan's Stage 0 advised against until ten
conversations with centres had happened. Those conversations did not happen; the work
proceeded on the strength of one pilot customer who is a personal contact and who is not
paying.

That is defensible for a free pilot and a weak basis for pricing. It is recorded here
because it is the same class of error as an unverified figure: a decision resting on
evidence nobody has gathered.

### 10. The agent rule, in the privacy statement

| | |
|---|---|
| **What is asserted** | Information held by Salix as agent for a centre is, in law, held by the centre — so the centre is the agency answerable to families and to the Commissioner |
| **Where** | `docs/privacy-statement.md`, and it underpins the whole structure of that document |
| **Basis** | Confident from general knowledge of the Privacy Act 2020. The **section number has not been read.** The equivalent in the 1993 Act was s 3(4) |
| **Why it matters** | It decides who notifies a family after a breach, and it is the paragraph the services agreement has to match. Getting the substance right and the citation wrong in a document a family reads is a credibility problem even when the conclusion holds |
| **To close it** | Read the Act, put the correct reference in, and make the services agreement say the same thing |

### 11. The breach runbook's legal specifics

| | |
|---|---|
| **What is asserted** | A serious-harm test; notification to the Privacy Commissioner *and* to affected individuals as soon as practicable; an offence with a fine for failing to notify |
| **Where** | `docs/breach-response.md` |
| **Basis** | Part 6 of the Privacy Act 2020. The **substance is not in doubt**; the exact sections and the exact maximum fine have not been checked |
| **How the document behaves** | Says so, in a block quote, at the top |
| **To close it** | Read Part 6. Correct the numbers, or remove them and keep the substance |

### 12. Accessibility: automation only

| | |
|---|---|
| **What exists** | A WCAG 2.2 AA audit with axe-core over 19 screens, both roles, with data loaded, including two error states. 30/30 green, no advisory warnings either |
| **What has never happened** | Anyone using this product with a screen reader, or completing a task with a keyboard alone |
| **Why it matters** | axe finds somewhere between a third and a half of WCAG failures. It is good at contrast, names, roles and structure. It cannot tell whether a focus order makes sense, whether an error message helps, or whether the ratio banner announces at a useful moment. A green run is a floor |
| **To close it** | A pass with NVDA or VoiceOver on the daily screens — sign a child in, read a ratio, open a child's allergies — and a keyboard-only pass on the enrolment form |

### 13. Security: sixteen automated checks are not an adversary

| | |
|---|---|
| **What exists** | `npm run review:security` — sixteen checks against the live schema, all clean. A 176-assertion RLS suite. A 44-check end-to-end suite covering four roles. No secret in any bundle, no XSS sink, every definer function pinned |
| **What has never happened** | Any adversarial testing at all. No penetration test, no external review, no attempt to enumerate storage objects or traverse an object path, no attempt to forge a JWT |
| **Also unread** | Supabase Auth's rate limits, session lifetime, refresh-token rotation and password policy are all defaults that nobody on this project has looked at. The service-role key has never been rotated. The personal access token the migration runner uses is account-wide, which is far more authority than this project needs |
| **Why it matters** | The checks verify the invariants somebody thought of. Four of the five findings in the Phase 6 review were things nobody had thought of, and each one was found by *running* something rather than by reasoning |
| **To close it** | Rotate the keys and scope the token. Read the auth settings. Then, before real child data: an external review, or at minimum a deliberate adversarial pass by somebody who did not write this |

### 14. The claims this repo made that were not true

Not a gap in the product — a gap in what the documentation asserted, which is worth its own
entry because it is the failure mode the whole honesty apparatus is supposed to prevent.

| Claim | Where | Reality |
|---|---|---|
| "An issued invoice freezes" | Phase 5 commit, README | The line policy required draft; nothing stopped the status going back to it. Fixed in `0021` |
| "An issued invoice freezes", **the second time** | README, [[funding-and-billing]], and this table's own first row | `invoice_lines_write` was `FOR ALL` with `status = 'draft'` in its WITH CHECK only — and PostgreSQL checks USING for DELETE. So a line could be **deleted** from an issued invoice for five phases. `0022` preserved the asymmetry faithfully when it split the policy by verb. Fixed in `0025`, with an assertion on the verb and a second on the class |
| "An issued invoice freezes", **the third statement of it** | README, [[funding-and-billing]] | See the row above. Two mechanisms were claimed and the third verb was open |
| "The outbox carries a `user_id` and every read is scoped to the signed-in user" | [[offline-outbox]] | True of mobile. The **web** outbox had no `userId` at all — on the app that runs on the tablet by the door. Fixed 2026-08-07 |
| "Sign-out uses `scope: 'local'` so it does not touch the person's phone" | [[offline-outbox]] | True of mobile. The web app called `signOut()` with no argument, and the default is global. Fixed 2026-08-07 |
| "Dead entries are named in the dialog and then let go" | `SignOutControl` | The dialog only opened when sign-out was refused, and a dead-only queue is allowed — so they were discarded with nothing shown. Fixed 2026-08-07 |
| "The recovery link stands in for the current password" | `reset-password/actions.ts`, [[password-recovery]] | Nothing checked that a link had been used. Any signed-in session could set a new password. Fixed 2026-08-07 |
| "A time input gives HH:MM anchored to the browser's clock" | `attendance/actions.ts` | The input is `datetime-local` and the code is a server action, so it parsed in the server's zone — UTC in production, putting every correction 12-13 hours out. Fixed 2026-08-07 |
| "The e2e suite has a test for exactly that (CSP violations)" | `docs/deploy-railway.md` | It tested a route that could not fail, while four prerendered routes had every script blocked. Fixed 2026-08-07 |
| "`apps/site` has no Supabase dependency, so there is nothing for a credential to be used by" | `deploy-railway.md`, `railway.site.json`, `api/health/route.ts`, `securityHeaders.ts` | False from the moment the careers form shipped, and it sat twenty lines below a table marking two Supabase variables required. Corrected 2026-08-07 |
| "All ten site routes pass axe at 390px and 1440px" | [[public-website]] | True when written, and a **one-off run** rather than anything repeatable — so it was a claim about a moment. Now `npm run audit:site`, and the site workspace has a test runner where it previously had none |
| The first two days of `audit:site` results | the runs themselves | Measured an **unstyled page** (`domcontentloaded`, and later a stale build served by an orphaned server), so every contrast check passed trivially and every link failed target-size. Neither the passes nor the failures meant anything. Fixed 2026-08-07, and the audit now refuses to report when the stylesheet is absent |
| "The audit trigger records every consequential change" | implied throughout | It covered ten tables while the schema had twenty-two. `staff_records` — the licensing evidence — was uncovered. Fixed in `0021` |
| "The pre-wipe backup sat in OneDrive and was therefore copied to Microsoft" | README, two wiki pages, and said aloud twice | Wrong. This repository is at `C:\dev\ece`, which is not synced; the OneDrive repository is a different one. The file never left local disk. Deleted 2026-08-04 |
| "Every other `FOR ALL` policy is narrower than its select policy" | Phase 4 commit | True when written, and it was a statement about fourteen hand-read expressions rather than about the design. `0022` removes the shape instead |

**The pattern:** each of these was a claim about a *mechanism* derived from reading the code
that implements it. The two that were false in substance were caught by asking the database;
the OneDrive one was caught by running `pwd`. None was caught by review.

**To close it:** nothing to build. The lesson is that a claim about what the product enforces
belongs next to a test that fails when it stops being true — which is now the case for the
first two, and is why `review:security` and `test:rls` both assert them.

### 15. The mobile app has never run on a device

| | |
|---|---|
| **What exists** | A sign-in screen, role-aware navigation, the roll, the whānau surface, and an outbox whose two most consequential decisions are pure functions in `@ece/core` with tests |
| **What has never happened** | Any of it, on a phone or a tablet. **UPDATED 2026-08-12: a build now exists** — an EAS production AAB, the first ever produced from this repo. The app has still never *run* anywhere, so everything below stands unchanged; an artefact is not an execution |
| **And the first artefact could not have run** | Inspecting that AAB found the variable *name* `EXPO_PUBLIC_SUPABASE_URL` in the bundle and neither value. `lib/supabase.ts` looked its config up with a computed `process.env[name]`, which Metro cannot see, so nothing was ever inlined and any built binary threw at module load before rendering. Correct in development, where a dev server populates `process.env` at runtime, and only there. Fixed; the point for this page is that **item 15 was understating it** — the app had not merely never run, it could not have |
| **Specifically unverified** | The airplane-mode drill (three sign-ins offline, reconnect, exactly three events, no duplicates after a forced double flush); the sign-out refusal; whether the Supabase session is even large enough to take the chunked SecureStore path — if it never chunks, that code has never run either; `AppState` behaviour on `inactive → active` after the app switcher; keyboard behaviour on the sign-in form; and cold-start-to-roll-visible, which is a claim about a number nobody has measured |
| **Why it matters** | The offline outbox is the app's whole reason to exist, and `expo-sqlite` cannot execute in this repo's test runner. Two bugs were already found in that code path by reading it — a clock-drift misclassification and a cross-user attribution — which is a fair indication of what an unexercised path holds |
| **To close it** | `eas build --profile development`, a device, and the drill. Expect it to find something |

### 16. Store submission has three blockers that are not code

| | |
|---|---|
| **1. The hero screenshot disclaims the product** | `RATIO_TABLES_VERIFIED` is `false`, so any roll screenshot with children present carries "these ratio figures have not been checked against the regulations yet" — next to listing copy promising the app warns you before you pass the limit. Reading Schedule 2 is therefore a **submission prerequisite**, not a backlog item. Flipping the flag to clear the notice is the one thing that must not happen; see item 1 |
| **2. Apple requires a Support URL** | Nothing in this repo mentions one. It is a fourth hosted page alongside the privacy statement and the deletion-request route, and it is also where "there is no public sign-up, ask your centre" gets said to a reviewer |
| **3. A personal Play account cannot publish quickly** | An account created after November 2023 must run a closed test with 12 testers for 14 continuous days before production. If the account is personal, "a public listing now" has a two-week floor regardless of what the code does. Verify at the console — the rule has moved before |
| **Also** | ~~Zero image files exist in the repo~~ — **fixed 2026-08-12**: `icon`, `adaptive-icon` and `notification-icon` are generated from `MARK` by `npm run icons:mobile`. `expo-splash-screen` is still not a dependency, `eas.json` still declares update channels while `expo-updates` is not installed (EAS warns on every build), and `seed-demo` seeds no attendance so the demo roll is empty — a reviewer signing in would see what looks like a broken app |
| **And a fourth, found by trying** | **`eas.json` had never been valid.** It carried this repo's house-style `"//"` comment arrays, and EAS validates its schema strictly: `"//" is not allowed`, on every profile. Railway tolerates unknown keys and had trained the habit. So the file the wiki called "configuration and not progress" was configuration **no EAS command could read** — `eas init` refused before it did anything. The reasoning moved to `docs/store-listing.md`; the file is now plain JSON |
| **To close it** | Read Schedule 2; host four pages; decide the account type knowingly; generate the assets; extend the demo seed to produce a deliberate at-limit ratio |

### 17. Deleting an account would erase attribution in licensing evidence

Not a claim that is wrong — a consequence nobody had noticed, found while designing the account
deletion Apple asks for.

| | |
|---|---|
| **The mechanism** | `audit_events.actor_id`, `attendance_events.recorded_by` and `staff_records.sighted_by` are all `on delete set null` against `auth.users` |
| **So** | Deleting a person's account anonymises every action they ever took: who signed a child in, who sighted a police vetting, who changed a health record. Silently, and in tables with no UPDATE grant, so it cannot be repaired |
| **Why it matters** | That attribution *is* the licensing evidence this product exists to produce. An account deletion feature built the obvious way would quietly destroy it |
| **To close it** | A tombstone table holding the person's display name — not their email — outside the FK, so attribution survives a deletion. Plus a guard refusing to close the account of the only remaining owner of a centre, because creating a membership needs the service role and a self-service feature would otherwise brick a tenant |

### 18. Password reset emails have never been sent

The forgot-password flow (see [[password-recovery]]) calls Supabase's `resetPasswordForEmail`,
which sends through the project's mailer. No custom SMTP is configured, so that is Supabase's
built-in service — rate-limited to a handful of messages an hour and described by Supabase as
not for production. Nobody has requested a reset against the live project and received the
email.

| | |
|---|---|
| **The claim** | A user who taps "Send reset link" gets an email |
| **What is actually verified** | Everything after the email. Drilled on 2026-08-05 against live Postgres with a disposable account: a recovery token establishes a session at `/auth/confirm`, `/reset-password` refuses a short password and a mismatched confirmation, sets the new one, the new password signs in, the old one does not, and the link cannot be replayed. That the emailed link carries `?code=` rather than a fragment was confirmed from the installed SDK source, not the docs |
| **Still unverified** | That the mailer sends anything at all, and that the message arrives |
| **To close it** | Request a reset for a real account on the live project; check the mailbox and the auth logs. Before real centres depend on it, configure custom SMTP and verify again |

### 19. The product name has not been cleared

The design handoff gives the product a working name, **Doorway**, and says in its own first
paragraph that the name has not been trademark- or domain-checked.

**CORRECTED 2026-08-07 — this entry used to say there was no exposure.** It read: "Nothing in this
repo uses it yet — the web app still says 'ECE Platform' — so there is no exposure today, and that
is exactly why it is worth recording before a screen, a store listing or a manifest starts carrying
it." That is no longer true, and the thing it warned about has happened rather than been prevented.

The public website now carries the name **and the mark** in the masthead of all ten routes — "Sign
in to Doorway", plus two mentions in body copy on `/enrolment` and `/contact`. That is not an
internal screen behind a login. It is a real childcare service's public marketing site, at their own
domain, in front of anybody who visits, and it went up before the IPONZ search was run. See
[[public-website]] for why the link was promoted.

The risk is small and it is not nil, and it is now asymmetric in a way it was not before: if the
name has to change, it changes on a customer's live site rather than in a repo.

**UPDATED 2026-08-11 — one of the three checks is now done, and the name was adopted on that
basis.** The owner confirmed `doorway.co.nz` is available and instructed the product to take the
name. **That premise was false — see the correction below.** It now appears in the console's
`<title>`, its favicon and home-screen icon, the rail above every screen, and the mobile app's
display name — where before it was only on the public website.

**A domain being free is not a trade mark search.** Availability at the registrar says nothing
about whether somebody holds a registered mark for "Doorway" in a class covering software or
education services, and it is the mark, not the domain, that can force a rename. The two
remaining checks are unchanged and are now behind more exposure than when they were first
recorded.

**A TRADE MARK CHECK WAS RUN, 2026-08-11 — and it is good news that is not a clearance.**

The owner ran IPONZ's free *Trade Mark Check* on the word **doorway**, with **no goods or
services class selected**. It returned 25 marks, ordered closest-matches-first, and the result
that matters is a negative: **no identical `DOORWAY` word mark appeared.** The top of a
closest-first list was `STAPLES RODWAY`, which is the matcher saying it found nothing nearer —
an exact mark would have sorted first. The near neighbours are phonetic and visual:
`DOO-AWAY / DOO AWAY / DOOAWAY` (Jassal Limited), `Deerway` (Quanzhou Newbarlun Sports Goods),
`QUAI D'ORSAY`, and four unrelated `NORWAY` marks.

That materially lowers the risk. It does not close the item, for three reasons that are on the
tool's own page rather than invented here:

1. **No class was selected**, and co-existence is decided on classes. IPONZ's own next step on
   that screen is "Select a goods or service class", and its wording is that a mark "might be
   able to co-exist if it's for different goods or services". The question this product actually
   needs asked — *can it co-exist in software and education services* — has not been asked. The
   classes worth checking are **9** (downloadable software), **42** (software as a service),
   **41** (education services) and possibly **35** (business administration).
2. **Only the first 8 of 25 results were seen.** The ordering makes an exact match below them
   very unlikely; "very unlikely" is not the same claim as "checked".
3. **This is the free pre-application check**, which offers a paid IPONZ search as its own next
   step. It is a screen, not an opinion.

**CORRECTED 2026-08-11, later the same day — `doorway.co.nz` is *not* available, and the one
check this entry recorded as done was the one that was wrong.**

A registrar's search page returned `doorway.co.nz is unavailable`. The .nz registry agrees, and
says considerably more than the registrar's page did. From `whois.srs.net.nz`, queried directly:

```
Domain Name:      doorway.co.nz
Registrar:        1st Domains Limited
Creation Date:    2024-07-04     Original Created: 2006-06-02
Updated Date:     2026-07-04
Domain Status:    pendingDelete, redemptionPeriod, serverHold,
                  serverRenewProhibited, serverUpdateProhibited
Name Server:      ns1.afternic.com, ns2.afternic.com
```

Three things follow, and they do not all point the same way.

1. **It is registered today, so the check recorded above as verified was not.** How the earlier
   "available" reading was obtained is not known; it is not what the registry says.
2. **It is in the drop cycle, not in use.** `redemptionPeriod` and `pendingDelete` are the states
   a lapsed name passes through, `serverHold` means it is delegated nowhere, and the Updated Date
   of 2026-07-04 is when it lapsed. .nz holds an expired name for a pending-release period before
   it is released first-come-first-served — **90 days is the figure to check, not one this repo
   has confirmed**, which would put release in the first days of October 2026. Verify with a
   registrar or the Domain Name Commission before anyone plans around it.
3. **The holder is not a business called Doorway, so this does not raise the trade mark risk.**
   The nameservers are Afternic — GoDaddy's aftermarket. The name was listed for sale, did not
   sell, and was not renewed. `Original Created: 2006-06-02` against `Creation Date: 2024-07-04`
   says it has already dropped once and been caught by a reseller. A parked domain is evidence
   of a speculator, not of a competing user of the word.

**`doorway.nz` is registered and is not a business.** Registered 2020-11-17 through Webcentral
(AU), on Cloudflare nameservers, locked `clientDelete/Transfer/UpdateProhibited`. An earlier
draft of this paragraph said "somebody is using it" and called it the thing worth looking into,
on the reasoning that a locked domain on real nameservers is closer to a trading name than a
parking page. **That inference was wrong, and fetching the site is what settled it.** `https://doorway.nz`
returns 384 bytes: a `<frameset>` pointing at `jsp.netregistry.net/theBizCard.jsp`, with an empty
`<title>` and empty keywords and description. That is Netregistry's default placeholder. MX is
`mx2/mx3.partnerconsole.net`, the same registrar's default mail. Six years registered, nothing
built.

So **no identical name is in commercial use in New Zealand on either domain** — one is a
speculator's lapsed inventory, the other is a registrar's default page. That is not a trade mark
clearance and does not substitute for the class search below; a registered mark need not own a
website. But the specific worry that somebody is already trading as Doorway is answered: no.

**`doorwayy.co.nz` was reported unavailable and the registry says otherwise** — `Not found`, i.e.
unregistered. Recorded because the disagreement is the point. A registrar's search page was
consulted three times on 2026-08-11 and disagreed with the registry twice: it called
`doorwayy.co.nz` taken when it is free, and `doorway.nz` free when it has been registered since
2020 and answers HTTP 200. **Ask the registry, or the Domain Name Commission's own lookup — not a
seller's search box.** For `doorway.nz` the registry record, an SOA, live A records at Cloudflare
and a 200 response are four independent signals and they agree; a registrar showing "available"
against that is either a second-level-`.nz` parsing bug or a brokerage listing, which is a
different claim wearing the same word.

Also `Not found` at 2026-08-11: `doorway.net.nz`, `doorway.org.nz`, `doorway.kiwi.nz`, and
`getdoorway` / `usedoorway` / `doorwayapp` / `doorwayece` / `trydoorway` / `doorwayhq` `.co.nz`.
Listed as fact, not as a recommendation — none has been checked against anything but the registry.

| | |
|---|---|
| **The claim** | "Doorway" is available to use as a product name in New Zealand |
| **What is actually verified** | An **unfiltered** IPONZ Trade Mark Check returning no identical word mark in the closest 8 of 25 results. **The domain is no longer part of this row**: `doorway.co.nz` is registered and lapsing, `doorway.nz` is registered and live |
| **Still unverified** | Co-existence in the classes this product sits in, the 17 results not viewed, the companies register, and **when `doorway.co.nz` is actually released** |
| **Exposure** | Public since 2026-08-07 on `apps/site`; since 2026-08-11 also the console's title, favicon, apple-icon and rail, and the mobile app's name |
| **To close it** | Re-run the same check with classes 9, 42 and 41 selected — it is the same free tool and takes a minute — and a companies-register search at the Companies Office. Look at what is served at `doorway.nz`. Consider the paid IPONZ search before the name goes on anything print or a store listing |
| **If it has to change** | One edit. `PRODUCT_NAME` in `packages/core/src/brand.ts` is the only place the word is written for the console, the icons and the site masthead — that consolidation was done at the same time as the adoption, and it is the reason a rename is cheap rather than a hunt. Two body-copy sentences on `apps/site` still spell it out, deliberately: they are prose about the product, not a label |

### 20. The mobile workspace has no unit tests, and the checklist does not say so

Found while building the roll's offline strip on 2026-08-06. `npm test` runs
`--workspaces --if-present`, and `apps/mobile` has no `test` script — so the entire mobile
surface has **zero unit tests**, while the command reports three green workspaces and looks
complete.

That is not the same as untested: `typecheck` covers it, Metro bundles it in CI, and the
outbox contract it depends on is tested in `@ece/core`. But every string, every derived
label and every branch of a component in that app is unasserted, and the offline strip's
wording is a good example of something that matters — an educator reads that line to decide
whether to trust the ratio above it.

| | |
|---|---|
| **The claim** | "189 unit tests pass" implies the product is covered |
| **What is actually true** | Those tests cover `@ece/core`, `@ece/api` and `@ece/web`. Mobile has none, and no runner to add them to |
| **To close it** | Add vitest to `apps/mobile` with the same config shape the other workspaces use, and start with the pure functions — the strip's sentence, the roll's ordering, the ratio labels. Component rendering needs `@testing-library/react-native`, which is a bigger decision |

### 21. `drill:offline` — now run. **CLOSED 2026-08-09**, one narrower gap left behind it

Added 2026-08-06 with the web offline path; it had not run because it needs
`ECE_DRILL_PASSWORD`, the demo centre owner's password, which was not available in the
session that built the feature.

| | |
|---|---|
| **What ran, and passed** | `ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=… npm run drill:offline` — 10/10, against live Postgres, through the same `recordAttendance` the web outbox calls: offline queue counts and marks pending correctly, first flush lands exactly three events, a forced second flush with the same keys recognises all three as duplicates rather than writing more, a corrected time survives the outage, a second device sees the same server state, and a 20-day-old event is refused with the code the outbox treats as permanent |
| **A real defect found running it** | `offline-drill.ts` matched its demo centre with `.like('slug', '%albert%').single()`, which was exact until this project also came to hold a real `little-pearls-mt-albert` tenant. `.single()` then fails on two rows, not zero, and the die() message pointed at the wrong fix ("run onboard") for a database that already had the centre. Fixed to an exact match on `demo-mt-albert`, which is also the safer predicate on its own terms — a fuzzy slug match is one future centre name away from this drill writing invented events into a real tenant |
| **What this still does not cover** | The `expo-sqlite` queue itself, on a real device — see item 15, which was always the separate, larger claim. This entry was only ever about the web outbox reaching live Postgres, and that part is now a run, not an argument |

Related and separate, still open: **work made offline on the web survives only while the tab
stays open.** The queue is in `localStorage` and persists, but the app is server-rendered with
no service worker, so a reload with no connection gives the browser's error page. Mobile is a
binary and does survive a restart. See [[offline-outbox]].

### 22. Whether a dose must be witnessed by a second person

Added 2026-08-07 with `medication_administrations` (0032). Many services require two staff to
sign for a medicine. Whether that is a **licensing requirement** or a widely-adopted good
practice has not been read out of the criteria — which is the same position this repo takes on
every other criterion, because [[compliance-and-evidence]] ships `criteria` empty rather than
inventing numbers.

| | |
|---|---|
| **What is asserted** | Nothing. `centres.medication_requires_witness` defaults to **false** |
| **Why that direction** | Defaulting to true would encode a regulation nobody here has sourced, and a centre that hit the refusal would reasonably conclude the law requires it. Defaulting to false asserts nothing and still makes the control real the moment a centre turns it on — the trigger refuses an unwitnessed dose, and the suite asserts it in both positions |
| **To close it** | Read the licensing criteria on medicine administration. If it is required, the default changes and the change belongs in a commit that records who read what — the `RATIO_TABLES_VERIFIED` rule |

The window check beside it is **not** in this category and is enforced unconditionally: that a
dose must fall inside the period a guardian authorised is not a regulatory reading, it is what
the authority record already says. See [[medication-administration]].

### 23. How often a sleeping child must be checked

Added 2026-08-07 with `sleep_checks` (0033). Five and ten minutes are both commonly quoted;
neither is sourced here.

Unlike every other item on this page, **the product makes no claim to flag**.
`centres.sleep_check_minutes` is nullable and null means not configured, so there is no default
to be wrong about. The screen shows elapsed time — a fact — and only computes "overdue" against
an interval the centre itself stated, attributed to them.

| | |
|---|---|
| **The gap this leaves** | The product cannot tell a centre whether their interval is adequate, and will not try. A binder can show *that* checks were made and how far apart; it cannot show they were frequent enough |
| **Why not a default** | A centre seeing ten minutes enforced would reasonably conclude ten is the rule. If it is five, the product has talked them into a breach behind a green screen |
| **To close it** | Read the licensing criteria on sleeping children. It changes the guidance the UI can offer, not the schema |

The suite asserts the absence directly, so a default cannot be introduced without a test failing
and somebody justifying it. See [[sleep-checks]].

### 24. How often an emergency drill must be held

Added 2026-08-08 with `drills` (0034). Every three months is the figure commonly quoted; it is
not sourced here.

Same shape as item 23, and the same refusal: `centres.drill_interval_days` is nullable, null
means the centre has not stated one, and the product shows how long it has been without calling
it late. The suite asserts the absence, so a default cannot be introduced without somebody
justifying it.

**To close it:** read the licensing criteria on emergency procedures. It changes the guidance
the UI can offer, not the schema. See [[centre-registers]].

### 25. The kiosk cannot enforce a parenting order

Added 2026-08-08 with `guardian_pins` (0044). Not a gap in research — a limit of what the schema
can represent, recorded because it will otherwise be assumed away.

`custody_arrangements` holds free text written for a person to read: *"collection by the father
is not permitted without written agreement."* There is no machine-readable form of it, and
inventing one would mean parsing a legal document into a boolean, which is the kind of confident
wrongness this product exists to avoid.

What the door tablet enforces is `child_guardians.can_collect`, and 0044 is the first thing in
the repo to enforce it at all — before that it was data staff read and applied with judgement.
**The consequence is the entry:** a centre that has left `can_collect` at its default for a
guardian who must not collect has a kiosk that will let them take the child. A staffed door had a
person in the way; this does not.

**To close it:** nothing in code. It is a deployment obligation — a centre turning the kiosk on
must review the collection list first — and it belongs in whatever onboarding material exists
before a tablet is put in an entrance. See [[kiosk-and-pins]].

### 26. Five attempts, then fifteen minutes

Added 2026-08-08. The PIN lockout numbers in `kiosk_sign_child` are a judgement, not a citation,
and there is no standard here to be right about.

The reasoning, such as it is: a parent mistyping at a door with a queue behind them needs room to
try again, and 10,000 candidates at five attempts per fifteen minutes is over a week of
uninterrupted tapping in a staffed entrance. Both halves are guesses in what seems the safe
direction.

**To close it:** watch a centre use it. If parents lock themselves out routinely the number is
wrong in the direction that matters, because the fix a centre reaches for is turning the feature
off. Changing either figure is a one-line change in 0044's function.

### 27. Nothing has ever been sent to Anthropic's API

Added 2026-08-09 with 0047. **Updated the same day with `packages/ai`:** the earlier wording said
"the call does not [exist]", which has stopped being true. The calling code now exists. It has
still never run — there is no `ANTHROPIC_API_KEY` in this environment and the `ant` CLI is not
installed, so the live path is untested *by construction*, and code that looks finished is a
better reason to keep this entry than an absence was.

What *is* tested: `redactForModel` refuses every shape it is meant to refuse, mutation-tested four
ways; the flag defaults false, mutation-tested by setting the column default to `true` and
confirming the suite fails; and six tests in `packages/ai` drive an injected `ModelClient` fake
across the refusal branch, the empty-content branch, the network-error branch and the shape of the
request body — including that no `budget_tokens` appears anywhere in it, since Opus 5 rejects that
with a 400 rather than ignoring it.

What is **not** tested, and cannot be from here: that the API accepts that body at all; that the
usage numbers come back in the fields the code reads; and that the instruction's prohibition on
claiming compliance or breach is actually obeyed. **Nobody has read a generated narrative, because
none has been generated.**

**To close it:** put a key in `.env.local`, run the drill, and record what the outgoing body
actually contained and what came back. Until then this is a boundary, a caller and a cap, with
nothing on the far side.

### 28. Generated prose is a draft, and the product must never treat it as a finding

Added 2026-08-09. Standing rather than closeable — the entry exists so nobody quietly promotes it.

Anything a model writes is a draft for a person to check. It is not evidence, not a compliance
finding, and must not reach the binder without a human having read and accepted it. The arithmetic
that decides *whether* something is a breach stays in `assessRatio`, `overdueChecks` and
`summariseArrears`; a model may only phrase an explanation of a decision already made. See
`docs/claude-api-plan.md` §2 for why the reverse — an LLM deciding when to alert — is refused.

**To close it:** it does not close. If a future change makes generated text load-bearing anywhere,
that change is wrong.

### 29. The model price list is a number typed from a web page, not from an invoice

Added 2026-08-09 with `packages/core/src/modelSpend.ts`. `OPUS_5_PRICING` says US$5 per million
input tokens and US$25 per million output. **Nobody here has reconciled that against a bill**, and
it will be wrong the day Anthropic changes it — silently, because nothing fetches it.

Two things follow, and both are already done rather than promised. Everything derived from it is
named an *estimate*: the column is `cents_estimate`, not `cost_cents`, so a reader who reconciles it
against a statement and finds a difference does not conclude the difference means something. And
`estimateCents` takes the price list as an argument, so a correction is data rather than a code
change.

The exposure is bounded by design: this figure only feeds a NZ$20 monthly cap whose purpose is to
catch a runaway loop. If the price list is wrong by a factor of two, the cap is wrong by a factor of
two, and the worst case is NZ$40 of model spend at a centre that asked for NZ$20. It is not
load-bearing on anything a centre is billed for.

**To close it:** make one real call with a key, read the actual usage from the response and the
actual charge from the console, and compare. That is the same drill as §27 and closes with it.

### 30. Xero's full column list came from a third-party mirror, and no import has been run

Added 2026-08-09 with `/billing/xero.csv`.

What **is** sourced, from Xero Central itself: only `ContactName` and `InvoiceNumber` are required;
one row per invoice line with rows grouped by a shared `InvoiceNumber`; `DD/MM/YYYY` dates; amounts
either tax-inclusive or tax-exclusive but never mixed in one file; other fields may be left blank
and completed in Xero afterwards; and *"don't delete any columns or change any column headings."*

What is **not**: the exact names and order of the other columns in `XERO_COLUMNS`. Those came from a
third-party knowledge base mirroring the template, not from a template downloaded from Xero, and
**nobody has run a real import**. The last sourced instruction is what makes this matter — a wrong
column set is a rejected file.

The exposure is bounded, and deliberately so. A wrong column set makes Xero **refuse the import and
say why**, which is loud and costs a bookkeeper ten minutes. The failure that would matter is a file
Xero *accepts* and gets wrong, and the two decisions guarding against it are that `AccountCode` and
`TaxType` are left blank rather than guessed, and that no derived total is emitted for Xero to
disagree with. Both are asserted in `xero.test.ts` rather than left as absences.

**To close it:** download the sales-invoice template from a real Xero organisation, diff its header
row against `XERO_COLUMNS`, and import one file. Until then the column set is a best effort and the
two guards above are what make it safe to be wrong.

### 31. Storypark's export format has not been sourced at all

Added 2026-08-09 with `scripts/import-storypark.ts`.

Weaker footing than item 30's Xero entry, which at least confirmed the required fields against
Xero Central. This repo has never seen a real Storypark export and has not read documentation of
its column layout, so the importer does not attempt to parse one. It defines its own intake JSON
instead — documented in the script's header, the same move `import-criteria.ts` makes for the
Ministry's published criteria — and requires a person to map the real export into that shape by
hand, with `source` recording what the export was and when. Text only: a `photos`/`media`/`images`
key anywhere in the file is a hard refusal, because a photograph in this product cannot exist
without a recorded consent decision and an imported one would have none.

**To close it:** get a real Storypark export from a centre using it. Either write a small
conversion script from its actual columns into this importer's JSON shape, or confirm by hand that
the manual-mapping workflow is an acceptable permanent design rather than a stopgap.

### 32. "Discover" is not a specifically identified or sourced childcare product

Added 2026-08-09 with `scripts/import-discover.ts`.

`docs/roadmap-phases-8-13.md` names this script with no further specification of which product it
means or what it exports. Rather than guess at a format for an unidentified product, the importer
targets `waitlist` (0018) with its own documented intake shape — the same non-parsing design as
item 31 — and imports prospective families, never enrolled children. Promotion to a real child
record stays a human decision, the same argument 0052 makes about the public enquiry form.

**Nothing in this product has a screen that reads `waitlist`.** `grep` for `.from('waitlist')`
outside its own migration returns nothing — see [[reporting]]. Importing real personal
information (names, contact details, a child's date of birth) into a table nobody at the centre
can view is a privacy cost with no offsetting use.

**To close it:** confirm which product "Discover" actually refers to, if a specific one was
meant, and source its real export format before writing a conversion script. Build a `/waitlist`
page before running this importer against a real family's data — collecting it before anyone can
act on it is the wrong order.

### 33. The five Te Whāriki strand names have not been diffed against a primary source

Added 2026-08-10 with `curriculum_strands` (0058).

Unlike the licensing criteria `criteria` refuses to seed at all, the five strand names —
Wellbeing/Mana Atua, Belonging/Mana Whenua, Contribution/Mana Tangata,
Communication/Mana Reo, Exploration/Mana Aotūroa — are common, consistently repeated
knowledge in this field, not a figure subject to the kind of periodic renumbering that made
`criteria` refuse to guess. They were seeded from that consistent knowledge, not transcribed
from a PDF or physical copy of *He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa* (Ministry
of Education, 2017) held open beside the migration.

**Why this is worth a page of its own rather than a shrug.** This repo has already paid for
exactly this class of mistake once: `apps/site/src/app/layout.tsx` records Fraunces
rendering `Māori` as `Maōri` — a macron over the wrong letter, caught only by someone
looking at the rendered page rather than trusting the font. A macron error in
`curriculum_strands.name_reo` would be quieter and worse: it would sit in a database column
labelled "source: Te Whāriki, 2017" and print on a compliance document a reviewer might
actually check the te reo against.

No goals or learning outcomes are stored at all — see 0058's header for why that line was
drawn where it was; this item is only about the five names themselves.

**To close it:** open a verified digital or physical copy of *He Whāriki Mātauranga mō ngā
Mokopuna o Aotearoa* and diff `curriculum_strands.name_reo` against it character by
character, macrons included, before this table is relied on for anything printed and shown
to a reviewer.

### 34. `messages/mi.json` contains no real te reo Māori — every string is a placeholder

Added 2026-08-10 with the i18n infrastructure. See [[i18n]].

Every value in `apps/web/messages/mi.json` is the English string with a literal `[mi] `
prefix — `"[mi] Your account"`, not a translation. This is deliberate and the prefix is the
whole safeguard: the roadmap scoped the te reo Māori interface as "mechanical work touching
every component… a week of tedium," and generating real translations at that scale without
a way to verify them is exactly the kind of unchecked assertion this page exists to refuse.
What was built instead is the plumbing — the cookie, the message-file loading, the
Server/Client Component split — proven against one real page (`/account`) rather than
guessed at translated content across the whole app.

**The risk this item exists to name:** if the `[mi] ` prefix is ever stripped from
`mi.json` without the values behind it becoming real translations, the product would present
placeholder text as though it were te reo Māori — worse than the infrastructure not existing
at all, because it looks finished. Nothing enforces the prefix's presence; this page and the
one comment in `LocaleSwitcher.tsx` are the only things saying not to.

**To close it:** a fluent te reo Māori speaker translates `messages/en.json` into
`messages/mi.json` for real, for every page — starting from `/account`, the only page
currently wired to read either file, and continuing through the rest of the app the same
way `daily-registers.md` became three narrower pages rather than one: page by page, checked
each time rather than assumed.

### 35. Whether professional indemnity insurance is in place — the overview no longer says

Added 2026-08-11, when the overview card asserting the opposite was corrected.

Until then, `/` told every owner on sign-in: *"Nothing holds child data yet. Enrolment,
attendance and daily records are **not built**. Under-5 records are among the most sensitive
personal information in New Zealand, and nothing here should hold them before a written
services agreement and professional indemnity insurance are in place."*

The first half had been false for several phases — this product holds names, dates of birth,
allergies, medication doses, custody arrangements and attendance records, and had done for a
long time. A placard left over from before a product did its job is worse than no placard,
because the one screen everybody lands on was telling them the product does less than it
does. It was rewritten to say what is actually held, in AGENTS.md §1's own wording.

**The clause that went with it is what this item is about.** The old sentence made two
claims at once: that a written services agreement should be in place, and that professional
indemnity insurance should be. AGENTS.md §1 says an agreement exists. Nothing in this repo
says anything about insurance, one way or the other.

So the product now asserts **neither**, and that is the honest position rather than a
comfortable one. What it must not do is quietly assume the answer is yes because the sentence
warning about it was deleted — which is precisely why removing a caution is recorded here
instead of disappearing into a diff.

**To close it:** the owner confirms whether professional indemnity cover is held for this
service. If it is not, that is a business decision about a live product holding under-5
records and belongs somewhere more prominent than a card on the overview — not a sentence
nobody reads on the screen they skip past.

## See Also

- [[kiosk-and-pins]] — the door tablet, and what it can and cannot know
- [[attendance-and-ratios]] — where the ratio bands are used
- [[compliance-and-evidence]] — why criteria ship empty
- [[privacy-and-retention]] — retention, and the Privacy Act correction
- [[offline-outbox]] — what the drill covers and does not
- [[consent-gated-media]] — where consent decisions finally do work
- [[funding-and-billing]] — why nothing is estimated, and what cannot be submitted
- [[reporting]] — occupancy, attendance trends, and enquiry conversion

*Last updated: 2026-08-09*
