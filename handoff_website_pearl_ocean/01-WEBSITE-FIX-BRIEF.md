# Fix brief: Little Pearls website — visual system pass

Paste everything below into Claude Code, in the repo that serves
`little-pearls-production.up.railway.app`.

---

## Context

You are fixing the visual design system of the Little Pearls Educare Centre
website. Little Pearls is a not-for-profit, community-established ECE provider
with two Auckland centres (Ōwairaka / Mt Albert and Puketāpapa / Mt Roskill).

**The copy is good. Do not rewrite it** except where this brief names a specific
string. The problems are all in the visual system, and most of them are one
problem repeated across pages.

The centre app that whānau and kaiako sign into is called **Doorway**. Its design
tokens are already shipped and contrast-tested. The website must use the same
tokens so the two properties read as one organisation.

Work through the fixes in the order given. After each numbered fix, list the
files you changed and anything that blocked you.

---

## Tokens — the only colours allowed

Define these once, as CSS custom properties on `:root` (or extend the existing
theme file if one exists — do not create a second source of truth). Replace every
hard-coded hex in the codebase with a variable reference.

| Purpose | Variable | Hex |
|---|---|---|
| Page background | `--bg` | `#faf9f7` |
| Card | `--card` | `#ffffff` |
| Sunken / inset panel | `--sunken` | `#f2f1ee` |
| Hairline / border | `--hairline` | `#e3e1dd` |
| Body and heading text | `--ink` | `#1b1a18` |
| Secondary text | `--muted` | `#605d58` |
| Text on green | `--inverse` | `#ffffff` |
| Brand green | `--green` | `#2f6f4f` |
| Brand green hover | `--green-hover` | `#25583f` |
| Brand green soft (tint) | `--green-soft` | `#e8f1ec` |
| Green soft border | `--green-soft-border` | `#cfe2d7` |

Reserved, for genuine warnings and errors only — **never for marketing,
informational or editorial content**:

| Purpose | Variable | Hex |
|---|---|---|
| Warning text / bg | `--warn` / `--warn-bg` | `#8a5a00` / `#fdf3e0` |
| Error text / bg | `--error` / `--error-bg` | `#a3341c` / `#fbeae5` |

Every foreground/background text pair must hold WCAG 2.2 AA 4.5:1. Do not invent
new pairs. If you need a colour that is not in this table, stop and say so
instead of picking one.

**Delete the coral / salmon colour entirely.** Grep the codebase for it (it
renders around `#f8756b`–`#fa7268`; find the actual value) and remove the
declaration once every usage is migrated per fix 1.

---

## Fix 1 — Remove the coral banners (highest priority)

**Problem.** A saturated coral block is currently the loudest element on almost
every page, and it carries the *least* important information: opening hours,
"not sure which room", "already with us?". Saturated red-pink is alert styling.
A parent scanning the page sees alarm where a friendly nudge was intended. Black
text on that coral also almost certainly fails 4.5:1.

**Fix.** Convert every coral banner into a soft-green info panel:

- background `--green-soft`
- 1px border `--green-soft-border`
- text `--ink` for the sentence, `--green` for any bold lead-in
- border-radius 10px, padding 16px 20px
- links inside it: `--green`, underlined, `--green-hover` on hover

Known instances (search for more — fix all of them):
- Home, under "Where we are": "Weekdays, 7.30am to 6.00pm. Children 3 months to
  5 years. Come and see us — get in touch to arrange a visit."
- Rooms, after the Preschool photo: "Not sure which room your child would start
  in? Send an enquiry and we will tell you what is available."
- Enrolment, after "Hours and ages": "Already with us? Families and kaiako can
  sign in to the centre app. Access comes from the centre inviting you — there is
  no sign-up."

Then verify no coral remains anywhere, including hover states, focus rings and
the mobile breakpoints.

---

## Fix 2 — One accent colour

**Problem.** Green buttons, coral banners and the pink logo are three accents
competing on one page.

**Fix.** Green is the only accent in the interface. The pink in the logo is the
single permitted exception and is never recoloured. Ensure no interface element
picks up a pink or coral tint from the logo, and never place the logo
immediately adjacent to a large tinted block.

---

## Fix 3 — Stop styling editorial states as errors

**Problem.** Two panels use error styling — tinted box, red left border, bold red
text — for entirely normal editorial states:

- Enrolment → Fees: "**Our fees are not published on this page yet.**"
- Careers: "**Current vacancies are not listed here yet.**"

Bold red text reads as a fault in the site, or worse, as bad news about the
organisation.

**Fix.** Restyle both as a neutral inset panel: background `--sunken`, no
coloured left border, all text `--ink` and `--muted`, radius 10px, padding
16px 20px. Then reorder each so the offer leads and the absence follows:

- Fees → "**Ask us and we will send you the current fee schedule**, including
  what is included and any funding you may be entitled to. We publish it on
  request rather than on this page, so the figure you get is always accurate."
- Careers → "**Send an application any time** — we will tell you what is open at
  each centre. We do not keep a vacancy list on this page."

Do not use `--error` or `--warn` on either. Reserve those for real form
validation failures.

---

## Fix 4 — Fix the page measure and the empty right half

**Problem.** Philosophy, Rooms, Enrolment, Careers and Contact all render as a
narrow left-hugging column (roughly a 480px measure) inside a 1400px viewport,
leaving half the screen empty. It reads as an unfinished template.

**Fix.** Introduce one shared page layout and apply it to every content page:

- Content container: `max-width: 720px` for prose, centred in the viewport, with
  `padding-inline: 24px` (16px below 640px).
- Line length for body copy: 60–75 characters. Do not exceed it by widening the
  column.
- Where a page has a natural aside, use a two-column grid at ≥1024px:
  `grid-template-columns: minmax(0, 1fr) 320px; gap: 48px`, collapsing to one
  column below 1024px. Use the aside for the centre contact card (Enrolment,
  Contact) or the room photo (Rooms) — not for repeated navigation.
- Vertical rhythm from the spacing scale only: 4 / 8 / 12 / 16 / 24 / 32 / 48 /
  64. Section gap 48px desktop, 32px mobile.

Check every page at 1440, 1024, 768 and 390px wide.

---

## Fix 5 — Stop duplicating the centre details

**Problem.** The three-column footer repeats both centres' full address, phone
and email on every page. The Contact page then repeats the same details in its
body, producing **two identical `<h2>` headings per centre**. A screen-reader
user navigating by heading hears "Ōwairaka / Mt Albert" twice with no way to tell
the two apart.

**Fix.**
- Contact page keeps the full detail in the body. On this page the footer
  collapses to one line per centre: centre name, suburb, phone as a `tel:` link.
- Elsewhere the footer keeps its current three-column detail.
- Guarantee heading text is unique within a page. If two sections must share a
  name, disambiguate the second (for example "Ōwairaka / Mt Albert — visit us").
- Audit the whole site for a single `<h1>` per page and a heading order with no
  skipped levels.

---

## Fix 6 — Remove the broken-looking divider

**Problem.** A small teal dashed glyph is used as a section divider (visible on
Home, Philosophy and Rooms). It reads as a missing-image artifact.

**Fix.** Replace every instance with either nothing (rely on the 48px section
gap) or a single `1px solid var(--hairline)` rule at full container width. No
glyph, no emoji, no decorative SVG.

---

## Fix 7 — State the ratios plainly

**Problem.** Rooms currently reads "no more than 1 adult to 3–4 children **(as
published by the centre)**" for each room. Hedging your own published ratios on
your own website invites doubt.

**Fix.** Remove "(as published by the centre)" from all three rooms. State the
ratio as a fact:

- Infant — "1 adult to 3 children"
- Toddler — "1 adult to 6 children"
- Preschool — "1 adult to 8 children"

**Before changing the numbers, confirm each figure with the centre manager** and
use whatever they confirm. Do not guess and do not publish a range. If a figure
cannot be confirmed, leave that room's line untouched and flag it in your
summary.

---

## Fix 8 — Give Contact a real enquiry form

**Problem.** Careers has a full, well-considered form. Contact — where a parent
asks for a place, which is the site's whole commercial purpose — offers only
"send us an email or give us a call".

**Fix.** Add an enquiry form to the Contact page, above the centre cards, reusing
the Careers form's markup, validation and privacy patterns so the two match.
Fields, in order:

1. Your name — text, required
2. Email — email, required
3. Phone (optional) — tel
4. Which centre — select: Ōwairaka / Mt Albert · Puketāpapa / Mt Roskill ·
   Either centre. Default "Either centre", with the same helper note the Careers
   form uses about it going to both managers.
5. Your child's age — text, optional, placeholder "e.g. 18 months, or due in
   March"
6. Hoping to start — month input, optional
7. Days you would like — checkboxes Mon–Fri, optional
8. Anything you would like to tell us — textarea, optional

Requirements:
- Keep the Careers form's privacy note pattern: say who can see the submission
  and that it can be deleted on request.
- Add above the fields: "You do not need to send us anything about your child
  yet — we will take the details we need when a place is available."
- Errors use `--error` on `--error-bg`, are announced via `role="alert"`, are
  tied to their field with `aria-describedby`, and move focus to the first
  invalid field.
- Success replaces the form with a confirmation naming which centre will reply
  and by when.
- Every input has a real `<label>`, minimum 44px target height, and a visible
  focus ring at 3:1 contrast against its background.
- The existing phone and email routes stay on the page. The form is an addition,
  not a replacement.

---

## Fix 9 — Replace the home hero image

**Problem.** The home hero is a photograph of an exterior wall and a doorway —
the least engaging image available — while the Rooms page holds much better
photography.

**Fix.** Use a room or children-at-play photograph as the hero. Constraints:
- Only a photo with current written whānau consent for public marketing use
  (see fix 11). If no consented children's photo is available, use an empty-room
  photo — the preschool room before the day starts is a strong second choice.
- Keep the hero above the fold at 1440×900: heading, the intro sentence, and both
  buttons visible without scrolling. Move the image beside or below the copy
  rather than pushing the buttons off-screen.
- Real `alt` text describing the scene, not "hero image".
- Serve responsive sizes with `width`/`height` set to prevent layout shift.

---

## Fix 10 — Make the Doorway sign-in a first-class entry point

**Problem.** "Sign in to the centre app" is footer-only body text, plus a
mid-page mention on Contact and Enrolment. For existing whānau and kaiako it is
the most-used link on the site.

**Fix.**
- Put a **Sign in to Doorway** control in the site header on every page, at the
  right end of the navigation, visually distinct from the nav links (a green
  outline button, 44px tall, not a solid green button — that stays for "Enquire
  about a place").
- Include the Doorway mark at 24px to its left. The mark is two white shapes on a
  rounded green square:

```svg
<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Doorway">
  <rect width="128" height="128" rx="28" fill="#2f6f4f"/>
  <circle cx="64" cy="45" r="19" fill="#fff"/>
  <rect x="28" y="74" width="72" height="23" rx="11.5" fill="#fff"/>
</svg>
```

- Rename every occurrence of "the centre app" to "Doorway" across the site.
- Keep exactly one footer link to it. Remove the duplicate mid-page mentions on
  Contact and Enrolment now that it is in the header.
- Everywhere it appears, keep the sentence: "Access comes from the centre
  inviting you — there is no sign-up."

---

## Fix 11 — Photo consent on the public site

**Problem.** Identifiable children's faces appear across the public marketing
site. The Doorway app is built so that a photo whose consent has been withdrawn
renders as nothing at all. The website has no equivalent mechanism.

**Fix.** This one is partly process, not code. Do the code part and write up the
rest:

- Move every marketing photograph into a single manifest (JSON or CMS
  collection) with fields: `file`, `alt`, `consentReference`,
  `consentConfirmedOn`, `childrenIdentifiable` (boolean), `centre`.
- Render images only from that manifest. An image whose consent reference is
  absent or marked withdrawn must **not be rendered at all** — no placeholder, no
  caption, no broken image, no gap. Absence is the correct rendering.
- Add a documented one-step way for a manager to withdraw an image: set it
  withdrawn in the manifest, redeploy, image gone sitewide.
- Add to the README: photographs of identifiable children require current written
  whānau consent, and consent must be re-confirmed when a family leaves.
- In your summary, list every currently published photo containing an
  identifiable child so the manager can confirm consent for each.

Do not delete photos on your own initiative. Flag them.

---

## Cross-cutting requirements

- **Accessibility.** Every interactive element gets an accessible name, a
  minimum 44px target, and a visible focus indicator at 3:1 against its
  background. Navigation's current page carries `aria-current="page"`. Meaning is
  never carried by colour alone.
- **Type.** Keep the existing serif-heading / sans-body pairing — it suits the
  organisation. Body text no smaller than 16px; image captions no smaller than
  13px in `--muted`.
- **Motion.** 120 / 180 / 260ms, `cubic-bezier(0.2, 0, 0, 1)`, all of it disabled
  under `prefers-reduced-motion: reduce`.
- **Macrons.** Ōwairaka, Puketāpapa, whānau, kaiako, tamariki, pānui, Te Whāriki,
  Māori, ngā hononga. Check every instance, including `alt` text, page titles and
  meta descriptions.
- **No new dependencies.** Use the CSS approach the repo already uses. Do not
  introduce a CSS framework, an icon library, or an animation library.
- **No new features** beyond the Contact enquiry form in fix 8. Do not add a
  chat widget, a map embed, a testimonials section, a blog, or social feeds.

## Definition of done

1. No coral anywhere in the codebase.
2. Every colour resolves to a variable from the token table.
3. No error or warning colour used for informational content.
4. Every page passes an automated contrast check at AA.
5. One `<h1>` per page; no duplicate heading text within a page.
6. Every page checked at 1440, 1024, 768 and 390px.
7. Contact enquiry form submits, validates and confirms.
8. "Sign in to Doorway" in the header on every page.
9. Images render only from the consent manifest.
10. A short written summary of what changed, what you could not confirm (ratios,
    photo consent), and any place the existing code forced a compromise.
