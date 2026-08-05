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

### Deviations so far

| Screen | Deviation | Why |
|---|---|---|
| 1 — Login | Footnote reworded; a link to `/forgot-password` added | The handoff's stated recovery path cannot work; see above |
| 1 — Login | Footnote set at 15px per the README, not the 13px in the HTML board | README is declared authoritative, HTML corroborative. Flagged because the two disagree |
| 7 — No-access | "Sign out" kept alongside "Check again" | Already there, and a person on the wrong account otherwise has no way off this screen |

### Not yet applied

Screens 2–6 (roll, ratio states, offline roll, sign-out refusal, child detail) and 8–13 (all
mobile, plus the three-metre tablet proof) are **not** done. The RatioBlock, RollRow, FlagChip,
SyncChip and RefusalDialog inventories exist in the handoff and only partly in the repo — there
is no sign-out refusal dialog on web at all, though the core logic for it is in
`packages/core/src/__tests__/signOut.test.ts`. Nothing in this page should be read as claiming
the product now looks like the board.

## See Also

- [[password-recovery]] — the refused constraint, and the measurement behind it
- [[conventions]] — the token generation rule, and the fixture timezone trap found here
- [[unverified-claims]] — the unchecked product name
- [[mobile-app]] — why the mobile screens are a separate surface sharing only tokens

*Last updated: 2026-08-06*
