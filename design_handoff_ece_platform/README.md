# Handoff: Doorway — staff web & whānau/kaiako mobile

Product working name: **Doorway**. It names the moment the product serves — a child
handed from whānau to kaiako at the door — and the ratio limit you do not cross.
The name has **not** been trademark- or domain-checked; do that before anything is
cut for the app stores.

## Master prompt (paste this into Claude Code first)

> You are implementing a shipped-token design pack for an ECE (early childhood
> education) platform serving New Zealand childcare centres, working name
> **Doorway**. Read `design_handoff_ece_platform/README.md` in full, then open
> `ECE Platform.dc.html` (screens) and `Brand and App Assets.dc.html` (identity,
> icons, store assets) in a browser as the visual references.
>
> The HTML file is a **design reference**, not production code. Recreate these
> screens in this repository's existing environment (Next.js for web, React
> Native/Expo for mobile) using its established components, routing and data
> layer. Do not copy the HTML, do not introduce a CSS framework the repo does
> not already use, and do not add npm dependencies for anything the repo can
> already do.
>
> Hard constraints, in priority order:
> 1. **Do not invent colours.** Every colour must come from the token table in
>    the README. Every fg/bg text pair must hold WCAG 2.2 AA 4.5:1.
> 2. **Every state is icon + text label, never colour alone** (WCAG 1.4.1).
>    No bare dots, no colour-only chips, no `title` attributes carrying meaning.
> 3. **Do not soften the safety decisions.** The single login error string, the
>    absent custody section on the whānau build, and the sign-out refusal with
>    no "sign out anyway" are load-bearing. If they look like UX debt, they are
>    not — leave them.
> 4. **Do not add features.** No incidents, no daily notes, no payments, no new
>    routes. The route list in the README is complete.
> 5. **Pending sync is blue (#2f5d8a/#e9f0f7), never amber.** A queued offline
>    write is a normal state.
> 6. Touch targets: 44px minimum, 56px comfortable, 64px primary on mobile.
> 7. Correct macrons everywhere: whānau, tamariki, kaiako, pānui, tamaiti.
> 8. **The mark is two shapes — a circle and a bar.** Do not redraw it, add a
>    gradient or shadow, rotate it, or recolour it to a state colour. Do not add
>    a koru or any Māori motif: the macrons in the copy are correct usage,
>    borrowed iconography without mandate is not.
>
> Work screen by screen in the order listed under "Screens / Views". After each
> screen, list any place where the repo's existing components forced a
> deviation from this spec, and why.

## Overview
A platform for NZ childcare centres with two surfaces on one token set:

- **Web (Next.js)** — managers and kaiako at a desk or on a wall-mounted tablet.
  Density-first. Routes: Login · Overview · Children (list + detail) · Posts
  (pānui) · Messages · Attendance (roll + ratio) · People/invitations ·
  Compliance · Funding · Settings · No-access.
- **Mobile (React Native / Expo)** — one binary, role-aware. Staff tabs:
  Roll · Pānui · Messages · Settings. Whānau tabs: Tamariki · Pānui · Messages ·
  Settings. Plus Sign-in, No-access, and a Centre picker shown only when a user
  has more than one membership.

Whānau see only their own tamariki: attendance, health (read-only), consents
(recordable), the pānui feed, and messages with the centre.

Everything on the tablet works offline. Queued writes are a normal state and are
rendered in pending-blue, not as an error.

## About the design files
`ECE Platform.dc.html` is a **design reference created in HTML** — a prototype
showing intended look, copy and behaviour. It is not production code and should
not be copied into the app. The task is to recreate these designs inside the
target codebase's existing environment, using its established patterns,
component library, routing and state layer. Where this repo already has a
primitive (Button, Card, Chip), extend it rather than writing a parallel one.

## Fidelity
**High fidelity.** Colours, type sizes, weights, spacing, radii and target sizes
below are exact and already contrast-tested in CI. Copy strings are final — use
them verbatim, including the macrons. Layout proportions are intentional and
should be matched closely; the two surfaces deliberately do **not** share
components, only tokens and vocabulary.

## Design tokens

### Surfaces
| Token | Hex |
|---|---|
| bg | #faf9f7 |
| card | #ffffff |
| sunken | #f2f1ee |
| hairline | #e3e1dd |

### Text & accent
| Token | Hex |
|---|---|
| ink | #1b1a18 |
| muted | #605d58 |
| inverse | #ffffff |
| brand green | #2f6f4f |
| brand green hover | #25583f |
| brand green soft | #e8f1ec |

### State pairs (fg / bg) — the most important tokens in the product
| State | fg | bg | Glyph | Label |
|---|---|---|---|---|
| ok | #2f6f4f | #e8f1ec | ✓ | "Within ratio" |
| warn | #8a5a00 | #fdf3e0 | ▲ | "At limit" |
| breach | #a3341c | #fbeae5 | ▲ | "Ratio breach" |
| pending sync | #2f5d8a | #e9f0f7 | ↻ | "Waiting to send" |

Supporting borders used on tinted blocks: ok #cfe2d7, warn #ecd9ae,
breach #eccabe, pending #d3e0ed.

Pending-sync is neutral blue **on purpose**. A queued offline write is normal
and must not borrow the warning colour, or educators learn to ignore amber.

### Type
Scale: 12 / 13 / 15 (web body) / 17 (mobile body) / 18 / 22 / 28 / 36.
Weights: 400 / 500 / 600 only. Mobile body is 17 because it is read at arm's
length, standing. Font in the reference is the system sans stack
(`-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`); use the
repo's existing family if one is already set.

Section eyebrows: 12px, weight 600, uppercase, letter-spacing .12em, muted.

### Spacing, radii, shadow, motion
Spacing 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
Radii 6 (web controls) / 10 (web cards, mobile controls) / 16 (mobile cards,
dialogs) / pill (999px, chips).
Shadows near-flat — the only one used is `0 1px 2px rgba(27,26,24,.06)` on the
modal dialog.
Motion 120 / 180 / 260ms, `cubic-bezier(0.2,0,0,1)`. Everything honours
`prefers-reduced-motion: reduce` (the offline chip's 2s opacity pulse must stop).

### Touch targets
44px minimum · 56px comfortable · 64px primary. The mobile sign-in submit is
64px because it is tapped by someone holding a child on one hip. Mobile roll
row actions are 88×56.

## Vocabulary (UI copy, macrons required)
whānau (family) · tamariki (children, singular tamaiti) · kaiako (educator) ·
pānui (notice/announcement) · nau mai (welcome). These are ordinary sector
words, not decoration. Room names in the reference data: Pēpi, Kōwhai, Rātā.

## Component inventory — Web (desk density)

| Name | Anatomy | States |
|---|---|---|
| RatioBlock | status pill + count headline (22/600) + requirement line + proportional track (14px, pill) + consequence line | ok · at limit · breach · unknown (no adult count recorded) |
| RollRow | 44px initials circle (#f2f1ee bg, 15/600 muted) · name 18/600 · flag chips · time 13/muted · 44px action button | in · out · queued · flagged · queued+flagged |
| FlagChip | glyph + full sentence label, pill radius, 13/600, padding 3px 10px | allergy (breach) · medication (warn) · dietary (warn) |
| SyncChip | ↻ + "Waiting to send", pending-blue | queued · sending · sent (chip is removed, not greyed) |
| RefusalDialog | count pill · title 22/600 · reason · itemised list on sunken · retry (48px, green) + stay (44px, outline) | unsent attendance · unsent consents |
| ConsentRow | label 15/500 + provenance line 13/muted + status chip or Record button (44px) | given · withdrawn · never recorded |
| SectionEmpty | one line of state 18/600, one warm sentence 15/muted, one action | new centre · no results · no access |
| ExpiryRow (compliance) | name · document · date · status chip | current · expires <30d (warn) · expired (breach) · unsighted |

## Component inventory — Mobile (in the room, one-handed)

| Name | Anatomy | States |
|---|---|---|
| RatioCard | 16-radius block, pill (15/600), counts 28/600, detail 17/500, full-width 12px track | ok · at limit · breach |
| ChildCard | 48px initials · name 17/600 · chip row · 88×56 action button | in · out · queued · flagged |
| OfflineStrip | ↻ + count sentence, pending-blue, 10-radius, sits above the list, never over it | offline · sending · hidden |
| BigAction | 64px primary / 56px secondary, 10-radius, full width, 17/600 | default · pressed · disabled-with-reason |
| ConsentSwitch | label 17/500 + provenance 15/muted + 56×32 switch inside a 56px row | on · off · saving (queued) |
| HealthCard | glyph + heading 17/600 + detail 15, read-only for whānau | allergy · medication · none recorded |
| PostCard | author + time 15/muted · optional image · body 17/400 | text only · with photo · **photo consent withdrawn (image node absent)** |
| TabBar | 4 tabs, role-swapped labels, 64px bar, current tab filled glyph + green + weight 600 | staff (Roll · Pānui · Messages · Settings) · whānau (Tamariki · Pānui · Messages · Settings) |

## Screens / Views

### 1. Web — Login
**Purpose:** email + password only. No sign-up, no forgot-password; access comes
from a centre invitation.
**Layout:** single column, max 520px, padding 56px 48px, gap 24px, on bg.
**Components:** "Nau mai" 28/600 · "Sign in to your centre." 15/muted · Email
and Password fields (44px, radius 6, 1px #e3e1dd, 15px text, label 13/600) ·
submit 48px green full-width · footnote 15/muted: "Access to a centre comes from
an invitation. There is no sign-up and no password reset here — ask your centre
to re-invite you."

**Failure state:** an alert block above the fields, #a3341c on #fbeae5, radius 6,
padding 12px 14px, glyph ▲ + **"Those details are not right."** Field borders
become #a3341c. Focus moves to the alert.

**This exact string is used for every cause** — unknown email, wrong password,
disabled account, locked account. Distinguishing them would let a stranger
enumerate who works at a named childcare centre.

### 2. Web — Roll / Attendance (default, within ratio)
**Layout:** 1280px shell. Sidebar 224px (card bg, 1px right hairline, padding
20px 16px) with centre name 15/600, role pill, nav items 15px / 9px 10px /
radius 6 (current: #e8f1ec bg, #2f6f4f, weight 600), then "Switch centre" link
and a 44px outline Sign out pinned to the bottom. Main padding 28px 32px,
gap 20px.
**Header:** "Attendance" 28/600 + date/sync line 13/muted; right: "Record adult
count" (44px outline) and "Sign a child in" (44px green).
**RatioBlock (ok):** #e8f1ec on #cfe2d7 border, radius 10, padding 18px 20px.
White pill "✓ Within ratio" 15/600 green · "4 kaiako · 17 tamariki" 22/600 ·
"3 under 2 · 14 aged 2 and over · requires 4" 15/500 green · 14px white track
with an 88% green fill · "88% of the adults recorded today. Headroom for 2 more
tamariki aged 2+." 13/green.
**Lists:** "HERE NOW — 17" and "NOT HERE — 6" eyebrows over card-bg lists.
Rows are `grid-template-columns: 44px 1fr auto auto`, gap 16, padding 14px 18px,
separated by 1px hairlines. Flag chips sit under the name.

### 3. Web — Ratio bar, at-limit and breach
**At limit:** #8a5a00 on #fdf3e0 / border #ecd9ae. Pill "▲ At limit",
"4 kaiako · 20 tamariki", "requires 4 · no headroom", 100% track,
"One more child signed in puts this centre out of ratio."
**Breach:** #a3341c on #fbeae5 / border #eccabe. Pill "▲ Ratio breach",
"3 kaiako · 20 tamariki", "requires 4 — 1 adult short", a full track **plus a
detached 56px overflow segment at 45% opacity**, "Recorded at 10:22 am. This
appears in Compliance → ratio history."
The bar never appears without its sentence: colour is the second signal.

### 4. Web — Roll offline with three queued sign-ins
A pending-blue strip at the top of the list: white pill "↻ Offline" (2s opacity
pulse, disabled under reduced-motion) + "3 sign-ins are saved on this device and
will send when the centre is back online." Three rows carry a
"↻ Waiting to send" chip; an already-sent row shows "Sent 8:40 am" in muted and
no chip.

### 5. Web — Sign-out refusal
Modal, radius 16, padding 24, gap 16, shadow 0 1px 2px rgba(27,26,24,.06).
Pending pill "↻ 3 records not sent" · "You can't sign out yet" 22/600 ·
"Three sign-ins from this morning are still saved only on this tablet. Signing
out clears them, and attendance is what the funding return is built from." ·
sunken list of the three names and times · **"Try sending now"** 48px green ·
**"Stay signed in"** 44px outline.

There is deliberately **no "sign out anyway"**. Esc resolves to "Stay signed
in". The count is always named.

### 6. Web — Child detail (kaiako / manager)
760px card, padding 28px 32px, gap 24.
Header: 56px initials · name 28/600 · "3 yrs 2 mths · Kōwhai room · enrolled
4 Feb 2025" 13/muted · right-aligned "✓ Signed in 8:12 am" chip.
Section order in the DOM is **Health → Consents → Guardians / Enrolment →
Custody**. Health is above identity metadata because it is the only block read
under time pressure.
- **Health:** breach-tinted block "Allergy: peanuts" 15/600 + "Anaphylaxis.
  EpiPen in the Kōwhai room cabinet, expires 11/2026."; warn-tinted
  "Medication: Ventolin, as needed" + last-given provenance.
- **Consents:** bordered list. "Photos in the pānui feed" — "Withdrawn by Mere
  Ngata, 28 July 2026" + "✕ Withdrawn" chip on sunken. "Sunscreen" — "Given
  4 Feb 2025" + "✓ Given". "Excursions in the local area" — "Never recorded" +
  44px Record button.
- **Guardians / Enrolment:** two columns, 15/1.7.
- **Custody:** sunken block, "No court order recorded." + "Visible to kaiako and
  managers only." 13/muted. **This section exists on web only.**

### 7. Web — Empty roll and No-access
Empty roll: "Nobody is enrolled yet." 18/600 · "Enrol your first tamaiti and the
roll starts here tomorrow morning." · 48px green "Enrol a child".
No-access: "You're signed in. No centre yet." · "When your centre accepts you,
it will appear here — nothing else is needed from you." · 44px outline "Check
again". This is a waiting room, not an error — no red, no error iconography.

### 8. Mobile — Sign-in (390×780 frame)
"Nau mai" 36/600 · "Sign in to your centre." 17/muted · fields 56px, radius 10,
17px text · submit **64px** green · footnote "Your centre invites you. There is
no sign-up here, and no password reset — ask your centre to send a new
invitation."
Failure: the same single string in a 10-radius breach block, 17/500, role=alert.

### 9. Mobile — Staff Roll (breach + offline)
Header "Roll" 28/600 + room name 13/muted. RatioCard (breach) with pill 15/600,
counts 28/600, "Requires 4 — one adult short." 17/500, 12px track. OfflineStrip
"Offline · 3 sign-ins waiting to send" 15/#2f5d8a. ChildCards: 48px initials,
17/600 name, chip row (allergy + waiting), 88×56 action — outline "Sign out" for
present children, green "Sign in" for "Not here". TabBar 4 tabs, Roll current.

### 10. Mobile — Whānau child detail
56px initials + "Aroha" 28/600 + "Kōwhai room · 3 yrs".
Green block "✓ Signed in at 8:12 am today" 17/500.
"HEALTH · READ-ONLY" eyebrow → breach card "Allergy: peanuts" + "Anaphylaxis ·
EpiPen held at the centre" + "Message the centre to change anything here."
"CONSENTS · YOU CAN CHANGE THESE" eyebrow → two rows with 56×32 switches
(off = #e3e1dd, on = #2f6f4f, 26px white knob).
TabBar with the whānau labels, Tamariki current.

**There is no Custody heading anywhere in the whānau build.** It is not
hidden-if-empty — it does not exist in that build. An empty custody section on a
parent's phone discloses by absence, either that an order exists or that one
does not, and neither is ours to say.

### 11. Mobile — Pānui feed, withdrawn photo consent
Three PostCards. The middle one has a photo; the first has none. A post whose
photo consent was withdrawn **renders nothing where the image would be** — no
placeholder, no broken image, no "photo removed" notice, no alt text, nothing
announced. It is indistinguishable from a text-only post. A notice is itself a
disclosure; absence is the correct rendering.

### 12. Mobile — Empty states
"No tamariki linked yet" / "Your centre links your child to your account." /
56px green "Message the centre".
"Nothing posted yet" / "Kaiako share moments from the day here." / no action.
"Nau mai. No centre yet." / "Your invitation is still to be accepted by your
centre." / 56px outline "Check again".
Warm, one sentence, at most one action.

### 13. Tablet at three metres
11″ landscape, wall-mounted by the door, ink bezel (#1b1a18, radius 24,
padding 18). The ratio block is sized so its status line subtends the same angle
at 3 m as 15px body text does at 40 cm — about 112px of cap height on a 10.5″
panel. In the reference: pill 44/600, counts 88/600, detail 44/500, track 32px,
two 112px action buttons ("Sign a child in" green, "Sign a child out" outline)
at 32/600.
The reference includes the same panel at 13% scale as the retinal-size proof;
state, both numbers and the bar remain separable. Words survive because they are
set at the same weight as the numerals.

## Interactions & behaviour
- **Ratio recalculation** runs on every sign-in, sign-out and adult-count change;
  the RatioBlock is a persistent `role=status aria-live=polite` region, never a
  toast. The condition persists until an adult arrives or a child leaves.
- **Offline queue:** writes are optimistic and appended to a local queue. The row
  shows the SyncChip until acknowledged, then the chip is removed (not greyed).
  Retry is automatic on reconnect and manual from the refusal dialog.
- **Sign-out** checks the queue first. Non-empty → RefusalDialog, focus trapped,
  initial focus on "Try sending now", Esc → "Stay signed in".
- **Login** always returns the same error string and the same response timing for
  every failure cause. Do not vary the delay.
- **Consent withdrawal** must cause existing feed images of that child to stop
  being emitted server-side, not merely hidden client-side.
- **Transitions:** 120ms for chip and hover changes, 180ms for row and card
  state, 260ms for dialog entry; `cubic-bezier(0.2,0,0,1)`; all disabled under
  `prefers-reduced-motion`.

## State management
- `session` — user, memberships[]; drives no-access, the centre picker (shown
  only when memberships.length > 1) and the role-aware tab set.
- `role` — owner | manager | educator | parent. Gates routes, not just UI.
  The whānau build must not receive custody data over the wire.
- `roll` — { childId, status: in|out, at, queued: bool }[] plus adultCount.
- `ratio` — derived: { requiredAdults, actualAdults, under2, over2,
  state: ok|limit|breach }.
- `syncQueue` — pending mutations with kind, payload, createdAt; count drives
  the offline strip and the refusal dialog.
- `connectivity` — online | offline | sending.
- Persist `roll` and `syncQueue` to device storage; they must survive an app
  restart on the tablet.

## Accessibility annotations
- Login email: role=textbox, label "Email", 44px (56 mobile),
  autocomplete=username. Password: same, autocomplete=current-password.
  Submit: role=button "Sign in", 48px web / 64px mobile.
  Error: role=alert, receives focus, meaning carried in text.
- RatioBlock: role=status, aria-live=polite. Announced as
  "Ratio breach. 3 kaiako, 20 tamariki, requires 4, 1 adult short." The track is
  aria-hidden — it duplicates the sentence.
- Roll action: role=button, label "Sign Aroha Ngata out", 44px web / 88×56
  mobile.
- Health flags: role=note, read as words — "Allergy: peanuts. Anaphylaxis…" —
  never a bare dot, never colour alone, never a title attribute.
- SyncChip: a real text node, announced as "Waiting to send".
- RefusalDialog: role=dialog, aria-modal=true, labelled by its heading, focus
  trapped, initial focus on the 48px primary.
- ConsentRow / ConsentSwitch: role=switch, aria-checked, label is the consent
  name; 44px web row, 56px mobile row.
- Nav: current item carries aria-current="page"; mobile tabs role=tab with
  aria-selected plus a filled glyph, 64px bar.
- Withdrawn photo: nothing rendered and nothing announced.
- All fg/bg pairs above are AA 4.5:1 and are contrast-tested in CI. Do not
  introduce new pairs.

## Departures from the common pattern (and why)
1. **Pending sync is blue, not amber.** A queued write in a concrete-walled
   centre is normal, not a fault. Amber would train educators to ignore amber.
2. **Sign-out refuses; there is no "sign out anyway".** Attendance is the source
   of the funding return, and a destructive escape hatch on a control tapped
   dozens of times a day will eventually be tapped by accident.
3. **One login error string.** "No such account" at a named childcare centre is a
   staff-enumeration oracle. The cost is one confused password reset; the
   alternative is a roster leak.
4. **Whānau child detail has no custody heading.** Rendering an empty section
   discloses by absence.
5. **Flags are chips with sentences, never dots.** "Allergy: peanuts" reads
   identically to a screen reader, a colour-blind kaiako, and a relief teacher
   who has never met the child.
6. **A withdrawn photo renders nothing.** A "photo removed" notice is itself a
   disclosure.
7. **The ratio block is a persistent region, not a toast.** Toasts expire;
   breaches do not.
8. **Mobile targets are 56px, primaries 64px.** Measured against one-handed use
   while carrying a child; 44px is the floor for secondary controls only.

None of these are UX debt. If a reviewer asks for them to be "fixed", point them
at this list.

## Brand and platform assets

Full specification and visual reference: `Brand and App Assets.dc.html`.

### The mark
Two primitive shapes on a rounded square, so it survives a 16px favicon and a
monochrome Android themed icon.

Geometry, as a percentage of the mark box:
- box: corner radius 22%
- head: circle, diameter 30%, left 35%, top 20%
- bar: rect, width 56%, height 18%, left 22%, top 58%, radius pill

SVG source:

```svg
<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="28" fill="#2f6f4f"/>
  <circle cx="64" cy="45" r="19" fill="#fff"/>
  <rect x="28" y="74" width="72" height="23" rx="11.5" fill="#fff"/>
</svg>
```

Reversed: white box, #2f6f4f shapes. Mono: #1b1a18 box, white shapes.

### Wordmark
"Doorway" in the system sans (Helvetica Neue / -apple-system), weight 600,
tracking −0.015em, ink #1b1a18 or #ffffff reversed. No custom lettering — a
centre must be able to reproduce it in a Word document.

### Lockups
- Horizontal (primary): mark + 16px gap + wordmark, wordmark at 36px when the
  mark is 64px.
- Stacked (splash, print): mark 80px over wordmark 28px, 14px gap, centred.
- Reversed on #2f6f4f, and one-colour mono on #1b1a18.
- Clear space: 25% of the mark height on all four sides.
- Minimum size: 24px on screen, 8mm in print. Below 24px use the mark alone;
  the wordmark is never set under 14px.

### App icons
- **iOS**: 1024×1024 PNG, no alpha, no pre-applied corner radius (iOS masks it).
  Dark variant on #1b1a18; tinted variant is the white shapes on transparent.
- **Android adaptive**: foreground = the two white shapes drawn at 61% of the
  432×432 canvas so no OEM mask clips them; background = flat #2f6f4f. No
  shadow, no gradient in either layer. Safe zone 264dp of 432dp.
- **Android themed/monochrome**: single-colour foreground on transparent; the
  launcher recolours it. This is why the mark is two solid shapes, not a scene.
- **Play Store icon**: 512×512 32-bit PNG.
- **Favicon**: SVG plus 32px and 180px (apple-touch-icon) PNG fallbacks.
  `theme-color` #2f6f4f, `background-color` #faf9f7.
- **Web manifest**: 192, 512 and 512-maskable.

### Splash
Static — no animation, no spinner. Stacked lockup centred on #faf9f7,
`resizeMode: contain`, with "Nau mai" 15px muted near the bottom. Dark variant
is the same lockup on #1b1a18.

### Store listing
- **Play feature graphic** 1024×500: flat #2f6f4f, reversed lockup, headline
  "Sign-in, ratios and pānui for New Zealand early childhood centres." 26/600
  white, subline "Works offline. Built for the room, not the office." in #cfe2d7.
  No device mockup inside it, no drop shadow; keep text inside the middle 80%
  because Play crops hard on small screens.
- **Screenshot template**: a caption band above the device frame, tinted with
  the soft end of the state pair the screen demonstrates (#e8f1ec, #e9f0f7,
  #f2f1ee). Caption 20/600 ink. Use real captures in the frame, never a redrawn
  approximation.
- Suggested captions: "Ratios you can read across the room" · "Sign-ins keep
  working when the wifi doesn't" · "Whānau see their own tamariki, and nothing
  else".
- **Never** put a photograph of a child in a store listing or any marketing
  without written, current consent from that child's whānau.

### Export checklist
iOS — AppIcon 1024 (no alpha), dark 1024, tinted 1024; splash 1×/2×/3×;
screenshots 6.9″ 1320×2868, 6.5″ 1284×2778, iPad 12.9″ 2048×2732.
Android — adaptive fg + bg 432×432 (safe 264), monochrome fg, Play icon
512×512, feature graphic 1024×500, phone shots 1080×1920 (2–8), 7″ and 10″
tablet sets.
Web — favicon.svg, icon-32.png, apple-touch-icon-180.png, manifest 192/512/512
maskable, og-image 1200×630, theme-color #2f6f4f.
Other — email header 600×72, tablet wall card A5, staff lanyard mark at 8mm.

### Do not
Gradient behind the mark · rotate, outline or shadow the mark · recolour the
mark to a state colour (breach red on a launcher icon is a lie) · set the
wordmark in a display or script face · use a child's photograph without current
written consent · use a koru, kōwhaiwhai or any Māori motif without mandate.

## Assets
The screen designs use no images, no icon font and no SVG illustration. State
glyphs are text characters: ✓ ▲ ↻ ✕ ● ◇. Substitute the repo's existing icon set
if it has one, keeping the accompanying text label in every case. Feed images
are shown as labelled placeholder blocks and should be replaced with real
uploads.

## Files
- `Brand and App Assets.dc.html` — the identity board: logo lockups, clear
  space, size floor, iOS / Android adaptive / themed icons, favicon set, splash,
  Play feature graphic, store screenshot template, export checklist, do-not list.
- `ECE Platform.dc.html` — the full design board: tokens, both component
  inventories, web login/roll/child-detail/empties, mobile sign-in/staff
  roll/whānau detail/pānui/empties, the 3 m tablet proof, accessibility notes
  and the rationale grid. Open it directly in a browser.
- `README.md` — this document. Self-sufficient; the HTML is corroboration.
- `screens/` — PNG captures of each board section:
  - `01-tokens.png` — the token set as rendered
  - `02-component-inventory.png` — both inventories
  - `03-web-screens.png` — login (default + failure), roll (default, at-limit,
    breach, offline), sign-out refusal, child detail, empty roll, no-access
  - `04-mobile-screens.png` — sign-in failure, staff roll (breach + offline),
    whānau child detail, pānui with the withdrawn photo, empty states
  - `05-tablet-3m.png` — the three-metre legibility proof
  - `06-rationale.png` — the departures grid
  - `07-logo.png` — logo lockups, clear space, mark at size
  - `08-app-icons.png` — iOS, Android adaptive, themed, favicon
  - `09-splash-and-store.png` — splash, feature graphic, screenshot template,
    do-not list
