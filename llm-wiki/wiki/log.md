# Change log

*Append-only record of all wiki changes. Correcting an earlier entry means a new entry that
says so.*

---

2026-08-06 — Screen 13, the wall display, at `/attendance?wall=1` — a query parameter rather
than a route, since it is the same screen at a different reading distance. The sizes are
arithmetic and worth recording because they look arbitrary: the pack sizes the status line to
subtend the same angle at 3m as 15px does at 40cm, so 3 ÷ 0.4 = 7.5 and 15 × 7.5 ≈ 112px of cap
height, which is where 88px counts and a 44px pill come from. The panel is the ratio and nothing
else — at three metres a list of twenty names is unreadable anyway.

Two decisions worth keeping. **The unverified-ratio caveat scales with the numbers** (24px, not
13px): a compliance disclaimer that shrinks while the figure it qualifies grows is one nobody
reads, which is exactly what `RATIO_TABLES_VERIFIED` exists to prevent, and leaving it at 13px
would have looked finished. And the pack's two 112px "Sign a child in / out" buttons are **not**
reproduced — a generic "sign a child in" must ask *which* child, and inventing that picker is a
feature. Asserted in e2e and mutation-tested: shrinking the counts to 22px fails with "counts
should be ~88px", and nothing else in the repo would have noticed, because the page renders and
axe passes while the panel silently stops being readable from the door.

That completes the design pack except screens 4 and 5, which are **not** design work: the web app
has no local write queue, so a roll with queued sign-ins and a sign-out refusal listing unsent
records describe states that cannot occur. Building their appearance would be a lie on the
funding-critical path. [[design-system]] now carries the scope — `buildRoll`,
`classifyWriteFailure`, the `client_uuid` idempotency contract and the refusal logic all exist and
are tested; what is missing is browser storage, a flush on reconnect, and the roll as a client
component holding optimistic state. AGENTS §5 gates that behind `drill:offline`, and the failure
mode is a sign-in that looks recorded and never lands, invisible until a funding return is short.

2026-08-06 — Screens 10 and 11, the whānau surface, and **a correction to my own change made
within the hour.** Screen 10 gained the header it never had (56px initials, name 28/600, a green
"Signed in at 8:12 am today" block) and the pack's two eyebrows, which are better than the bare
"Health"/"Consents" they replace: "Health · read-only" and "Consents · you can change these" tell
a parent what a section is before they try to change it.

**Refused the pack's 56×32 consent switches**, on the evidence of the pack's own web spec three
screens earlier, which models consent as **three** states — Given, Withdrawn, and "Never recorded"
+ a Record button. A switch has two, so "never asked" would render as "declined", telling a parent
they refused something nobody asked them, about photographs of their child. The pack's
`ConsentSwitch` also has a "saving (queued)" state this app deliberately lacks: queueing a consent
would show "given" on the phone while the restrictive policy still refuses the photo.

Then screen 11, where I was wrong. The pack requires a withdrawn photo to render nothing — no
notice, because the notice is the disclosure — and the mobile feed had a chip reading "a photo is
not available", so I deleted it. **The gate is a restrictive SELECT policy on `public.media`: a
withdrawn photo's row never reaches a client at all**, asserted with `count(*) = 0`. A null URL is
a malfunction, so deleting the notice silenced a real failure and protected nothing. Restored with
honest wording.

What sent it wrong was a comment in `@ece/api` claiming a null URL usually means "the caller may no
longer read it, which is the gate working" — impossible, since such a caller has no row to sign.
Two comments in this repo disagreed about the same condition and the wrong one was the one I read.
Corrected, with the mechanism in [[consent-gated-media]]. The general lesson kept there: **the pack
asks for a rendering rule where this schema makes the data absent**, which is strictly stronger —
a privacy rule enforced by a policy cannot be forgotten by a component.

2026-08-06 — Screen 9, the mobile staff roll. Two of the three changes are about the room rather
than the mockup. **The action moved inside the card**: it had been a block below each card, which
cost a row of vertical space per child and put each button nearer the *next* child's name than to
its own — on a roll of twenty tapped in a hurry at 8am that is a mis-tap waiting to happen, and a
mis-tap here writes an attendance time that decides funded hours. **Connectivity left the ratio
block**, where "offline" and "3 to send" were chips making two unrelated conditions look like one;
`OfflineStrip` is now its own element in pending-blue, and what stays in the ratio block is the
sentence tying them together — "Includes 3 not yet sent to the office", because an educator
reading "within ratio" must know whether that count includes children signed in with no signal.

**One pack target refused**: it specifies 88×56 for roll row actions and this keeps 64px. The
pack's own rule reserves 64 for primaries, and sign-in *is* this app's primary action — shrinking
the most-tapped control to match a mockup is a regression dressed as fidelity. No opacity pulse on
the strip either: a pulse says "attend to me now", which contradicts the reason the strip is blue.

Found on the way, and worth knowing: **the mobile workspace has no test runner.** `npm test`
covers core, api and web only, and nothing in the checklist says otherwise, so the strip's wording
— the line an educator reads to decide whether to trust the ratio — cannot be unit-tested. Left
unexported rather than exported with a comment pretending a test exists. Also two RN traps that
`typecheck` caught only because it was run: `accessibilityRole="status"` is a **web** ARIA value
that does not exist in React Native, and `accessibilityElementsHidden` is invalid on `Text`.

2026-08-06 — The mobile surface starts: screens 8 (sign-in) and 12 (empty states). Mobile was
already closer to the pack than web had been, because the token file it reads *is* the pack —
56px fields, a 64px primary and one error string were in place. Three things were not. "Nau mai"
at 36/600 over "Sign in to your centre." replaced "Sign in" over the word "ECE", which is a
product name where the pack asks for an instruction. The failure state moved from red text on the
page background into a 10-radius `breachSoft` block at 17/500 — the reason is the room, not the
mockup: read standing up in poor light, a colour change on a thin glyph is the first thing to go.

All three empty states were one line of muted 15px text, which reads as a fault rather than as
"nothing has happened yet". One shared `EmptyState` now carries the pack's shape, including its
rule of **at most one action** — an empty screen with three buttons asks somebody who has just
arrived to make a decision they have no basis for. "Nothing posted yet" therefore has no action at
all: nothing a parent does makes kaiako post. "No centre yet" gained a real "Check again" wired to
the provider's `retry()`, because the thing that changes the answer happens on somebody else's
device and there is no push for it. [[mobile-app]] corrected where it described the old sign-in
copy. Metro bundled clean; still nothing has run on a device ([[unverified-claims]] item 15), and
the "Message the centre" action leans on React Navigation bubbling an unmatched route to the
parent tab navigator, which is documented but unverified here.

2026-08-06 — Screen 6, the child record, where the pack's instruction is a safety decision
rather than a style: health above identity metadata, "because it is the only block read under
time pressure". The record had been Details → Health → Whānau → Enrolment → Consent, which puts
a form for editing a child's legal name above the sentence saying what to do when they stop
breathing. Now header → Read this first → Health → Consent → Whānau → Enrolment → Custody →
Details → Leaving, with the pack's 56px initials header and a right-aligned "signed in" chip.

**The order is now a tripwire in the e2e suite**, because it is invisible to every other check
here — the page renders, axe passes, and every test stays green with the sections in any order
at all. Mutation-tested: putting Details back on top fails with the whole heading order printed.

The status chip needed `listAttendanceToday()` on a page a **parent** loads, and `@ece/api` has
no tenant filtering by design. Checked instead of assumed: the RLS suite already asserts "and
cannot read another family's attendance either", so the policy keys on guardianship, not merely
`centre_id`. Had it keyed on the centre, that one-line addition would have been exactly the
defect [[tenancy-and-rls]] warns about. Detail in [[design-system]].

2026-08-06 — RollRow. The roll stopped being a `<table>`: the pack folds age and flags into a
line under the name, leaving name/time/action, and it calls these lists in its own screen
description. The stronger reason is mechanical — a table whose rows are restyled as grids loses
its row semantics in some engines, so keeping the table would have traded real semantics for a
layout. Now a `<ul>` with a `44px 1fr auto auto` grid, an initials circle, 18/600 name, 13/muted
meta line, and a 44px action; two columns below 767px. `initials()` added to `@ece/core` beside
`displayName()` with a test, and deliberately not derived from it — `displayName()` returns
"Ana (Anahera) Test", whose first two initials are "A" and "(". FlagChip moved to the pack's
13/600 from 12/500.

One finding worth keeping. The pack asks the roll action to name the child, because twenty
identical "Sign in" buttons are useless to a screen reader. The first attempt used a
`visually-hidden` span, which renders the right accessible name and puts the child's name in the
DOM **twice per row**. A test caught it as a strict-mode violation, but the test is not the
point: anything matching on text sees both copies, so find-in-page for a child would report
twice as many hits as there are children. `aria-label` gives one text node and the same name,
with the visible label as its prefix per WCAG 2.5.3. Also: `npm run lint` and `npm test`
appeared to fail during this work and had not — the Bash tool's working directory had persisted
from an earlier `cd packages/core`, so both ran inside that workspace. Worth knowing before
diagnosing a phantom failure. Detail in [[design-system]].

2026-08-06 — Second pass on the phone shell, because the first fix was not enough and the
reasoning for it was wrong. Turning the rail into a full-width bar removed the horizontal
problem and created a vertical one: **312px of an 852px screen, 37% navigation before any
content**. Reported from a real phone against production, which was already serving the fix.
The "no hamburger" argument was wrong on two of three claims — a focus trap and an Escape
handler belong to a modal, and an inline expander needs neither. Collapsed behind one 44px
`☰ Menu` control below 768px: **312px → 72px, 37% → 8%**.

The lesson is about the assertions, not the CSS. Both existing phone assertions passed
throughout the second defect: **a rail that spans the viewport and does not overflow can still
be useless.** A third now checks the thing that actually matters — content starts within 160px,
and opening the menu reveals the links, so a collapse cannot degrade into a way of hiding the
navigation. Mutation-tested. Detail in [[design-system]].

2026-08-06 — The shell was broken on a phone and no check was looking. Reported from use: the
224px rail never collapsed, taking **57% of a 390px screen** and leaving the ratio block — the
one thing that must be glanceable — wrapping "0 kaiako · 0 tamariki" over four lines, with
`/attendance` scrolling 327px sideways. Fixed with a 767px breakpoint that turns the rail into a
bar; deliberately no hamburger, which would need state, a focus trap and an escape key to save
vertical space on a surface that scrolls anyway.

Two findings worth more than the fix. **An accessibility helper was causing a layout defect**:
after the table was contained, 31px of page scroll remained, because `.visually-hidden` is
absolutely positioned and with no positioned ancestor its containing block is the page — the
off-screen "Actions" label in the roll's header sat at x=421 on a 390px viewport. Nobody looks
for a layout bug inside a screen-reader affordance. And **the audit had a blind spot shaped like
this bug**: the Playwright viewport is 1440×900 with a comment about auditing the app as an
operator sees it, so nothing ever loaded a narrow one. Four assertions added and
mutation-tested — and the scroll-width ones alone were not sufficient, since `/` never
overflowed, it merely had 166px of usable width, so the rail width is asserted separately.
Detail in [[design-system]].

2026-08-06 — Screens 2 and 3 of the pack: the shell (1280px, 224px rail, sign-out pinned to
the bottom) and the ratio block's three states, with the breach overflow segment and an
`aria-hidden` track. The current nav item is styled off `aria-current="page"` rather than a
class, which is a rule worth keeping — when the attribute a screen reader reads is also the
stylesheet's selector, "looks current but is not announced as current" stops being a possible
state. Removed a `title` attribute from the roll's allergy chip that was carrying the response
plan: meaning available to a mouse and to nothing else.

Refused the pack's ratio caption. It shows an 88% fill under "88% of the adults recorded today"
for a room with 4 kaiako where 4 are required — 100% of the adults, so the sentence cannot
describe its own bar. In a compliance product a caption that misdescribes its bar is the failure
mode [[unverified-claims]] exists to prevent, so the track is occupancy toward the limit and the
caption says so. RollRow deliberately left undone rather than rushed: the e2e suite selects roll
rows by ARIA role and the pack's row is a grid of divs. Screens 4 and 5 turn out not to be
visual work at all — the web app has no offline queue, so the offline roll and the sign-out
refusal need that capability first. All in [[design-system]].

2026-08-06 — Started applying the `design_handoff_ece_platform/` pack. New page
[[design-system]]. The tokens already agreed with the handoff on every colour, size, radius,
target and the motion curve — the pack and the repo describe the same system — so the work is
not a re-tokening but bringing screens up to a spec the tokens were built for. Four values did
diverge, all borders: the three state borders were close but unequal, and a pending-sync border
did not exist, so the offline strip fell back to `line`, a warmer grey from a different family
than the blue around it. New ratios were **measured** (1.17–1.45:1) rather than carried over.
`elevation.card` alpha .05 → .06.

Screens 1 (web login) and the no-access half of 7 are built; 2–6 and 8–13 are not, and
[[design-system]] says so explicitly rather than letting a wiki page imply the product looks
like the board. One constraint in the master prompt was **refused**: it forbids password reset
and omits its routes, which would mean deleting the feature built the day before at the owner's
request. The property that constraint protects — no account enumeration — is preserved by the
uniform response; the recovery path it points at has never worked. Recorded as a deviation
through the handoff's own mechanism, and cross-linked from [[password-recovery]]. The unchecked
product name went to [[unverified-claims]] as item 19.

Verifying screen 1 failed the e2e suite on an attendance assertion three hundred lines from
anything that changed, and the first explanation was wrong: not "the run crossed midnight" but
the fixture stamping its sign-in at `now - 1 hour`, which lands on yesterday for the first hour
of a New Zealand day. **The suite failed for one hour in twenty-four and passed the other
twenty-three.** The adult count had the same defect at `now - 3_700_000`, which would have left
the ratio reading "no adult count recorded" instead of "within ratio". Third instance of this
trap in the repo and the first inside a test; mechanism in [[conventions]]. The product was
correct throughout.

2026-08-05 — Password recovery built, and the design stance it replaces corrected. The design
handoff's login screen said "no password reset here — ask your centre to re-invite you", but the
invite flow refuses to set a password for an existing account (deliberately — it would be a
takeover), so the documented recovery path dead-ended at "sign in first", the one thing the
person cannot do: a forgotten password was a permanent lockout. New page [[password-recovery]]
records the flows (uniform-response `/forgot-password`, `/auth/confirm` route handler,
`/reset-password`, and `/account` change requiring the current password) and the rejected
alternatives. [[mobile-app]] corrected: its wall #3 said "there is no mailer, so a
password-reset link has nowhere to go", and the reset flow now sends through Supabase's built-in
mailer — whether those emails actually deliver is [[unverified-claims]] item 18.

Drilled rather than assumed, and it paid: two findings came out of pointing the flow at the live
auth server. First, GoTrue's `/verify` hands the session back in two different shapes, and only
one is readable by a server route — `resetPasswordForEmail` registers a PKCE challenge and gets
`?code=`, while `admin.generateLink` registers none and gets `#access_token=` in the fragment.
Second, that makes the link `onboard.ts` prints a **dead end**: nothing in the web app reads a
fragment, because `browserDb()` is exported and called from nowhere. A new owner following the
onboarding output lands signed out with no error. Pre-existing, not caused by this work,
correction written into [[invitations]] over the claim that `recovery` was "the correct artefact
anyway", mechanism and the fix in [[password-recovery]]. The fix is deliberately not applied in
this commit: it changes tenant onboarding and deserves its own. Also confirmed in passing, and
worth knowing before debugging a link that "goes to the wrong place": a `redirectTo` absent from
`uri_allow_list` is replaced with `site_url` **silently**.

2026-08-05 — `onboard.ts` gained `--role manager` (default stays `owner`), stopping at those
two roles: educators and whānau are invited from the app so the decision and its audit trail
stay inside the tenant. Occasion: attaching the platform owner's personal account as manager
at both Little Pearls centres. Also run to ground on [[invitations]]: the `listUsers` 500 that
script's comments have carried since it was written is two Zelva-era `auth.users` rows with
NULL where current GoTrue expects `''` — the repair (a `coalesce` update) and the account
cleanup were handed to the owner to run in the dashboard, because the permission classifier
here refuses ad-hoc writes against `auth.users`, which is the correct instinct even when
inconvenient.

2026-08-05 — The first Railway deploy failed, on this repo's own build command, and the wiki was
carrying the wrong reason for that command in two places. `npm ci --include=dev && npm run build`
hit `EBUSY … rmdir '/app/node_modules/.cache'`: Nixpacks runs its own `npm ci` in the install
phase, so ours was a second install deleting `node_modules` out from under the builder. The
justifying claim — that Nixpacks sets `NODE_ENV=production` and would prune the `typescript` and
`@types` packages `next build` needs — was wrong twice: the builder's plain `npm ci` installed 898
of the lockfile's 903 packages, and those three packages are not dev-only in this lockfile anyway.
[[deployment]] corrected in both places (the claim also sat under "checked rather than assumed" —
it had been checked against npm's documentation instead of against the platform; the two claims on
that list verified by running something were right, the one verified by reading was wrong). Two
further findings from the same build log added to [[deployment]]: Nixpacks bakes every Railway
variable into the image as `ARG`/`ENV`, so the service-role key is in the image layers and image
access is key access; and the service runs in Southeast Asia, which `docs/privacy-statement.md` now
states instead of leaving as an open question. `buildCommand` is now just `npm run build`; if a
future builder ever does prune dev dependencies, the fix is `NPM_CONFIG_INCLUDE=dev`, not a second
install.

2026-08-04 — Wiki initialised, following the pattern in `salix/llm-wiki`. Eight pages written
from the four sessions that built Phases 0–3, rather than from a fresh read of the source:
[[tenancy-and-rls]], [[attendance-and-ratios]], [[offline-outbox]],
[[compliance-and-evidence]], [[invitations]], [[privacy-and-retention]], [[conventions]] and
[[unverified-claims]]. Deliberately **not** a second copy of the root `README.md` — that holds
how to run it and the decisions a contributor needs before touching code; these pages hold why
decisions were made, what was tried and rejected, and what is asserted without a source. Two
additions to the salix page template, both earned by this domain: rejected alternatives are
part of a page rather than a footnote, since most of the expensive knowledge here is "the
obvious thing was tried and here is how it failed"; and any claim about a regulation, duration
or threshold carries its source inline or does not go on a topic page at all.

2026-08-04 — No `wiki.py` copied, and the reason recorded in the README. The salix script's
pages are edited by hand rather than produced by `ingest`, so shipping the CLI here would imply
the pages are generated and can be regenerated. It also needs pip, a requirements file and an
API key to do a job an agent with file access already does directly. Noted where to copy it
from if a scripted ingest is ever wanted, including that its `wiki/*.md` glob is non-recursive
and cannot see subfolders.

2026-08-04 — [[unverified-claims]] created as the entry point of the whole wiki, and linked
first from the index. Seven items: the ratio bands (highest priority — `RATIO_TABLES_VERIFIED`
is false and both the web banner and the mobile bar say so); the absent licensing criteria;
the seven-year retention default; the missing device drill; the per-kind warning lead times;
the regulatory timing claims inherited from the salix product plan and never re-checked here;
and the fact that Phase 1 built enrolment on one customer's word after the plan's Stage 0 —
ten conversations, zero code — was skipped. The pattern to keep: if a claim cannot be sourced,
make the *product* say so in a machine-readable flag, and put it on that page. Two of the
seven already work that way.

2026-08-04 — Recorded in [[privacy-and-retention]] a correction to a claim this repo made
earlier: the Privacy Act 2020 does **not** give a right to request deletion. It gives access
(IPP 6) and correction (IPP 7); there is no general right to erasure in New Zealand law, which
is GDPR Article 17. What it imposes is IPP 9, a retention limit on the agency — an obligation
discharged by following a schedule, not an endpoint an individual triggers. The design follows
from that: a scheduled sweep is the mechanism and ad-hoc purging is the restricted exception.
Also noted that IPP 6 is the reason an educator can read their own police vetting result, which
reads like a convenience and is a statutory right.

2026-08-04 — [[conventions]] collects the traps that have already cost time: `current_date`
under a UTC session being yesterday for the whole New Zealand morning (which rejected a baby
born that morning as born in the future); PostgREST bulk inserts sending explicit `NULL`
instead of taking column defaults; the 1000-row cap on an unbounded select; `upsert` without
`ignoreDuplicates` needing `UPDATE` privilege and therefore failing `42501` before any `CHECK`
runs, which made one test pass for the wrong reason; and `create or replace view` refusing to
change a column list, which made the migrations un-replayable until both offending views were
switched to drop-then-create.

2026-08-04 — Added [[consent-gated-media]] for Phase 4. The page exists mostly to record one bug
and one rule. The bug: the consent check was written inside the permissive `media_select` policy
while `media_write` was declared `FOR ALL` — and `FOR ALL` covers SELECT, and permissive policies
are OR-ed, so staff matched the write policy and the consent condition never had to be satisfied. It
hid correctly from whānau and not at all from educators, which is why it survived a first review: the
retroactive half looked like it worked for the caller most likely to be tested. The rule that came
out of it: a condition that must hold for *every* reader belongs in a **restrictive** policy, which
is AND-ed with all of them and cannot be routed around by adding another; a condition about *which*
readers belongs in a permissive one. Every other `FOR ALL` policy in the schema was re-read
afterwards and all are narrower than their matching select policy, so `media` was the only case with
the dangerous shape.

2026-08-04 — Recorded in [[unverified-claims]] that push notification delivery has never run once.
The model, the preferences and the quiet-hours arithmetic are built and tested — including a window
that wraps midnight, evaluated in the centre timezone across both sides of the daylight-saving switch
— but no notification has ever reached a device, and there is no worker reading the queue. Listed
alongside the airplane-mode drill for the same reason: a thing that looks finished and has never
executed is worth naming rather than discovering.

2026-08-04 — Added [[funding-and-billing]] for Phase 5. The organising rule: hours become a claim on
the Crown, so **nothing is estimated**. A day with a missing sign-out is excluded and named rather
than guessed up (a false claim) or silently zeroed (which loses the centre funding it is owed and
hides the record error), and every rounding decision floors. Two orderings that are easy to get
backwards are recorded with their arithmetic: the daily cap must be applied before the weekly one,
because Monday's excess is not transferable to Tuesday; and corrections must be resolved
transitively, because a fixed sign-in time otherwise counts twice.

2026-08-04 — Recorded the deliberate omissions in [[unverified-claims]]: the funding caps, the fact
that funding *periods* are a parameter rather than a guess, and that there are **no funding rates
anywhere in the product** — a rate is a number the Ministry publishes and changes, and inventing one
would let a centre budget against a figure this product made up. Also recorded why Stripe was not
built: the pilot is free, most centres already collect through their own systems, and none of Stripe's
real decisions are decidable while the price is NZ$0.

2026-08-04 — Added [[production-readiness]] for Phase 6, the phase whose job was to find out what is
not true. Three of its five deliverables are exercises rather than opinions — you cannot audit
accessibility by reasoning about it, verify a backup by believing in it, or delete a tenant by
intending to — and two of them failed the first time.

2026-08-04 — Recorded the defect the audit fixture found by needing to clean up after itself: **a
centre could not be deleted, by anybody, ever.** Deleting a centre cascades to children, whose audit
trigger inserts a row referencing the centre that has just been removed, so the foreign key rejects
it and the transaction aborts. Five phases had shipped with no way to offboard a customer, and neither
the type system nor the RLS isolation suite could have surfaced it, because none of them tries.
Migration 0020 drops the foreign key — a correction rather than a workaround, because `audit_events`
is a ledger and **a ledger has to outlive its subject**.

2026-08-04 — Recorded why the accessibility fixture seeds loaded screens rather than using empty ones:
axe cannot find a contrast failure in a table with no rows or an unlabelled control in a form nobody
rendered, and every screen in this product has an empty state that passes trivially. The audit found
one critical failure — the role selector on the People screen had no accessible name, so a screen
reader announced "combo box, educator" once per person with nothing to say whose row it was.

2026-08-04 — Recorded in [[unverified-claims]] (items 10–12) that two legal citations in the new
user-facing documents are unchecked, and that **no screen reader has ever been used on this product**.
axe passes on 19 screens in both roles with no advisory warnings either, which is a floor and not a
pass: it finds perhaps a third to a half of WCAG failures and cannot tell whether a focus order makes
sense or whether an error message helps anybody.

2026-08-04 — Recorded that the restore drill was **mutation-tested**, and why that matters more than
it passing. A character appended to a timestamptz was caught by the type system, not by the
comparison; a character appended to a free-text column loaded successfully and then failed the
comparison, naming the table — one character, one column, one row, out of 485. Without the second
mutation the comparison might have been comparing something with itself.

2026-08-04 — Added [[security-review]]. Sixteen checks written as SQL against the live schema rather
than as a reading of the migrations, which is the only reason four findings surfaced: in every one the
code said the right thing and the database did not enforce it. An issued invoice did not freeze though
the README said it did; the audit trigger had covered ten tables since April while the schema grew to
twenty-two, `staff_records` among the uncovered; there were no security headers at all; and fourteen
tables still carried the `FOR ALL` shape that produced the Phase 4 consent leak.

2026-08-04 — Recorded that fixing the missing security headers **broke every write in the
application**. `Referrer-Policy: no-referrer` was correct reasoning — these URLs carry child UUIDs —
and Next's server-action origin check falls back to `Referer` when `Origin` is absent, so it parsed the
string "null". Every server action is a write, so the roll rendered and signing a child in did
nothing, with typecheck, lint and build all clean. Kept as a worked example of a security control that
fails by disabling the product rather than by permitting something.

2026-08-04 — Recorded in [[unverified-claims]] as item 14 the four claims this repo made in writing
that were not true, including one about where a file lived that was wrong for two weeks. The pattern:
each was a claim about a mechanism derived from reading the code that implements it. Two were caught by
asking the database and one by running `pwd`; none was caught by review. A claim about what the product
enforces now belongs next to a test that fails when it stops being true.

2026-08-05 — Recorded the first real tenant. Little Pearls Educare Centre, two centres, real Ministry
service numbers from two agreeing government directories, and **zero children** — the insurance gate
is still open and the tenant holds nothing but a name, a number and a timezone precisely so that line
has not been crossed. Third-party directory claims about licensed capacity and opening hours were left
out; one of them contradicts the centre's own site about its own hours, which is a fair measure of what
those listings are worth.

2026-08-05 — Recorded the trap onboarding uncovered: the demo centres held the **real customer's
slugs**, and `seed-demo.ts` selected its centres with `slug like 'little-pearls-%'`. The first demo
seed after the real tenant existed would have written seven invented children — including a fabricated
peanut anaphylaxis plan — into a live service's roll, and the following run's `purgeAll()` would have
removed them again, so it would have looked like nothing happened. Caught by a unique index refusing
the insert, which is luck rather than design. Demo data now lives under `demo-` and the script refuses
to run if its pattern matches anything else.

2026-08-05 — Recorded that the e2e harness leaked six centres and fifty-six accounts, because the
teardown runs on a failing test but not on a dying process, and because it looked accounts up through
`auth.admin.listUsers` — which returns a 500 with an empty body on this project, a fact `onboard.ts`
had documented and this code had ignored. It now deletes by known ids and sweeps stale tenants before
its own work, so a killed run heals on the next one.

2026-08-05 — Added [[reading-every-row]]. PostgREST is configured with `max_rows: 1000` and returns a
truncated result with `error` set to null, which was under-reporting a funding claim by 28% **and**
fabricating unresolved days that were not broken — wrong in both directions at once, in the
calculation whose entire principle is that nothing is estimated. Measured against the live database
rather than reasoned about. The page keeps three things: that a bigger limit moves the cliff rather
than removing it; that paging over a non-unique order is its own silent corruption, so every paged
query gained `id` as a tiebreaker; and that the guard test lied twice before it was honest — most
instructively when a fixed line lookahead bled into the next function and declared the unbounded
query bounded, which is the same shape of silent wrongness the guard exists to catch, inside the
guard.

2026-08-05 — Recorded in [[reading-every-row]] that the first row-cap probe was a **bad instrument**.
Its ten-minute cadence ran through midnight, so `pairDay` correctly reported orphan sign-outs at
every date boundary; the fix improved the number from 72 to 84 against an expected 100, and 84 was
tempting to accept. The expectation was wrong, not the fix. Rebuilt with hand arithmetic in the
script's comments so the expected total is checkable without running anything.

2026-08-05 — **Corrected [[offline-outbox]], which was wrong in writing.** It listed two failure
verdicts and put every check violation under `permanent`. `attendance_not_future` is a check violation
that fires when a device clock runs more than two hours fast — and it is self-healing, because real
time advances. Classified permanent, a drifted tablet would have its sign-ins marked dead on the first
attempt: child off the roll, ratio wrong all day, day missing from the funding record, over a clock.
There are three verdicts now, and the two clock constraints look almost identical and behave in
opposite directions, which is how one rule came to swallow both.

2026-08-05 — Recorded in [[offline-outbox]] the finding that decided the whole shared-tablet story and
was missed until a design review: `recordAttendance` stamps `recorded_by` at **flush time**. So
leaving one educator's queued sign-ins for the next person's token files their observations under the
wrong name, permanently, in a table with no UPDATE grant — and if that person is not a member of the
centre, RLS refuses it, the flush loop breaks, and every later sign-in jams behind it for the rest of
the day. The queue now carries a `user_id`. Also corrected `clearAll()`'s docstring, which claims
sign-out is its caller: it is not, and the first sign-out implementation followed it and would have
destroyed attendance records.

2026-08-05 — Added [[mobile-app]]. For five phases the app rendered the words "Not signed in." and
offered nothing — no email field, no password field, no `signInWithPassword` anywhere in the
workspace. It typechecked, linted, bundled through Metro in CI, and had components with careful
accessibility labels, and none of those checks can tell you the product has no front door. The page
records the three independent walls that make sign-up, invitation acceptance and password reset
structurally impossible on mobile, so nobody tries to move them there.

2026-08-05 — Added [[deployment]], written because two questions were asked that nothing in the repo
answered: whether the deployment is per-customer (it cannot be — you cannot publish one App Store
binary per childcare centre, and once that is true for mobile, a different web model means two
tenancy models), and what putting the container on the internet costs (a service-role key that
bypasses every policy, because the invitation flow calls the GoTrue admin API and no Postgres
function can substitute). Also kept as a worked example: `Referrer-Policy: no-referrer` was correct
reasoning about child UUIDs in a `Referer` header, and it made **every write in the product fail**
while every page rendered perfectly, with typecheck, lint and build all clean.

2026-08-05 — Recorded in [[unverified-claims]] as items 15–17: the mobile app has never run on a
device, three store blockers are not code, and — found while designing the account deletion Apple
asks for — deleting an `auth.users` row would **erase attribution in licensing evidence**, because
`audit_events.actor_id`, `attendance_events.recorded_by` and `staff_records.sighted_by` are all
`on delete set null`. That attribution is the evidence the compliance feature exists to produce, and
an account-deletion feature built the obvious way would quietly destroy it.

2026-08-05 — Recorded in [[conventions]] that **the wiki is updated before the commit, not after** —
a standing instruction from the owner, promoted from a soft bullet in `AGENTS.md`'s standing
constraints to a gate in its verification section, because as a bullet it was exactly what got
skipped: four commits shipped and the wiki update was batched behind them.

The clause that matters most is the one about contradictions: if a change contradicts something a
page already says, **correct that page first**. A wiki that is wrong is worse than no wiki because
it is trusted, and there is a precedent rather than a hypothetical — [[offline-outbox]] spent a day
asserting that every check violation was a permanent failure, which was the exact opposite of the
fix just made, on the page somebody would read before touching the offline path.

Also removed the assertion count from `AGENTS.md`'s verification checklist. It said 119 and the
suite is at 176; a number in a checklist is a number that goes stale, and the counts live in the
tools that print them.

2026-08-05 — Recorded in [[deployment]] that Railway's workspace detection offers **two** services,
`@ece/web` and `@ece/mobile`, because `apps/mobile/package.json` has a `start` script — which is
`expo start`, a development bundler rather than a server. The mobile service must be deleted: a
container running it costs money, serves nothing reachable, and fails the health check forever. Worth
writing down because it does not look like a mistake in the dashboard — it has a name, a green badge,
and sits beside the real one.

The same detection sets the root directory to `apps/web`, and that failure is the silent one.
`railway.json` lives only at the repository root, so from `apps/web` Railway never sees it and
guesses the build command, the start command and the health check path — a deploy that looks
configured and is not.

*Log last updated: 2026-08-05*
