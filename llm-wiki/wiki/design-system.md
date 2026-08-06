# Design system and the Doorway handoff

Applying the `design_handoff_ece_platform/` pack to the repo: what the tokens already agreed
on, the four values that diverged, and the one constraint in the master prompt that had to be
refused.

## Overview

The handoff arrived on 2026-08-05 as a README (self-described as authoritative, with the HTML
board as corroboration), a design board, and PNG captures. It carries a master prompt intended
to be pasted into an agent, a full token table, two component inventories, thirteen screens,
accessibility annotations and a rationale list. It also gives the product a working name,
**Doorway**, which has **not** been trademark- or domain-checked — the handoff says so itself
and that belongs in [[unverified-claims]] before anything is cut for a store.

The useful discovery on first contact: `packages/core/src/tokens.ts` and the handoff's token
table already agreed on every surface, text, brand and state colour, the whole spacing and type
scale, both radii sets, the motion curve and all three touch targets. That is not luck — the
repo's tokens and this pack describe the same design system. It means the work is not a
re-tokening; it is bringing thirteen screens up to a spec the tokens were already built for.

## Key Points

- **Four token values diverged, all of them borders.** `okBorder`, `warnBorder` and
  `breachBorder` were close but not equal to the handoff's, and the fourth — a pending-sync
  border — did not exist, so the offline strip fell back to `line`, a warmer grey from a
  different family than the blue it sits inside. Now `#cfe2d7 / #ecd9ae / #eccabe / #d3e0ed`.
- **The new border ratios were measured, not carried over**: 1.17:1 to 1.45:1 against fill and
  page, against 1.23–1.41 for the set they replace. Still far under 1.4.11's 3:1, still
  correctly so — these boundaries carry no information, the words inside them do.
- **`elevation.card` moved from `.05` to `.06` alpha** to match the handoff's single shadow.
  Nothing consumes `elevation` yet; `raised` is not in the design system and was left alone
  rather than deleted, because deleting it is unrelated to this change.
- **The master prompt's "no password reset" constraint was refused**, with reasons. See below.
- **The auth panel is not `.card`.** It is 520px on the *page* background, separated by a
  hairline — so nothing on a sign-in screen competes with the one thing the person came to do.
- **Verifying screen 1 turned up a defect in the e2e fixture, not the app** — a seeded
  timestamp that broke the suite for one hour a day. See [[conventions]].

## Details

### The one constraint that was refused

The master prompt's hard constraint 3 says "do not soften the safety decisions", and lists among
them the login screen's footnote: *"There is no sign-up and no password reset here — ask your
centre to re-invite you."* Constraint 4 says do not add routes, and the route list omits
`/account`, `/forgot-password`, `/reset-password` and `/auth/confirm`.

Applied literally, that means deleting the password-change and password-recovery features built
the day before at the owner's explicit request. It was not applied, for one reason that is not
a matter of taste: **the recovery path the handoff points at does not exist.** The invitation
flow deliberately refuses to set a password for an address that already has an account, because
doing so would be an account takeover, so "ask your centre to re-invite you" dead-ends at "sign
in first" — the one thing a person who has forgotten their password cannot do. The measurement
that settled it is in [[password-recovery]]: the link `onboard.ts` prints cannot even establish
a session.

The safety property the constraint was protecting is real and is preserved: no account
enumeration. It is carried by the uniform response on `/forgot-password` — identical for a known
address, an unknown address and a send failure — which is the same reasoning as the single login
error string the same constraint protects. The other three items in constraint 3 (the single
error string, the absent custody section, the sign-out refusal with no escape hatch) are
untouched and should stay untouched.

The handoff's own mechanism was used to record this: the master prompt asks for a list of
deviations after each screen, so the deviation is reported rather than smuggled. The login
footnote now reads "Access to a centre comes from an invitation — there is no sign-up here",
which is true, and links to the reset.

### Screen 1 — Web login, and screen 7's no-access half

Built to spec: 520px panel, 56px/48px padding, 24px gap, "Nau mai" at 28/600 over "Sign in to
your centre." at 15/muted, 44px fields with 13/600 labels in ink rather than the muted 13 the
rest of the app uses for labels, 48px full-width green submit, and the failure alert **above**
the fields at 15/500 in `breach` on `breachSoft` with the ▲ glyph marked `aria-hidden`.

Two details from the annotations that are easy to miss and were both wrong before:

- `autocomplete="username"` on the email field, not `"email"`. It is what pairs the field with
  the password field for a password manager.
- **Focus moves to the alert.** A message rendered above the fields but never focused is
  announced late and read last on a form this short, which is the opposite of the intent.

48px is the handoff's web primary height and is not a token: it sits between the 44 the token
file calls the interactive minimum and the 56 it calls comfortable, because this is a
mouse-and-keyboard screen where 56 reads as oversized. Written as a literal with that reasoning
next to it rather than added to the token set, which is shared with a phone.

No-access is the handoff's copy verbatim, and the important thing about it is what it is *not*:
no red, no error glyph, nothing that reads as the person's fault. It is a waiting room. "Check
again" is a real server action that revalidates rather than a link to the same page, because a
plain reload would be served from the router cache showing the same emptiness.

The two password screens were brought onto the same panel even though the handoff has no such
screens, so they read as part of the product rather than as a bolt-on.

### Screens 2 and 3 — the shell, and the ratio block's three states

The shell is now the pack's: 1280px overall, a 224px rail on card with a hairline down
its right edge, nav items at 15px / 9px 10px / radius 6, and the sign-out control
**pinned to the bottom** rather than sitting under the navigation — it is the one
control on that rail that must never be hit while aiming for something else.

The current nav item is styled off `aria-current="page"` rather than a class. That is
worth stating as a rule: when the attribute a screen reader reads is also the selector
the stylesheet uses, the two cannot drift apart, and "looks current but isn't announced
as current" stops being a possible state. It cost one small client component
(`NavLink`), because the shell is a server component and has no pathname.

The ratio block is the pack's anatomy — white pill on the tint, counts at 22/600 in
**ink** rather than the state colour (the numbers are facts, the tint is the verdict), a
15/500 detail line, a 14px track, and a 13px consequence sentence. Breach adds the
detached 56px overflow segment at 45% opacity, so "over" reads as overflow rather than
as a bar that merely stopped growing. The track is `aria-hidden`, per the pack, because
the sentence beneath it carries the same information in words.

**One `title` attribute was removed** from the roll's allergy chip, where it had been
carrying the response plan. The pack forbids `title` for meaning and is right to: it is
available to a mouse and to nothing else — not a keyboard, not a touch screen, not most
screen readers. The plan lives on the child's record, which is where it is read.

### The ratio track: a caption that did not describe its own bar

The pack's sample block shows an 88% fill under the sentence *"88% of the adults
recorded today"*, for a room with 4 kaiako where 4 are required. That is 100% of the
adults, so the sentence cannot be describing the bar above it, and no reading of the
sample numbers produces 88% from an adult count.

Reproducing it verbatim was refused. This is a compliance product, and a caption that
misdescribes the bar it sits under is the exact failure mode [[unverified-claims]]
exists to prevent — a manager who reads a percentage as "how staffed am I" when it means
something else stops counting. The track is instead **occupancy toward the limit**: the
roll as a fraction of the most tamariki these adults can cover if the next arrivals are
aged 2 and over, which is derivable from `headroomTwoAndOver` and is what the pack's own
"Headroom for 2 more tamariki aged 2+" sentence is about. The caption says that in
words.

If the intended meaning was something else, the fix is one expression in
`RatioBanner.tsx` — but it needs a sentence that is true of whatever it measures.

### The shell was broken on a phone, and nothing was looking

Reported from use, not found by a check: the rail never collapsed. Measured before fixing,
at 390×780:

| | Before | After |
|---|---|---|
| Rail width | 224px — **57% of the screen** | full width, a bar across the top |
| Content column | 166px | 358px |
| `/attendance` horizontal page scroll | **327px** | 0px |
| Navigation chrome (after the *second* fix) | 312px — **37% of the screen** | 72px — 8% |

The visible consequence was worse than the numbers: the ratio block, the one thing on the
page that has to be readable at a glance, wrapped "0 kaiako · 0 tamariki" over four lines.

The web app is designed for a desk or a wall-mounted tablet — a phone is the Expo app's
job — but "not the target surface" is not the same as "acceptable when broken", and a
manager will open this on a phone. Below 767px the rail becomes a bar and the nav wraps.
**No hamburger:** a disclosure widget hides eight destinations behind a tap and needs
state, a focus trap and an escape key, all to save vertical space on a surface that
scrolls anyway.

**The first fix was not enough, and the reasoning above was wrong.** Turning the rail into
a full-width bar removed the horizontal problem and created a vertical one: measured at
393×852, the bar was 312px, so **37% of the screen was navigation before any content
began**. Reported again from a real phone against production, which was serving the fix.

The "no hamburger" argument was wrong on two of its three claims. A focus trap and an
Escape handler belong to a **modal**; an inline expander needs neither — focus moves
through it in DOM order. And the vertical space was not a rounding error worth trading
away: on a phone, 37% is the whole first screenful. The nav is now collapsed behind one
44px `☰ Menu` control below 768px, with the identity line and the button on one row:
**312px → 72px, 37% → 8%**.

The toggle is hidden by CSS above the breakpoint rather than removed from the tree, so the
links exist at every viewport — which is also what keeps the role-based navigation
assertions in the e2e suite meaningful. `aria-expanded` and `aria-controls` on the button;
`☰` is paired with the word "Menu", because no control in this product is a bare symbol.

Both of the earlier assertions passed throughout that second defect. **A rail that spans
the viewport and does not overflow can still be useless**, so there is now a third
assertion on the criterion that actually matters to somebody holding the phone: content
must start within 160px, and opening the menu must reveal the links — otherwise a collapse
is just a way of hiding the navigation. Mutation-tested: leaving the menu expanded fails
with "content starts 253px down a 780px screen (32% is navigation)".

Two findings from the first fix, both worth more than that fix:

1. **An accessibility helper was causing the layout defect.** After the table itself was
   contained in a scroll container, 31px of horizontal page scroll remained. The cause was
   `.visually-hidden` — absolutely positioned, and with no positioned ancestor its
   containing block is the *page*, so the off-screen "Actions" label in the roll's table
   header sat at x=421 on a 390px viewport and stretched the document. `position: relative`
   on `.card` fixes it. Nobody looks for a layout bug inside a screen-reader affordance,
   which is exactly why it survived.
2. **The audit had a blind spot shaped like this bug.** `playwright.config.ts` sets a
   1440×900 viewport with a comment about auditing the app "as an operator sees it" — true,
   and it meant no check ever loaded a narrow one. Four assertions now cover it.

The new assertions were **mutation-tested**, because a passing first run means nothing:
setting `.card` back to `position: static` fails `/attendance` alone, and disabling the
breakpoint fails three, the rail check reporting "rail is 224px of a 390px viewport". Note
that the scroll-width checks alone were **not** enough — `/` never overflowed, it just had
166px of usable width — so there is a separate assertion that the content column actually
gets the screen. A regression test that only measures overflow would have called this
screen fine.

### RollRow, and why the roll stopped being a table

The roll was a `<table>` with Name / Age / Since / Flags / Actions columns. The pack folds
age and the flag chips into a line beneath the name, which leaves name, time and action —
a layout, not tabular data — and the pack calls these "lists" in its own screen
description. Two reasons the conversion was the right call rather than a cosmetic one:

- **A table whose rows are restyled as grids loses its row semantics in some engines.**
  Changing `display` on table elements is a known way to drop the implicit ARIA roles, so
  keeping the `<table>` and grid-styling the `<tr>` would have traded real semantics for
  a layout.
- There is no longer a column of comparable values under "Age" or "Flags" to line up.

Now `<ul class="roll">` with a `44px 1fr auto auto` grid per row, a 44px initials circle
on `surfaceSunken`, the name at 18/600, a 13/muted meta line carrying age and chips, the
time, and a 44px action. Below 767px it collapses to two columns with the time and action
tucked under the name.

`initials()` went into `@ece/core` beside `displayName()`, with a test, because the mobile
ChildCard and the child-detail header both need the same two letters. It deliberately does
**not** derive them from `displayName()`: that returns "Ana (Anahera) Test", whose first
two initials are "A" and "(", which is how a roll ends up with a bracket in a circle.

The FlagChip also moved to the pack's spec — 13/600 with 3px 10px padding, from 12/500.
12px is not a size this pack uses for anything a person is meant to read at a glance, and
"Allergy: peanuts" is the definitive example of something they are.

### An accessible name that broke a test, and would have broken find-in-page

The pack's annotation asks the roll action to be labelled with the child — "Sign Aroha
Ngata out" — because there are twenty otherwise identical buttons on the page. The first
attempt put the name in a `visually-hidden` span inside the button. That renders the same
accessible name, and it put the child's name into the DOM **twice per row**.

It failed immediately: a test asserting the child appears in the "Not here" region hit a
strict-mode violation on two matches. The lesson is not about the test. Anything matching
on text sees both copies — a find-in-page for a child's name now reports twice as many
hits as there are children, and on a roll of twenty that is not a cosmetic problem.

`aria-label` instead: one text node, same accessible name, and the visible "Sign out" is a
prefix of it, which is what WCAG 2.5.3 (Label in Name) asks for. Word order differs from
the pack's "Sign Aroha Ngata out" — "Sign out Aroha Ngata" keeps a stable prefix, which
both a human scanning and a role-based selector can rely on.

### Screen 6 — the child record, and why the order is the feature

The pack's instruction for this screen is not a style: *"Section order in the DOM is Health
→ Consents → Guardians / Enrolment → Custody. Health is above identity metadata because it
is the only block read under time pressure."* The record was previously Details → Health →
Whānau → Enrolment → Consent, which puts a form for editing a child's legal name above the
sentence saying what to do when they stop breathing.

It now reads: header → **Read this first** (the breach-tinted HealthCard, when there is an
anaphylaxis or severe condition) → Health → Consent → Whānau → Enrolment → Custody →
Details → Leaving. Consent sits above the family and enrolment blocks because it gates
whether a photo may exist at all — see [[consent-gated-media]].

**That ordering is now a tripwire in the e2e suite**, for the same reason the
unverified-ratio caveat is. It is invisible to every other check in this repo: the page
renders, axe passes and every test stays green with the sections in any order at all.
Mutation-tested — putting Details back on top fails with the whole order printed, which is
the message a future reader needs rather than "expected 7 to be greater than 2".

The header is the pack's: a 56px initials circle, the name at 28/600, a 13/muted line of
age · born · enrolled, and a right-aligned status chip. The chip is new information on this
screen and the pack is right to put it there — "is this child here" arrives at the same
moment as "what is this child allergic to", and the answer previously existed only on
`/attendance`.

That chip needed `listAttendanceToday()` on a page a **parent** loads, and `@ece/api`
contains no tenant filtering by design, so this was checked rather than assumed: the RLS
suite already asserts *"and cannot read another family's attendance either"*, so the
`attendance_events` policy keys on guardianship and not merely on `centre_id`. Had it
keyed on the centre, this one-line addition would have been the exact defect [[tenancy-and-rls]]
warns about.

The custody empty state takes the pack's wording — "No court order recorded." with
"Visible to kaiako and managers only." — on sunken. On this one panel the absence is the
fact somebody came to check, and a generic "Nothing recorded." leaves them unsure whether
they looked in the right place.

### Screens 8 and 12 — the mobile surface starts

Mobile was already closer to the pack than web had been, because the token file it reads is
the pack's: 56px fields, a 64px primary, `radius.md` on controls, and one error string were
all in place. Three things were not.

**Screen 8, sign-in.** "Nau mai" at 36/600 — the pack's mobile display size, against 28 on
web — over "Sign in to your centre." at 17. The heading was "Sign in" at 28 and the subtitle
was the word "ECE", which is a product name where the pack asks for an instruction.

The failure state was red text on the page background and is now a 10-radius `breachSoft`
block with a 17/500 line. The reason is the room rather than the mockup: this is read
standing up, often in poor light, and a colour change on a thin glyph of text is the first
thing to disappear. It keeps `accessibilityRole="alert"`.

**Screen 12, empty states.** All three were a single line of muted 15px text, which reads as
a fault rather than as "nothing has happened yet". They now use one shared `EmptyState` —
18/600 line of state, one warm sentence at 17/muted, and **at most one action**, which is
the pack's rule and worth keeping: an empty screen with three buttons asks somebody who has
just arrived to make a decision they have no basis for.

- No tamariki linked → "Your centre links your child to your account." + "Message the
  centre". The old copy buried whose job it was behind "ask them if this looks wrong", which
  invites a parent to worry before telling them the process is normal.
- Nothing posted → no action at all, deliberately. Nothing a parent can do makes kaiako
  post, and a button would imply otherwise.
- No centre yet → "Nau mai. No centre yet." + "Check again", wired to the provider's
  `retry()`. The thing that changes the answer happens on somebody else's device and there
  is no push for it, so a real refresh is the difference between a waiting room and a dead
  end.

`EmptyState` is shared rather than inlined three times because these are the screens a
parent meets on their first day and on a quiet Tuesday, and they should read as the same
product.

### Screen 9 — the staff roll, and one target the pack gets wrong

The roll's three pieces now match the pack's anatomy, and two of the changes are about the
room rather than the mockup.

**The action moved inside the card.** It had been a separate block *below* each card, which
cost a row of vertical space per child and — worse — put each button nearer the *next*
child's name than to its own. On a roll of twenty, tapped in a hurry at 8am, that is a
mis-tap waiting to happen, and a mis-tap here writes an attendance time that decides funded
hours. The card is now the pack's row: 48px initials, name at 17/600, chip row, action.

**Connectivity left the ratio block.** "Offline" and "3 to send" were chips inside it, which
made two unrelated conditions look like one. `OfflineStrip` is now its own element above the
list, in pending-blue — never amber, because a queued write in a concrete-walled centre is
normal and amber here trains educators to ignore amber. What stays in the ratio block is the
one sentence tying them together: *"Includes 3 not yet sent to the office."* An educator
reading "within ratio" has to know whether that count includes the children they signed in
with no signal. It does.

The RatioCard picked up the pack's 28/600 counts, 17/500 detail, 16px radius and 12px track,
with the track hidden from the accessibility tree because the lines above it say the same
thing in words.

**Where the pack is not followed: the 88×56 roll action.** The pack specifies 88×56 for
mobile roll row actions, and this app keeps 64px height. The pack's own principle is the
reason — "mobile targets are 56px, primaries 64px… measured against one-handed use while
carrying a child". Sign-in *is* this app's primary action; it is the reason the app is
opened. Treating it as a secondary control and shrinking it by 8px to match a mockup is a
usability regression dressed as fidelity. Width stays at 120 rather than 88 for the same
reason.

**No pulse on the strip.** The pack gives the *web* tablet strip a 2s opacity pulse,
disabled under reduced motion. Not reproduced: the same pack argues a queued write is an
ordinary state, and a pulsing element is how a screen says "attend to me now". Animating it
would contradict the reason it is blue, and it would need an `AccessibilityInfo`
reduced-motion listener to be honest about vestibular disorders — for a decoration nobody
asked for.

**A gap found on the way, worth recording:** the mobile workspace has **no test runner**.
The strip's wording is the thing an educator reads to decide whether to trust the ratio, and
it cannot be unit-tested here. `npm test` covers `@ece/core`, `@ece/api` and `@ece/web`
only, and nothing in the checklist says otherwise, so this is easy to miss. The function is
deliberately left unexported rather than exported with a comment implying a test exists.

Two React Native traps, both caught by `typecheck` only because it was run:
`accessibilityRole="status"` is a **web** ARIA value and does not exist in RN (the roles list
has `summary`, which is what RatioBar already used), and `accessibilityElementsHidden` is not
valid on `Text`. A glyph is kept out of the accessible name with `accessibilityLabel`
instead.

### Deviations so far

| Screen | Deviation | Why |
|---|---|---|
| 1 — Login | Footnote reworded; a link to `/forgot-password` added | The handoff's stated recovery path cannot work; see above |
| 1 — Login | Footnote set at 15px per the README, not the 13px in the HTML board | README is declared authoritative, HTML corroborative. Flagged because the two disagree |
| 7 — No-access | "Sign out" kept alongside "Check again" | Already there, and a person on the wrong account otherwise has no way off this screen |
| 2/3 — Ratio track | Fill is occupancy toward the limit, with a caption that says so, not "% of the adults recorded" | The pack's caption does not describe its own bar; see above |
| 2 — Ratio counts | Counts in ink, detail line in the state colour | As the board renders it; the README does not say which |
| 2 — Main column | The pack's 28px/32px padding applied, but no `gap: 20px` on the column | Every page under `(app)` uses `.section` margins; adding a gap as well would double-space all of them. A separate pass, or not at all |
| 2 — RollRow | No room name in the meta line ("3 yrs · Kōwhai room") | There is no rooms concept in the schema. Adding one is a feature, not a restyle |
| 2 — RollRow | Action labelled "Sign out {name}", not "Sign {name} out" | A stable prefix that a human scanning and a role selector can both rely on; see above |
| 2 — RollRow | An "under 2" chip in the meta line, which the pack's anatomy does not list | The age text implies it, but the under-2 band is the regulated divide and was already explicit here. Removing information from a compliance screen needs a better reason than tidiness |
| — | The rail's phone behaviour (collapse behind `☰ Menu`) is not in the pack at all | The pack has no phone-width web surface. See the section above |
| 6 — Child record | Sections remain separate cards, not one 760px card containing all of them | The column is constrained to 760px, but merging seven panels into a single card is a rewrite of every panel, and the section eyebrows are what carry the structure |
| 6 — Health | The editable conditions table is unchanged; only the critical block is a HealthCard | Converting the table means reworking its add / resolve / medication forms. The block read under pressure is the one that mattered first |
| 6 — Header | No room name in the meta line | No rooms concept in the schema, as on the roll |
| 8 — Sign-in | Footnote does not say "no password reset"; it points at the browser | Reset exists, and re-invitation cannot recover a password. Same call as web |
| 9 — Roll action | 64px tall and 120px wide, not the pack's 88×56 | Sign-in is this app's primary action. The pack's own rule reserves 64 for primaries; shrinking the most-tapped control to match a mockup is a regression dressed as fidelity |
| 9 — OfflineStrip | No 2s opacity pulse | The pack specifies it for the *web* tablet strip. A pulse contradicts the reason the strip is blue, and would need a reduced-motion listener for a decoration |
| 9 — Roll header | Centre name where the pack has a room name | No rooms concept in the schema |
| 12 — Empty states | The "Message the centre" action relies on React Navigation bubbling an unmatched route to the parent tab navigator | `useNavigation` is hand-typed here with only `navigate`. Documented behaviour, but **unverified on a device** like everything else in this app |

### Not yet applied

Screens 4, 5, 10, 11 and 13 are **not** done:

- **4 (offline roll) and 5 (sign-out refusal) are not purely visual.** The offline outbox is a
  mobile capability; the web app has no local queue, so these two screens need the queue on web
  before they can be built at all. The pack shows them because the web app also runs on a
  wall-mounted tablet. The sign-out refusal logic already exists in `@ece/core` — see
  `signOut.test.ts` — so it is the web queue that is missing, not the decision.
- **10 and 11** are the remaining mobile anatomy: the whānau child detail with its 56×32
  consent switches and its **absent** custody heading, and the pānui feed where a withdrawn
  photo consent must render nothing at all — no placeholder, no notice, nothing announced.
- **13**, the three-metre tablet proof, is a web concern and needs the ratio block sized so
  its status line subtends the same angle at 3m as 15px body text does at 40cm.
The mobile surface shares tokens and vocabulary with web and deliberately shares no
components. See [[mobile-app]].

Nothing on this page should be read as claiming the product now looks like the board.

## See Also

- [[password-recovery]] — the refused constraint, and the measurement behind it
- [[conventions]] — the token generation rule, and the fixture timezone trap found here
- [[unverified-claims]] — the unchecked product name
- [[mobile-app]] — why the mobile screens are a separate surface sharing only tokens

*Last updated: 2026-08-06 (screens 1, 2, 3, 6, 7's no-access half, 8, 9 and 12)*
