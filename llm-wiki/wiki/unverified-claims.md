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
| **To close it** | An EAS build, a device, a token, and a worker. Then send one and watch it arrive |

The quiet-hours arithmetic *is* verified, including the case that is normally written wrongly — a
window that wraps midnight (20:00 → 07:00), evaluated in the centre's timezone across both sides of
the daylight-saving switch. That part is real; delivery is not.

Two design decisions were made on the assumption they are right and have not been tested against a
real device: that suppressing foreground banners is the correct behaviour, and that a `DEFAULT`
importance Android channel with no sound override is right for notices about a child's day. Both are
judgement calls about not training people to silence the app.

### 6. Warning lead times for expiring documents

`WARNING_DAYS` in `packages/core/src/compliance.ts` — 120 days for police vetting and
safety checks, 90 for practising certificates, 45 for first aid. These are **judgements
about how long renewal takes**, not claims about how long a certificate is valid, and the
schema deliberately holds no validity periods at all.

Lower stakes than the others: being early is harmless, and being late is visible. Worth
adjusting from experience rather than from a source.

### 7. Regulatory context inherited from another repo

The product plan in `salix/llm-wiki/wiki/possible-projects/ece-early-learning-app.md`
asserts that the licensing criteria were renumbered on 20 April 2026 and that ERO takes
over as regulator on 1 September 2026. Both were researched in that session and neither has
been re-checked here. The second has not happened yet as at 2026-08-04.

They matter because they are the timing argument for the whole product. **To close it:**
confirm both, and if the ERO transfer is real, note that the evidence binder's framing may
need to change with the regulator.

### 8. Things believed on one customer's word

Phase 1 built enrolment, which the product plan's Stage 0 advised against until ten
conversations with centres had happened. Those conversations did not happen; the work
proceeded on the strength of one pilot customer who is a personal contact and who is not
paying.

That is defensible for a free pilot and a weak basis for pricing. It is recorded here
because it is the same class of error as an unverified figure: a decision resting on
evidence nobody has gathered.

## See Also

- [[attendance-and-ratios]] — where the ratio bands are used
- [[compliance-and-evidence]] — why criteria ship empty
- [[privacy-and-retention]] — retention, and the Privacy Act correction
- [[offline-outbox]] — what the drill covers and does not
- [[consent-gated-media]] — where consent decisions finally do work

*Last updated: 2026-08-04*
