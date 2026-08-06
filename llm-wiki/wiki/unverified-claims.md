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
  `packages/core/src/ratios.ts`, and both the web ratio banner and the mobile ratio bar
  render a notice while it is. This is the highest-priority item in the repo.
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
| **What has never happened** | Any of it, on a phone or a tablet. No EAS build has ever been produced |
| **Specifically unverified** | The airplane-mode drill (three sign-ins offline, reconnect, exactly three events, no duplicates after a forced double flush); the sign-out refusal; whether the Supabase session is even large enough to take the chunked SecureStore path — if it never chunks, that code has never run either; `AppState` behaviour on `inactive → active` after the app switcher; keyboard behaviour on the sign-in form; and cold-start-to-roll-visible, which is a claim about a number nobody has measured |
| **Why it matters** | The offline outbox is the app's whole reason to exist, and `expo-sqlite` cannot execute in this repo's test runner. Two bugs were already found in that code path by reading it — a clock-drift misclassification and a cross-user attribution — which is a fair indication of what an unexercised path holds |
| **To close it** | `eas build --profile development`, a device, and the drill. Expect it to find something |

### 16. Store submission has three blockers that are not code

| | |
|---|---|
| **1. The hero screenshot disclaims the product** | `RATIO_TABLES_VERIFIED` is `false`, so any roll screenshot with children present carries "these ratio figures have not been checked against the regulations yet" — next to listing copy promising the app warns you before you pass the limit. Reading Schedule 2 is therefore a **submission prerequisite**, not a backlog item. Flipping the flag to clear the notice is the one thing that must not happen; see item 1 |
| **2. Apple requires a Support URL** | Nothing in this repo mentions one. It is a fourth hosted page alongside the privacy statement and the deletion-request route, and it is also where "there is no public sign-up, ask your centre" gets said to a reviewer |
| **3. A personal Play account cannot publish quickly** | An account created after November 2023 must run a closed test with 12 testers for 14 continuous days before production. If the account is personal, "a public listing now" has a two-week floor regardless of what the code does. Verify at the console — the rule has moved before |
| **Also** | Zero image files exist in the repo, `expo-splash-screen` is not a dependency, `eas.json` declares update channels while `expo-updates` is not installed, and `seed-demo` seeds no attendance so the demo roll is empty — a reviewer signing in would see what looks like a broken app |
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
paragraph that the name has not been trademark- or domain-checked. Nothing in this repo uses it
yet — the web app still says "ECE Platform" — so there is no exposure today, and that is exactly
why it is worth recording before a screen, a store listing or a manifest starts carrying it.

| | |
|---|---|
| **The claim** | "Doorway" is available to use as a product name in New Zealand |
| **What is actually verified** | Nothing. The handoff states the check has not been done |
| **To close it** | IPONZ trade mark search in the relevant classes, a companies-register check, and the domain. Before any store submission or marketing asset, not after |

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

## See Also

- [[attendance-and-ratios]] — where the ratio bands are used
- [[compliance-and-evidence]] — why criteria ship empty
- [[privacy-and-retention]] — retention, and the Privacy Act correction
- [[offline-outbox]] — what the drill covers and does not
- [[consent-gated-media]] — where consent decisions finally do work
- [[funding-and-billing]] — why nothing is estimated, and what cannot be submitted

*Last updated: 2026-08-05*
