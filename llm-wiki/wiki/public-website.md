# The public website

`apps/site` — Little Pearls' own littlepearls.org.nz, rebuilt from scratch and deployed as its own
Railway service. Why it is a third app rather than routes in `apps/web` or a separate repo, and what
was rejected.

## Overview

Little Pearls is the first real tenant of this platform, and their public website was **Adobe Muse
2017 output** on Apache with jQuery 1.8.3. Every file — all five pages, the sitemap, the philosophy
PDF — carried `Last-Modified: Tue, 03 Jul 2018`. Adobe discontinued Muse in 2018 and ended support
in 2020, so nobody could edit that site in the tool that made it. The rebuild was forced rather than
chosen.

Three defects made it urgent rather than cosmetic, all measured rather than asserted:

- **No `<meta name="viewport">` on any page and no width-based media query anywhere.** Muse tagged
  every region `BP_infinity`, its single desktop breakpoint, so a phone rendered a ~980px layout
  zoomed out — for an audience of parents looking up childcare on a phone.
- **Four addressable hosts.** `http://` and `https://`, with and without `www`, all returned 200
  rather than redirecting.
- **The page titled "Enrolment & Fees" contained no fee.** The only route to one was an
  Issuu-hosted PDF over plain HTTP whose existence could not be confirmed.

## Key Points

- **It is a separate app, not routes in `apps/web`.** The platform's CSP is built to limit what an
  injected script could exfiltrate from a screen showing a child's anaphylaxis plan, and its
  middleware calls `auth.getUser()` on every request. Measured: the site's middleware is **31.5kB
  gzip against the app's 89.5kB**, and it makes no network call per page view.
- **It is in this monorepo, not a sibling repo**, so `packages/core` tokens cannot drift. The
  original instruction was a folder next to `ece`; the trade-off was put to the owner and the
  monorepo won.
- **CORRECTED 2026-08-06.** This used to read "it has no Supabase dependency at all — not in
  `package.json`, and no `@ece/api` path in its tsconfig, enforced by absence rather than by
  policy." The careers form changed that, and the tsconfig note said at the time that if it ever
  changed it would be justified there first, which is where the reasoning now sits. What survives is
  the part that mattered: the **browser** still reaches nothing but the site itself. The anon key is
  read from an unprefixed env var so Next cannot inline it into client JS — verified by grepping
  `.next/static/` for it and for any Supabase string and finding none — so `connect-src 'self'`
  stays literally true. The tsconfig path is to one module, `@ece/api/recruitment`, whose only
  imports are types, so the public container cannot even construct a service-role client. See
  [[recruitment]].
- **Every fact on the site traces to their own site or their philosophy PDF.** Everything else is in
  `apps/site/CONTENT-GAPS.md` and, where a parent would look for it, marked on the page itself.
- **All ten routes pass axe (WCAG 2.2 AA) at 390px and 1440px with zero violations and zero
  horizontal overflow.** Their predecessor fails on every page at every width. Repeatable since
  2026-08-07 as `npm run audit:site` — before that it was a one-off run, which is not a check.
  **Read *The audit's two blind spots* below before trusting that sentence about this design** —
  the pearl-and-ocean pass put a gradient and an `overflow: hidden` on every page, and each of those
  hides a class of defect from this gate.
- **The site is pearls and ocean as of 2026-08-16**, on the centre manager's brief: bring back the
  pearl analogy from the old site, give the page water that moves, and put the children's
  photographs *inside* the pearls. See *The pearl and the ocean* below.
- **The site does not refer to the centre app at all**, as of 2026-08-16 — not the product name, not
  the mark, not the masthead control, not the footer link, not the two body-copy sentences. This
  reverses the exposure [[unverified-claims]] §19 was written to warn about. The `/portal` mount and
  `SITE_APP_URL` are untouched; only the visible references went. See *The navigation, and three
  ways of building a menu that were wrong* below.
- **The navigation collapses behind a Menu button below 48rem.** On a phone the seven links were two
  permanently-open rows under the brand, pushing the page's own heading most of a screen down.
- **The enquiry form does not ask for a child's date of birth, and a request to add one is open.**
  See *The date of birth that has not been added* below — it is gated on an insurance question
  nobody in this repo can answer, and the agreed shape when it is unblocked is a birth **month**.
- **The site has a standing editorial voice, set by the centre manager on 2026-08-17:** plain,
  simple, warm, authentic — and **no assertive claims**, in the manager's words because "they show
  off, they bind people, and they build expectations." Copy decisions cite this now: it is why the
  confirmed ratios are published as bare numbers with the "exceeds the Ministry" comparative left
  off, and why "A chef, not a delivery" was retitled. Any new copy on this site is written to it.
- **The ratios on `/rooms` are the manager's confirmed figures (1:3 / 1:5 / 1:7–8), as of
  2026-08-17** — from the enrolment reply the centre sends families, which superseded the 2018
  website's ranges (toddler moved from 1:6–7 to a stricter 1:5). The confirmation the fix brief
  required from day one, finally supplied. Gap 6 carries the detail.
- **`/philosophy` carries the centre's vision, values and global focus** from their 2026–2029
  strategic plan, in their own sentences: "What we want to be known for", the four values with the
  Teaching Council attribution kept, and the Pearl of the Isles Foundation. The plan itself is not
  committed — it is an internal document quoted from, not a handoff pack.
- **Visit windows are published with their reason** (9.30–11.00am or 1.00–3.00pm, booked, timed so
  visits never land on lunch or sleep) on `/enrolment` and both centre pages — from the same
  enrolment letter, which also supplied the visit → waitlist → form-and-fee sequence and the Healthy
  Heart Award's proper name.
- Their brand is used, not the platform's — and **none of their colours can carry text.**

## Details

### The pearl and the ocean

Added 2026-08-16, from a design handoff (`handoff_website_pearl_ocean/`) written to the centre
manager's brief: **bring the pearl analogy back from the old site, add water that moves and a boat,
and put the children's photographs inside the pearls.** The handoff scopes itself to the homepage;
the owner asked for the whole site, so the nine other routes are an extrapolation and are marked as
one in `PageBand.tsx`.

The organising rule, and the reason it does not turn the site into a theme: **the ocean is a
surface, never an accent.** Teal water is a ground you read *on*; it never becomes a button, a link,
or body text on paper. `--teal-ink` is still the one interface accent, exactly as it was. On a band
the primary button inverts to white with `--ocean-deep` text, because a teal button on teal water is
a button nobody finds. Two bands per page maximum — the top and the bottom — and the middle stays
`--shell` with white cards.

**The handoff's own palette was declined, and that is the one place this pass overrides it.** Its
token table is *Doorway's* — the fix brief says in as many words that the website should use the
app's tokens "so the two properties read as one organisation", and its accent `#2f6f4f` is Doorway's
brand green. The name was being taken *off* this site in the same commit, so importing its colour
would have been the opposite move. Six ocean tokens were added to `brandLittlePearls` instead; they
are the same hue family as their own teal, taken down rather than up.

**These are the one part of Little Pearls' palette that can carry white text**, which contradicts
the rule stated everywhere else on this page — because they are not their colours. The `tealInk`
move, applied to a background instead of to text. White on `--ocean-deep` is 12.26:1.

#### Nine contrast pairs for what looks like three

The handoff quotes its contrast against `--ocean-deep` only. **The hero is a gradient that *ends* at
`--ocean-shallow`**, the lightest of the three, and the intro paragraph and both buttons sit at the
bottom of it — so its figures describe the top edge of a band and say nothing about the text at the
bottom of it. All nine combinations are measured and asserted in `LITTLE_PEARLS_CONTRAST_PAIRS`:

| | deep | mid | shallow |
|---|---|---|---|
| white | 12.26 | 10.37 | 8.57 |
| `--on-ocean-muted` | 8.09 | 6.84 | 5.66 |
| `--on-ocean-soft` | 7.26 | 6.14 | **5.08** |

The floor holds AA with room. It is also the pair that breaks first if anybody lightens the water.

This is the *third* time on this site that a colour checked against one background has turned out to
say nothing about the others — the `Ink` variants were corrected for it, the footer swap below hit
it again from the opposite direction, and now a gradient. The lesson has a stronger form than it was
first written in: **a gradient is not a background, it is a range of them.**

#### The audit's two blind spots

Both were found by rendering the page and looking at it, after `npm run audit:site` reported twenty
clean page views. Neither is a bug in the audit; both are limits of what it can see, and this design
walked into both.

1. **axe cannot resolve contrast against a `linear-gradient`.** It files those elements as
   *incomplete* rather than as violations, and the audit counts violations. So every ocean band is a
   contrast blind spot. What it hid: the footer's `<h2>` — the invitation that closes every page on
   the site — rendering near-black on deep teal at **1.18:1**, because `.foot` is an ocean band but
   does not carry the `.band-ocean` class and fell through to the global heading colour. Alongside
   it, the "Enquire about a place" button rendered as **a blank white rectangle**: `.foot a` is
   (0,2,0) and `.btn-invert` was (0,1,0), so the footer's link colour won and the label was white on
   white.
2. **`overflow: hidden` defeats a document-level overflow check.** The audit asserts
   `documentElement.scrollWidth === clientWidth`, which a clipping ancestor satisfies trivially.
   What it hid: at 390px the hero's copy column was **420px wide inside a 390px container** and the
   `<h1>` was cut off mid-word. Clipped text and no overflow look identical to that check.

The second class needs a different assertion to catch it — comparing each text element's rect
against its nearest clipping ancestor rather than against the document — and that assertion does not
exist in the repo yet. Recorded rather than claimed.

#### Inline styles beat media queries, twice

The same root cause produced two unrelated-looking defects, and it is worth stating once as a rule:
**a value set in an element's `style` attribute cannot be overridden by any stylesheet rule, at any
specificity, including inside a media query.**

- `--pearl-size` is set inline by `Pearl.tsx`, so
  `@media (max-width: 40rem) { .hero .pearl { --pearl-size: … } }` did nothing. The hero pearl stayed
  420px on a phone; a grid item's `min-width` defaults to `auto`, so it dragged the copy column out
  with it. Fixed by putting the responsiveness in the *value* — `min(420px, 78vw)` — which needs no
  breakpoint and cannot be silently lost. The derived shadow sizes moved to `calc()` in CSS so the
  prop could stop being a number.
- The wave drift was an inline `animation`, so `@media (prefers-reduced-motion: reduce)` could not
  stop it. **Five wave layers went on drifting for a reader who had asked the operating system for
  no motion**, plus three footer pearls whose `:nth-child` rules outranked a two-class reset. Fixed
  by passing the animation *value* through a custom property and declaring `animation` in the
  stylesheet, and by declaring the pearls' animation once with a per-pearl period.

Measured rather than reasoned: with reduced motion requested, `document.getAnimations()` reported
**8 running before and 0 after**, with zero inline transforms written in both cases — the scroll
handler half was correct from the start. With motion allowed, 9 elements get transforms and 9
animations run. The page is complete and legible either way: 5 waves, the boat and 7 pearls are all
still drawn with nothing moving.

#### The waves, and two defects in the reference file

Each layer is three nested elements — a positioned reservoir, an inner div carrying the drift, and
an SVG whose path repeats a period. Translating by exactly half the width lands period *n+2* where
period *n* was, so the loop has no seam. Two directions and three speeds is what makes it read as
water; nothing goes under ~15s per cycle, because faster reads as a loading spinner.

Both of these are in the handoff's reference implementation and both were found by checking rather
than by looking:

- **`wave5` had a seam.** Its path started at `y=30` and reached `y=34` at the halfway mark, so the
  `-50%` wrap put a 34 where a 30 had been — a ~2px step across the full width, once every 19
  seconds. Every other path returns to its start value. One number.
- **The geometry has zero slack, and its own parallax then eats it.** With `left: -10%; width: 220%`,
  a fully-drifted layer's right edge lands at `left + width/2` = *exactly* 100% of the viewport; the
  scroll parallax subtracts up to ~160px from that. The result was a wedge of open ocean showing
  below the waterline at the right edge of the page. The handoff's own definition of done asks for
  "no white gap at either edge"; its numbers cannot deliver that with its own parallax table
  applied.

Fixed by going to **four periods with `left: -60%; width: 440%`**, which keeps the drift at -50% and
the rendered period identical (`440/4 == 220/2`), so the waves are not stretched — there is simply
more of the same wave, and 60% of viewport slack at both edges. The paths are now built by repeating
one period written as *relative* curves, which makes "identical periods" structural rather than
something a reader has to verify. That is the actual fix for `wave5`: not the corrected number, but
removing the possibility of the class of error.

#### The pearl, and the photograph inside it

Three layers over a circular crop: a specular highlight, iridescence at `mix-blend-mode: soft-light`
— at `normal` it lays a pink film over a child's face rather than tinting what is there — and a rim
carrying the curvature. The rim is what makes it a pearl; the sheen only says where the light is.
Inset blurs scale with the diameter, because the handoff's are written for the 420px hero and a
-34px inset swallows a 64px card pearl whole.

**The handoff's sheen values are tuned against an empty pearl** — there is no photograph in any
pearl in its reference file, so nothing there tests them. Over a real image they put white at 42%
alpha across a sixth of the radius and washed the picture out: the hero child came out hazy and the
64px story pearls read as plain white discs. `.pearl--photo` pulls the highlight in and takes it
down. The manager asked for photographs *inside* the pearls, and a photograph nobody can make out is
not that.

Two per-image fields exist because of one photograph. `sheen: 'right'` mirrors the highlight to
`66% 26%` — at the default `34% 26%` it lands squarely on the hero child's forehead and burns it
out. Focal point drives `object-position`. Both are on the photograph in `lib/photos.ts` rather than
on the component, because which is right depends entirely on the image.

**A pearl with no photograph is a supported state, and it is the one place this site renders
absence.** [[consent-gated-media]]'s rule holds everywhere else — no consent, no render, no
placeholder, no gap. Here the pearl is the decoration and the photograph is the content, so an empty
pearl is still a pearl and the layout does not develop a hole. The three footer pearls are empty on
purpose: at 56px a face is about eleven pixels across, and that is a child's face reduced to texture.

#### The footer went from coral to ocean, and the contrast work inverted

The coral footer was asked for by name — "make footer background color same as current one; pinkish"
— and `#ff6565` was read out of their own stylesheet. The new direction ends the page in water, so
the choice was put back to the owner rather than assumed, and the band won.

What is worth keeping is the shape of the change. Coral could not take white text (2.88:1), so that
footer ran dark ink on their colour. **The ocean cannot take dark**: `#1b1a18` on `--ocean-mid` is
**1.18:1**. The text colour did not need rediscovering so much as re-deriving from the other end —
and a background swap that left `color: #1b1a18` alone would have shipped an unreadable footer on
every page while looking, in a diff, like a one-line colour change. It did, until it was looked at.

### The navigation, and three ways of building a menu that were wrong

Added 2026-08-16, from two instructions: **do not mention the app**, and **do not show the whole
menu on a phone — put it behind a button.**

The first is a deletion and needs little explaining. The masthead control, the footer link and the
two remaining unnamed sentences on `/enrolment` and `/contact` are gone; there is now no reference
to the app anywhere on the public site, asserted across all nine routes by a check that greps the
rendered text and every `href`. What did **not** go is the infrastructure: `middleware.ts` still
mounts the app at `/portal`, `SITE_APP_URL` still resolves, `/api/health` still reports on it, and
`appUrl()` is still there with no caller and a note saying why. Deleting it would have meant
deleting a regression test guarding a real production incident, a section of the runbook, and the
health check's coverage — to save four lines, and then restoring all of it. Putting the link back is
one element; that asymmetry is the whole argument.

The second took three attempts, and the failures are more useful than the result.

**Attempt 1 — `<details>` with the panel styled `display: flex`.** A native disclosure is the right
instinct: it opens with no JavaScript, and the browser supplies the button role, the keyboard
handling and the expanded state. The problem is that it must *stay open* on desktop, and a server
render cannot know the viewport, so `open` cannot be set for one width and not the other. The
documented workaround is to override the browser's hiding of a closed `<details>`' content. It does
not work, and the way it fails is the point: **an explicit `display` on the panel defeats the
hiding entirely**, so the menu stayed expanded at 390px — the exact complaint being fixed.

**Attempt 2 — the same thing, scoped to desktop only.** Now the phone collapsed correctly and the
desktop nav was *invisible*. Measured in Chromium: the `<nav>` had a real layout box — 725×44 at
1440, `display: flex`, `visibility: visible`, `opacity: 1` — while its `<details>` parent stayed 0px
tall, and the content was never painted or hit-tested. `elementFromPoint` at the nav's own
coordinates returned the container behind it.

That is the lesson worth keeping: **a rect and a computed style both reported a healthy navigation
that no visitor could see or click.** The check written to verify this change passed on it. What
actually answers "can somebody click Rooms" is hit-testing, so the check now walks each link and
asks `elementFromPoint` whether the browser finds *that link* at its own centre. `::details-content`
is the modern fix and was rejected: where it is unsupported the rule is ignored and the desktop nav
vanishes, which is not a failure mode to ship to browsers that cannot be tested here.

**Attempt 3, and the one that shipped — explicit state, with two different fallbacks.** A `useState`
disclosure means the panel is hidden in the server HTML and revealed by script, which on its own
would let a failed bundle cost a phone visitor every link on the site. Not hypothetical: every
script on every page was once refused in production by a CSP the prerendered pages could not
satisfy. So there are two fallbacks, and they cover *different* failures:

| Failure | Covered by | Why the other one does not |
|---|---|---|
| Scripting switched off | `<noscript>` inline style forcing the row open | — |
| The bundle fails to run | The footer's copy of the seven links | `<noscript>` never applies; the browser considers scripting enabled right up until the script errors |

The footer list reads as an ordinary footer sitemap, which is what makes it a good fallback — it is
not an apology for a broken menu, it is the thing most sites have anyway. It is a second `<nav>`
landmark labelled "Footer" so a screen reader's landmark list distinguishes it from "Main", and it
maps the same array, so the fallback cannot list different pages from the thing it stands in for.

**A fourth defect, found by the 500 it caused.** That shared array was first exported from
`SiteNav.tsx`, which is `'use client'`. A server component importing a value from a client module
does not get the value — Next replaces every export of a client module with a client reference — so
the footer called `.map` on a proxy and **every route returned 500**:

```
TypeError: p.NAV.map is not a function
```

It compiles and it typechecks; the boundary is a bundler transform TypeScript cannot see. The list
lives in `lib/nav.ts` now, a plain module both sides import.

With the sign-in control gone the masthead had room it did not have before, so the nav sits beside
the brand on one row at every width above 48rem rather than being forced onto its own line — which
was a workaround for seven items plus a brand plus a button exceeding 68rem, and the button is what
went.

### The date of birth that has not been added

Asked for on 2026-08-16 by the centre manager, who wants what the old website collects. **Nothing
was built.** The form, `enrolment_applications`, `submit_enrolment_application` and the catalogue
assertion in `rls_isolation.sql` are all untouched.

It runs at three things at once, and it is worth seeing them as one mechanism rather than three
objections:

1. **`docs/tenant-little-pearls.md`** gates every piece of child data on professional indemnity
   insurance, recorded as absent on 2026-08-05 and not rechecked since.
2. **Migration 0054** dropped exactly this field, having been written into 0052 by mistake. Its
   reasoning: a birth month is *"a date of birth with the day filed off … finer than a band, and it
   invites exactly the field the page refuses"*.
3. **`rls_isolation.sql` asserts against the Postgres catalogue** that the public function takes no
   child's name — deliberately not a behavioural test, because *"somebody re-adding the parameter
   would write a test that passes it"*.

**The third one is the interesting one, because it did its job.** Its comment ends "if that changes,
this fails, and whoever changed it has to come and read this comment". A guard whose stated purpose
is to make a future change *expensive to do quietly* was written, and the next person to touch this
area read it and stopped. That is the pattern worth copying: where a decision matters more than the
code expressing it, assert the decision, not the behaviour.

The substance, briefly. This form is a public `anon` endpoint, so a DOB there writes an identifiable
under-five into the database before anyone has signed anything or had a consent conversation — the
weakest lawful basis in the product. And the old site is a poor precedent: its form posts to a 2018
Adobe Muse PHP mailer whose delivery was never verified, so copying it preserves no working
capability.

**Decided, for when it is unblocked: month and year — "March 2024" — not an exact date.** It gives
the centre the room, the transition month and a waitlist position without a value that identifies
one child on its own. It reverses 0054 knowingly, so whatever supersedes that migration has to
answer its argument rather than overwrite it, and the catalogue assertion should be *rewritten to
pin the new boundary* rather than deleted.

**The one blocking fact is not a code question:** is the indemnity insurance in place now? Recorded
in `tenant-little-pearls.md` under *Somebody has now asked to cross it*, and as gap 19.

### Their palette cannot carry text, and finding that out took two attempts

Read out of their Muse CSS: teal `#83afaf` (authored three times as `#83AFAF`, `#83ADAF`, `#83AEAF`
— inconsistent authoring, not three colours), mid teal `#99c9cc`, aqua `#c1ebef`, pale aqua
`#edf8fa`, coral `#ff6565`, pink `#ff9399`, body grey `#595959`.

Measured against the 4.5:1 WCAG 2.2 AA asks of body text:

| | ratio | |
|---|---|---|
| white on teal | 2.41:1 | fails |
| white on coral | 2.88:1 | fails |
| white on pink | 2.12:1 | fails |
| teal as text on white | 2.41:1 | fails |
| dark ink on teal | 8.72:1 | passes |
| body grey on pale aqua | 6.47:1 | passes |

So the light palette is **background only**, and anything needing white text — or needing to *be*
text — uses a darkened variant of their own hue.

**The mistake worth recording:** those variants were first derived as `#507c7c` and `#d53b3b`,
walked down until they passed against **white**, asserted against white, and they passed at 4.65:1.
Then axe found contrast failures on all ten routes. The footer, the callouts and the gap blocks sit
on `aquaPale`, which is *darker* than white, and on it the same colours measure **4.29:1**.

A pair checked against one background is not a checked colour — it is a checked colour on one
background. The variants are now derived against the darkest surface they touch (`aqua`, `#c1ebef`)
and asserted against all three, and they are `#416d6d` and `#c12727`. The tests in
`packages/core/src/__tests__/tokens.test.ts` now assert nine pairs rather than four, including one
that asserts white text on the light palette **still fails** — so if somebody lightens the brand,
the test that catches it is the one saying the Ink variants are still needed.

### Macrons

Their site writes "Owairaka", "Puketapapa", "Whanau", "Maori", with macrons only in "Te Whāriki".
The philosophy PDF has the same gaps plus typos — "whana", "its just a pleasure", and a sentence
reading "We aim to environmental/sustainability focus".

The rebuild uses **Ōwairaka, Puketāpapa, whānau, Māori**. That is not tidying: the statement being
corrected is the one committing to "promote te reo Māori and tikanga Māori in daily practice", and
the design pack makes the same rule for the platform.

### What the five monorepo wiring files taught

`apps/*` in `workspaces` is not enough. Four files would have skipped a third app silently:

| File | What it would have done |
|---|---|
| root `build` | A hardcoded chain of three `-w` flags. The site would not be built by CI or Railway |
| `eslint.config.mjs` | The react-hooks block was scoped to `apps/web/**` and `apps/mobile/**` — no `rules-of-hooks` on the new app, and `lint` still reports clean |
| `scripts/tokens-css.ts` | One hardcoded output path, and `--check` compared exactly one file. The site would have restated the palette by hand, unguarded — the precise failure that script exists to prevent |
| `scripts/check-bundle.ts` | `const WEB = 'apps/web'`. A performance gate reporting clean about a bundle it never looked at |

`typecheck`, `lint` and `test` pick a new workspace up for free. The other four are the ones that
report success while covering nothing, which is worse than failing.

### `railway.site.json`, and the silent failure it avoids

`railway.json` is a single-service manifest with `startCommand: npm run start -w @ece/web`. A second
Railway service reading it would boot **the platform**, pass its health check, and serve the app
holding children's records on the marketing domain — a green deploy pointing at the wrong
application. So the site service is configured with its own config path, and its root directory must
stay the repo root, which is the trap [[deployment]] already records one version of.

### Rejected

- **A Google Maps embed.** Still rejected, and there is a map now — see *The map that is not an
  embed* below. An iframe is a third party on a page read by parents of three-month-olds, and
  `frame-src 'none'` stays.
- **A webfont from a CDN.** *Corrected — the site has a typeface, and this bullet used to say it
  did not.* The original decision was "the system stack, because a webfont is a third-party request
  and a layout shift". The first half was answered by `next/font`, which downloads the files at
  build time and serves them from this origin, so `font-src 'self' data:` never changed; the second
  by `display: 'swap'`. Headings are Literata. The choice of face was itself a defect caught by
  looking — see the long note in `apps/site/src/app/layout.tsx` on Fraunces putting the macron over
  the wrong letter, which renders `Māori` as `Maōri`.
- **Any analytics.** `docs/privacy-statement.md` says "no tracking of any kind" and "no third-party
  analytics script in either app" — that sentence now needs to say *any* app, and the answer stays
  no.
- **Their photographs, unexamined.** *Corrected — the site carries photographs now, and this bullet
  used to say it carried none.* Every one of their eleven was downloaded and looked at rather than
  judged from its filename. Seven show only the premises, and a picture of an empty room engages
  nobody's consent; those are in use, committed to `apps/site/public/` so `img-src 'self' data:`
  still holds. The four showing children were withheld until the centre confirmed the consents on
  2026-08-07, and the reason they were a separate question is the one the platform models:
  `photo_public` is a **separate consent** from `photo_internal`, because families who agree to a
  photo in the private journal routinely refuse one on a public website. See
  `apps/site/CONTENT-GAPS.md` gap 10 for what is still open about them.
- **Their social links.** Facebook over plain HTTP, a Twitter handle predating X, plus Flickr and
  Instagram. None could be confirmed active. A footer of dead links is worse than no footer.
- **Reproducing their enrolment form.** It collects a child's full name and exact date of birth from
  a public page and posts to a 2018 Muse PHP mailer. See below.

### The map that is not an embed

Added 2026-08-07, on `/contact` and both `/centres/*` pages. It is the third time a request has
arrived that this site's CSP appeared to forbid, and the third time the answer was to build it
differently rather than widen a directive — the pattern is worth more than any of the three
features.

**The distinction the original rejection missed.** "A Google Maps embed" was refused because *an
iframe is a third party on a page read by parents of three-month-olds*. Correct, and it was being
applied to the wrong noun. What an embed costs a reader is Google's JavaScript executing in the
page, Google's cookies in their browser, and their IP address handed to Google for the crime of
looking up a childcare centre's address. **None of that is a property of a map.** It is a property
of the delivery. The same conflation had already been made once on this site about the typeface and
resolved the same way.

**What is built.** The container fetches a PNG from the Maps Static API, holds it in memory, and
serves it from `/api/map/<centre>`. The reader's browser makes one request, to this origin, for an
image.

| | Embed (`frame-src`) | Direct `<img>` to Google | This |
|---|---|---|---|
| CSP change | `frame-src` opened | `img-src` opened | **none** |
| Reader's browser contacts Google | yes | yes | **no** |
| Google JS in the page | yes | no | no |
| Cookies set on the reader | yes | no | no |
| API key visible to the reader | yes | yes | **no** |

The last row is the one that surprises people. A key in an `<img src>` is a key on every reader's
screen, restrictable only by HTTP referrer — which is a request header anybody can set. Unprefixed
and server-side, `GOOGLE_MAPS_API_KEY` cannot be inlined into client JavaScript by Next even by
accident, the same mechanism `lib/db.ts` relies on for the Supabase anon key.

**The coordinates were geocoded once and committed, not resolved per request.** `centres.ts` now
carries a `lat`/`lng` per centre, checked on 2026-08-07: both came back `location_type: ROOFTOP`
with no `partial_match` and a `formatted_address` identical to what the file already held. Handing
Google the address string at request time also works and was rejected — it moves "which building is
this childcare centre in" from a value somebody can review in a diff to a service call nobody sees,
and the failure mode is a parent standing outside a stranger's house with a three-month-old. There
is a test asserting the request contains the coordinates and **not** the street name, which is the
one that fails if somebody simplifies it back.

**Two behaviours worth knowing before changing this.**

1. *The picture is optional; the links are not.* The first version of `CentreMap` returned `null`
   when there was no image, which silently removed the "open in maps" link from both pages — a page
   that had a working way to find the place would have lost it because an environment variable was
   missing. Only the `<img>` is conditional now.
2. *A failure keeps the last good image.* A blip at Google must not blank a page that was working a
   second ago. Mutation-tested: reverting that line fails exactly one assertion.

**The cache is a module-level `Map`, deliberately not `fetch(..., { next: { revalidate } })`.** The
root layout is `force-dynamic`, which changes the default caching of `fetch`, and whether an
explicit `next.revalidate` overrides that default is a question about Next's internals that would
have to be re-answered on every upgrade. Fifteen lines that behave identically on every version won.
Measured: nine requests across two centres produced two calls upstream.

**STILL NOT LIVE, AND ON 2026-08-16 SOMEBODY ASKED WHY.** The centre manager asked to see the map on
the contact page. It has never appeared, and the reason it took a dig to answer is the thing worth
recording — the three failure states are indistinguishable from outside the container, because
`CentreMap` renders the address and the links and no image in all of them.

What the production site actually said, checked rather than assumed:

| | |
|---|---|
| `GET /api/health` | `{"ok":true,"usingDefaultsFor":["SITE_CANONICAL_HOST"]}` — **no `mapsDisabledFor`, so the key IS set** |
| `GET /api/map/mt-albert` | `404`, zero bytes — `centreMap()` returned null, so the fetch to Google failed |
| `GET /contact` | emits no `<img>` at all — the fallback behaved exactly as designed |

So the design worked and Google refused. The likely causes are all in the Google Cloud console and
none of them is a code change: the Maps Static API not enabled on the project (its own product,
separate from the Geocoding API the coordinates came from), **an HTTP-referrer restriction on the
key** — which is the standard advice for a Maps key and is fatal here, because a server-to-server
`fetch` sends no `Referer` — or no billing account attached.

**What changed in code is only that the reason is now visible.** `mapsStatus()` puts Google's own
refusal sentence on `/api/health` as `mapsFailing`, per centre, so the question is answerable without
Railway's logs. It does **not** call Google — that reasoning is unchanged, and is the same reason
this endpoint does not query Supabase — it reports what the last real page render already found out.
The consequence is that an empty result means *not attempted since the restart*, never *working*,
which is asserted in a test so the wording and the function cannot drift apart.

The refusal text is scrubbed of anything matching `key=…` before it goes into a public response.
Google's refusals are sentences and do not echo the request, so this is insurance rather than a fix
for an observed leak — mutation-tested, and removing the scrub fails exactly one assertion.

Diagnosis order and the fix steps are in `docs/deploy-railway.md`, which is where whoever deploys
will look. A fix needs no redeploy: a failure is remembered for fifteen minutes, deliberately, so
ticking the box in the console is the whole job.

**What nobody has checked, and it is in `apps/site/CONTENT-GAPS.md`.** Google's Maps Platform terms
restrict how long their content may be cached, and serving it from our own origin is caching. The
TTLs are set short and conservative rather than argued to a limit. Do not read the numbers in
`staticMap.ts` as a finding about the terms.

**As of 2026-08-07 the Maps Static API is not enabled on the Google Cloud project**, so the live
site shows the fallback: address, "Get directions", phone number, no picture. Enabling it is a
console tick and needs no deploy — the negative result is cached for fifteen minutes, not for the
life of the container, for exactly this reason. The failure path was verified against the real
Google endpoint; the success path was verified end to end against a local stand-in serving a real
PNG, because the only thing the stand-in cannot prove is what Google's cartography looks like.

### The enquiry form is deliberately not built yet

Their form is the strongest argument for integration and the strongest argument for care. It
collects child name, date of birth, parent name, phone, address, email, requested centre, requested
days and start date — and `public.waitlist` in `supabase/migrations/0018_bookings.sql` has almost
exactly those columns.

Three findings stopped a direct port:

1. **Every policy in this schema is `TO public`**, so it is evaluated for `anon` too — and the
   predicates call `caller_has_role`, whose EXECUTE `0022_policy_hardening.sql` revoked from
   `PUBLIC`. An anonymous insert therefore fails with `permission denied for function
   caller_has_role`, from *inside* the policy, which reads exactly like a missing table grant. This
   applies to any future anonymous path, not just this one.
2. **`review:security` check 8 asserts that `anon` has no table grants** at `high` severity, and the
   script exits non-zero on high. Verified in the schema: `anon` holds `usage on schema public` and
   not one table grant across twenty-four migrations.
3. **Nobody has DELETE on `waitlist`, including `service_role`.** An anonymously-writable table
   whose rows cannot be removed through any credential the product holds is a permanent spam store,
   in a queue whose *order* is meaningful.

And the substantive one: `docs/tenant-little-pearls.md` records that this tenant holds "zero
personal information" and that **no child record goes in until professional indemnity insurance is
in place**. A public endpoint writing an identifiable under-five into that database crosses the line
that document exists to hold, with the weakest lawful basis in the product — nobody has signed
anything and no consent conversation has happened.

**The centre does not need a child's legal name to phone a guardian back.** So the enquiry page
currently does what their form actually achieves — it gets a family talking to the centre — using
contact details already public on their own site. When a form is built it should collect the
guardian's details and a **coarse age band** (the ratio band is the only thing about the child that
changes whether a place exists), and it should reach the database through a `security definer`
function granted to `anon` rather than a table grant, so check 8 stays green *and* stays true.

### News is not pulled from the platform

Rejected on the repo's own established reasoning. [[consent-gated-media]] records that a withdrawn
consent takes effect "immediately and retroactively with no cleanup job and **no cache to
invalidate**" — and statically generated HTML is exactly that cache. An unpublished post, an
archived post or a withdrawn consent would have no effect until a rebuild. It is the same argument
that already rejected `next/image` for media, one layer up.

`posts` also has no audience column: `published_at` means visible to whānau of that centre, not to
the world. Adding an anonymous read path would mean folding a world-readable disjunct into
`posts_select` — the expression that carries the guardianship boundary, and the single worst place
in this schema to put one.

If news is wanted, it belongs in `apps/site/content/` as markdown: reviewable in a diff,
un-publishable with a commit, and carrying no child, no media row and no signed URL.

### The recommendation above was taken up — for careers, not for enquiries

The paragraph on the enquiry form ends with a prescription: a public write should "reach the database
through a `security definer` function granted to `anon` rather than a table grant, so check 8 stays
green *and* stays true". `0024_recruitment.sql` is that design, built for job applications. It works,
and the parts that were guesses are now measured — see [[recruitment]] for the flood guard, the
quiet-duplicate rule and the two designs that were rejected.

**The enquiry form is still not built, and none of the three findings above have gone away.** A job
application is a very different object from a childcare enquiry: an applicant is an adult writing
about themselves, so there is no child, no date of birth, no guardianship question and no insurance
gate. `waitlist.child_name` is still `NOT NULL`, nobody still has DELETE on `waitlist`, and
`docs/tenant-little-pearls.md` still forbids putting an identifiable under-five in this database. The
recommendation there stands as written: a separate `public.enquiries` table with the guardian's
details and a coarse age band, which staff promote to `waitlist` by hand.

## See Also

- [[deployment]] — the single-service manifest this adds a second service beside
- [[design-system]] — the platform's tokens, and why the brand is a separate export
- [[consent-gated-media]] — why no photograph of a child appears here
- [[unverified-claims]] — and `apps/site/CONTENT-GAPS.md`, its equivalent for site content

*Last updated: 2026-08-11*


## Their own photographs, and the four that are not here

Added 2026-08-07. The site launched with no imagery at all, which was the right default and a poor
result: a childcare page with no picture of the place tells a parent nothing about the place.

Their old site carries eleven photographs, named after Flickr ids. Every one was downloaded and
**looked at** rather than judged from its filename, which is the only way this decision can be made:

- **Seven show the premises and nothing else** — the entrance, four rooms, the playground, the sandpit.
  Those are in `apps/site/public/`, renamed to what they show, resized from the `_2x` variants their own
  site already served, and converted to WebP. Between a third and a half of the original bytes.
- **Four show identifiable children** and are not here, and must not be until the centre holds current
  written consent for **public** use for each child in each frame. Listed in `src/lib/photos.ts` with
  what each shows, so the next person asked "can we put some photos of the children up?" finds the
  answer beside the photographs rather than in a markdown file.

The distinction is the one the platform already models: `photo_internal` and `photo_public` are separate
consent kinds because families who agree to a photo in a learning journal routinely refuse one on a
website. Consent given in 2018 for a site nobody has updated since is not consent for a new site now.

**Three of their assets were images of text** — the tagline and both centre names, rendered to PNG by
Adobe Muse. Not brought across: real text is selectable, translatable, searchable and resizable, and
WCAG 1.4.5 asks for it. The site already renders all three as text.

**Their nautical decorations were left behind on licence grounds.** `noun_boat_1630770.png` and
`noun_submarine_605221.png` are Noun Project assets — the numbers are the asset ids — and the four
social icons are Iconmonstr. A Noun Project asset is either CC BY, needing visible attribution, or
royalty-free under a subscription held by whoever built the old site; their pages carry no attribution,
so it cannot be told from outside which applies. Copying them in would be inheriting somebody else's
licence position unseen. Recorded as gap 15 with the cheaper alternative: draw them fresh as inline SVG,
which also lets them take their colour from the brand tokens.

### axe for this site is now a script, because the claim was a one-off

This page has said since the site was built that "all ten routes pass axe (WCAG 2.2 AA) at 390px and
1440px with zero violations and zero horizontal overflow". True when written — and a **one-off run**
nobody could repeat, which is the exact species of claim this repo keeps catching itself making.
Adding eight images across five pages is what would have quietly broken it.

`npm run audit:site` now does it: ten routes at two widths, WCAG 2.2 AA, `best-practice` excluded for the
same reason the app excludes it. Twenty page views, clean.

**And it does not catch the failure the images actually risk**, which is worth writing down because the
opposite is easy to assume. Emptying one photograph's `alt` and re-running the audit reported no
violations anywhere. That is axe being right: `alt=""` is a *valid* declaration that an image is
decorative, and no tool can know that a photograph of a playground is not. So the alt text is guarded by
a data-contract test instead — every entry in `PHOTOS` has a description, it is longer than a label, and
it does not begin "photo of". The one empty `alt` on the site is the masthead logo, where the name is
already beside it in text.


## The pearl and the woven mat

2026-08-07, at the centre's request. Their words: like the first site in concept, not like other
childcares, *unique, authentic and humble but good quality, reflecting our philosophy and vision*.

The honest starting point is that the site as built was accurate, accessible and **generic**. It
could have been an accountant's. The system stack and the deliberate absence of imagery — both
defensible decisions on their own terms — added up to a page with no character at all, for a centre
whose rooms are timber, woven baskets and daylight.

### The idea, and why it is not decoration

Every other childcare site in Auckland is primary colours, cartoon illustration, stock photographs of
laughing children and a bubbly rounded font. **Their pedagogy is the opposite of that.** Pikler and
RIE are about calm, unhurried, respectful environments; Te Whāriki means "the woven mat". So the way
to be unique, authentic and humble at once is not to add anything — it is to make the site as calm as
the rooms already are. Nobody else in the market is doing that, and it is true rather than borrowed.

Two ideas already theirs carry it:

- **The pearl** — their name and their tagline. Something precious that forms slowly, layer on layer.
  The warm grounds and soft roundness come from this.
- **The whāriki** — their curriculum's own metaphor, and physically present in their rooms as woven
  baskets, a canopy over the quiet corner, rugs, thatched shade over the sandpit.

### What actually changed

| | |
|---|---|
| **Ground** | White → `shell` `#faf7f0`, with `sand` `#f0e9dd` for banded sections. White is not neutral, it is clinical, and it was the single biggest reason the site read cold. Eight new contrast pairs, measured **before** the hex values were chosen |
| **Type** | One self-hosted face for headings; body stays on the system stack so the text a parent reads paints instantly |
| **Masthead** | Was a full-width saturated teal band — the loudest thing on every page, and the opposite of what a centre practising RIE is saying. Now the same paper as the page, with a hairline. The teal returns where it means something |
| **Shape** | An arch on square photographs, from their logo badge and the real ivy archway their quiet corner is shot through |
| **Weave** | A small centred woven swatch between sections, drawn in CSS from two crossed gradients — warp and weft. **Removed on 2026-08-07**; it read as a broken image at every size tried. See "The design review" below |
| **Photographs** | Three more, after the centre confirmed consent |

### The typeface nearly shipped a spelling error

Fraunces was chosen first, for a real reason: its `SOFT` axis rounds the terminals exactly as their
logo does. It built, it looked warm, and it was wrong.

**Fraunces misplaces every macron.** Rendered at 56px and looked at: `Whānau` came out with the bar
over the **n**, and `Māori` came out as `Maōri` — a different word. Seven faces were then rendered
side by side against the system stack to establish it was the font and not the pipeline: Literata,
Newsreader, Source Serif 4, Lora and Bitter are all correct, Petrona floats the `Ō` bar high, only
Fraunces shifts them.

That is the worst shape a defect can have. It does not throw, it does not fall back to a visibly
different font, and it does not fail a build — it renders a plausible word that is the wrong word, on
a site whose stated values include a commitment to te reo Māori. **Nothing in this repo would have
caught it. It was caught by rendering the words and looking at them.** Literata places its marks
correctly and is warm without being cute.

`latin-ext` is not optional for the same reason: every macron here is in Latin Extended-A, and
without the subset the browser silently substitutes another face for exactly those characters.

### `npm run audit:site` was testing an unstyled page, and then a stale build

The audit added the day before turned out to have two defects, and between them they cost most of an
afternoon and nearly lost a correct fix.

**It waited for `domcontentloaded`**, so it sometimes measured the page before the stylesheet applied.
An unstyled page fails `target-size` on every link and passes every **contrast** check trivially — so
the rule the audit exists to enforce was the one it could least see, and it raced, passing clean
whenever it happened to lose.

**And on Windows `server.kill()` does not kill the server.** Spawning with `shell: true` — which Node
requires for a `.cmd` — puts `cmd.exe` in between; `kill()` reaps the shell and orphans Next. Eleven
orphaned servers accumulated across runs, the audit bound to a port an older one already held, and
that server served a **stale build** whose asset hashes did not match the fresh HTML. Every
`/_next/static/*` request returned 400, so there was no stylesheet at all.

The consequence was not noise, it was confident wrong answers that did not change no matter what the
CSS said. A correct fix was tried, appeared to make things dramatically worse, and was reverted —
and the "worse" was a third bug, the failure counter counting its own newly-added log lines rather
than failing nodes.

Three fixes, all in `scripts/audit-site.ts`: kill the process tree, count nodes rather than output
lines, and **refuse to report at all** if `body` has no background, because a transparent body proves
the CSS never arrived. Throwing beats reporting: a failed run is obvious and a confidently wrong one
is not.

Worth keeping as the general lesson: **31 lines of CSS were written to fix failures that did not
exist.** Once the harness was honest they were removed, and the audit stayed green without them. A
broken measurement does not just hide defects; it manufactures them, and you fix the phantoms.

## The design review, 2026-08-07

Ten pieces of feedback from the owner on the built site. The writing was not in question; every item
was the visual system, and most were **one mistake repeated**. Nine were acted on, one was deferred
as a feature, and one carried a factual claim that was wrong.

### The claim that was wrong, and why it is worth recording

> "Black text on that coral almost certainly fails 4.5:1 too."

It does not. `#1b1a18` on `#ff6565` measures **6.05:1**, it is asserted as `dark text on coral` in
`LITTLE_PEARLS_CONTRAST_PAIRS`, and the number is recomputed into the header of `tokens.css` every
time the generator runs. The colour was still wrong and it still went.

That is the useful shape of this: **the design judgement was right and the mechanism offered for it
was not.** A saturated red-pink block is the grammar of an alert whatever its contrast ratio, and
this one was carrying opening hours, "not sure which room?" and "already with us?" on nearly every
page — a parent scanning met alarm where a nudge was meant. Had the contrast argument been taken at
face value, the fix would have been to darken the coral until a number passed, which fixes nothing.
The repo's own check said the colour was compliant. It was compliant, and wrong.

### The one mistake, repeated

Three accents were competing — teal buttons, coral blocks, the pink of their own logo — and coral had
drifted from "one per page, this is what to do next" into decoration on eight routes. The rule now is
**one accent, theirs, plus the logo's pink as the single exception, never adjacent**.

| Was | Is |
|---|---|
| `.callout` on `--coral` | `--aqua-pale` with an `--aqua` hairline. Same family as the buttons and links |
| `.gap` with a `--coral-ink` left rule and bold red lead sentence | `--sand`, ink text, no accent rule |
| `a:hover` to `--coral-ink` | Thickens the underline. Every link was a second accent waiting for a mouse |
| `.foot` hairline in `--aqua` | Gone. Sand against shell is the edge |

Coral is untouched in `brandLittlePearls`. It is their colour; it is simply not what a page uses to
say "come and see us".

### The gap blocks were styled as errors and are not errors

`.gap` marks something the centre has to supply — fees, vacancies, a licence detail — on the page
rather than only in a tracking file, because a placeholder that lives in a tracking file is a
placeholder that ships. That reasoning is unchanged.

What was wrong is that a tinted panel with a red left rule and a bold red first sentence is what
every framework renders a validation failure as. "Our fees are not published on this page yet" read
as the site reporting a fault in itself, on the page a parent opens wanting to be reassured. Not
publishing a fee you cannot stand behind is a normal editorial state and a defensible one — **the
styling was arguing against the copy.**

All three now lead with the offer instead of the absence: *"Ask us and we will send you the current
fee schedule"*, *"Send us an application whenever you are ready"*, *"Ask us about the team here"*.
The reason follows in the same block. Nothing was hidden and no gap was closed.

### The column was centred and still looked left-hugging

The measure and the column were two numbers that had to agree and did not. `p` capped at 66ch, which
at the 15px body size is about 545px, sitting inside an 800px column inside a 1400px window — so
every page ended two-thirds of the way across its own container, and centring the container only
moved the problem. The earlier fix had narrowed 68rem to 50rem and stopped one step short.

Body copy is now `--text-mobile-base` (17px) and `.main .wrap` is 44rem. Same 66ch measure — the
thing that actually governs readability — but about 620px of text in 672px of content. The floor on
how narrow the column can go is `.photo-row`: three photographs at a 13rem minimum plus two gaps need
656px, so under about 43rem the homepage rows drop to two across.

`--text-mobile-base` rather than a new size: `--text-base` is the platform's *density* step, written
for a manager scanning a table. Nothing on this site is a table.

### The weave did not survive contact with a browser

Recorded as a loss, not a tidy-up. Te Whāriki means "the woven mat", it is the centre's own metaphor,
it is physically in their rooms, and it settled the Noun Project licence question by being
unambiguously theirs. It was still removed.

Two attempts, both wrong at the size they shipped at. Full width on a 3-on-8 pitch read as a dotted
border somebody had styled oddly; a 72×12px centred swatch on a tighter pitch read, at reading
distance, as **an image that failed to load** — the worst thing a mark can do on a page whose job is
to look like somewhere you would leave a child. It is now a 1px `--sand` hairline, the same line
colour as the masthead and the cards.

If the weave returns it should return as their own photography of their own baskets and canopy, which
is a real texture and is already on the site, rather than as a gradient standing in for one.

### The homepage led with a wall and a door

The hero was `entrance` — looked at rather than described, that is an orange wall, a sliding glass
door, a surveillance-camera warning sign and a painted yellow parking line. A good photograph of a
building, and the wrong first thing on a page whose job is to make somebody want to leave a
three-month-old here. Every warm image the centre owns was two clicks away on `/rooms`.

It is now `atTheTable`, and `playKitchen` takes the slot that vacated in the row below — the same
photograph twice on one page makes a centre look like it owns three pictures.

`painting` is the strongest image they have and is **not** the hero: it is a tight portrait, and
`object-fit: cover` on a 3:2 box would crop the top of the child's head. `.photo-lead` went from 16:9
to 3:2 for the same reason — on a 720px square, 16:9 keeps rows 157–562 and clips the nearest child
in `atTheTable`; 3:2 keeps 120–600 and every face survives.

`entrance` was not dropped. It is still the Open Graph share image, which is the one place a building
genuinely is the right picture, because a link preview is seen by people who did not choose to look.

### The footer repeated both addresses on every page

> **PARTLY REVERSED THE SAME DAY, on the owner's call — the three columns are back.** See "The
> footer, reversed" below. The heading half of this did not come back with them, and the distinction
> is the point.

Three columns, two full postal addresses, two phone numbers, two email addresses, an `<h2>` per
centre — on all ten routes. On `/contact` that made the third and fourth copy of each address, and
each centre name was an `<h2>` in the footer **and** an `<h2>` in the card above it, so a screen
reader working that page's heading list hit "Ōwairaka / Mt Albert" twice with different content under
each.

It was collapsed to one line per centre with no headings at all — `<footer>` is already the
`contentinfo` landmark and a list of two places does not need one.

### "(as published by the centre)" is gone from /rooms

It was there so the site would not imply a compliance claim the platform itself refuses to make —
`RATIO_TABLES_VERIFIED` is `false` and every ratio screen in the product says so. That reasoning
still holds and the page still makes no regulatory claim.

What it did on the page was hedge the centre's own staffing on the centre's own website, in front of
a parent, in their own accent colour. On a third-party directory that attribution is honest; here the
centre **is** the publisher, so it read as the service quietly declining to stand behind its own
number.

Removing it is not a rule-5 problem. Rule 5 forbids asserting an unsourced regulatory figure; this is
sourced — their published ratio, in `lib/centres.ts` — and is still stated as what they staff to. The
two claims that genuinely are about a regulatory minimum ("higher than required ratios", "more than
the minimum number of staff required by the Ministry") remain off the site entirely.

### Doorway is now named on a customer's public website

The masthead carries the mark plus "Sign in to Doorway", promoted from a line of footer body text.
For a family or a kaiako already at the centre this is the most-used link on the site, and it was in
small print below ten pages of marketing copy.

**UPDATED 2026-08-11: that link no longer leaves the site.** The console has no domain of its own,
so it is proxied onto this site's hostname at `/portal` and `SITE_APP_URL` points at
`/portal/login`. This app is now a reverse proxy as well as a website — `next.config.ts` forwards
`/portal/*` to the console service, and `middleware.ts` deliberately does **not** run on that path,
because it would overwrite the console's per-request CSP nonce and blank every console page. Two
consequences belong on this page: `robots.txt` carries `Disallow: /portal`, and authenticated
console traffic now passes through this container — the one `railway.site.json` separated out
precisely because it is the public, unauthenticated surface. It still holds no database credential.
Mechanism and the full list of traps in [[deployment]].

**This creates an exposure that did not exist before.** [[unverified-claims]] #19 recorded that the
product name has not been trademark- or domain-checked and that "nothing in this repo uses it yet —
so there is no exposure today". That sentence is now false, and #19 has been corrected. The name is
on a real service's public site, in front of the public, before an IPONZ search has been run.

Two smaller decisions inside it. The mark is the handoff's **mono** variant (`#1b1a18` box, white
shapes) and not its primary `#2f6f4f` green, because dropping a fourth colour into the masthead is
the exact problem this pass exists to fix — and recolouring another product's mark into Little
Pearls' palette would be neither product's mark, so a sanctioned variant was used as specified. And
the link sits **outside** `<nav>`: a main navigation whose last item is a different application lies
to anybody working it with a keyboard or a screen reader.

### Deferred: an enquiry form on /contact

The strongest item in the review and the only one not done. The commercial purpose of the site is a
family asking about a place, and that is currently "send us an email" while `/careers` — which serves
far fewer people — gets a real form.

It is a feature, not a visual fix: a table, a policy, a grant, an assertion in `rls_isolation.sql`, a
flood guard, a screen in the app to read enquiries, and its own wiki entry. Roughly the size of
[[recruitment]].

It does **not** run into the insurance gate, for the same reason the careers form does not — the
shape already written down in `enrolment/page.tsx` is the guardian's own details, a coarse age band,
a hoped start date and a centre. No child's name and no date of birth. `docs/tenant-little-pearls.md`
holds the line at a child record, and this is not one.

### What was checked

`typecheck`, `lint`, `test`, `tokens:check`, `build:site`, and `audit:site` — 20 page views across 10
routes at 390px and 1440px, no violations and no horizontal overflow. Then every changed page was
**screenshotted and looked at** at both widths, which is what turned up two defects no gate saw:
`atTheTable` rendering twice on the homepage, and the masthead costing three rows on a phone with the
sign-in link stranded alone on the third. The nav now declares its own line rather than being wrapped
onto one, so the brand and the sign-in link share the top row at every width.

## The developer credit, 2026-08-07

"Developed by Salix", linking to `https://www.salixtech.co.nz`, in the footer of every route. Small
change, three decisions in it worth keeping.

**A file in `public/`, not an inlined `<svg>`** — the opposite of the call made for the Doorway mark
in the same footer's masthead, and deliberately. Doorway's mark is three primitives copied out of a
handoff this repo owns. This is a drawn mark belonging to somebody else, whose own guidelines say it
may not be recoloured; keeping it as the byte-identical asset makes that hard to break by accident,
where an inlined path is one `fill` attribute away from it. `img-src` is `'self' data:`, so a
committed file is also the only shape the CSP allows — a hotlink to their site would be refused.

**The tile variant, not the default mark**, and that is a correction from looking at it rendered
rather than reading their README. `salix-mark-green.svg` is their default and it is a fine line
drawing — strokes of 0.9 to 1.6 units in a 100-unit viewBox — so at 28px the heaviest line lands at
roughly 0.4 device pixels and the mark rendered as a faint scratch beside the text. Their note that
16px is legible is written about `favicon.svg`, which is a *different drawing*: a solid green tile
with the leaf reversed out. A solid shape survives being small, which is the same reason the Doorway
mark is a filled box rather than an outline.

**Two logos are not two accents.** The one-accent rule from the design review governs what the site
uses to *say* things — buttons, callouts, links. A third-party mark is identity, and the review
already carved out the pink of Little Pearls' own logo on exactly that basis. Salix green `#1a5a4a`
appears once, at 28px, in the footer.

## The footer, reversed — and the half that did not come back

The owner looked at the collapsed footer and preferred the three columns. They are back. That is a
style preference and it is theirs to have; what is worth recording is that **the two things the
collapse fixed were separable, and only one of them was a preference.**

| | Came back? |
|---|---|
| Three columns, both full addresses, both emails, on all ten routes | Yes. On `/contact` that means each address is stated twice. A reader skips it |
| A `<h2>` per centre in the footer, duplicating the `<h2>` per centre in the contact cards | **No.** The column labels are `<p class="foot-head">` — identical on screen, and correct |

A footer column label is a label, not a section of the document. Nothing is lost by it not being a
heading, because `<footer>` is already the `contentinfo` landmark; what was lost by it *being* one is
a heading outline with the same name twice at the same level, which is not navigable. Repetition a
sighted reader can skip is a different cost from a broken outline a screen-reader user cannot.

The general shape, worth more than the specific case: **when a change bundles a taste call with a
defect fix, unbundle them before reverting.** The instruction was "the previous footer was better",
and the previous footer was better in one respect and broken in another.

The sign-in link is deliberately in both the masthead and the footer now. The masthead one is the one
that gets used; somebody who has scrolled to the bottom looking for it should not have to scroll back
up.

### The footer is coral now, and it could not bring their white text with it

Asked for directly: make the footer the same pinkish colour as their current site. It was `--sand`.
It is `--coral` — `#ff6565`, which [[design-system]] read out of their own 2018 stylesheet, so this is
their footer colour rather than something sampled off a screenshot.

**The background was the easy half.** `packages/core/src/tokens.ts` has said since it was written that
none of their brand colours can carry text, and it has the numbers: white on coral is **2.88:1**
against the 4.5:1 WCAG 2.2 AA wants. Their live footer is white on coral. So the colour came across
and the text arrangement did not.

Measured with the repo's own `contrastRatio` before anything changed, which is what turned a one-line
change into a real one:

| on `#ff6565` | ratio | |
|---|---|---|
| `#1b1a18` | **6.05:1** | chosen |
| white | 2.88:1 | fails — what their site does today |
| `--ink` `#595959` | 2.44:1 | fails — what this footer's body text *was* |
| `--teal-ink` `#416d6d` | 2.01:1 | fails — what `.foot-head` *was* |

**Both colours already in the footer failed on the new background.** That is the part worth keeping:
a background swap that touched only `background` would have shipped two contrast failures onto every
page of a compliance product, and it would have looked completely fine in a screenshot. `.foot`,
`.foot a` and `.foot-head` all move to `#1b1a18`, and the `--teal` hairline above the credit — 1.19:1
on coral, not a violation because a divider is not a UI component, just invisible — becomes a
translucent tone of the text.

Two things that made this cheap rather than fiddly. The pair `#1b1a18` on coral was **already** an
asserted entry in `LITTLE_PEARLS_CONTRAST_PAIRS`, so the colour this now depends on cannot regress
without a unit test failing. And `npm run audit:site` exists, so the claim is a measurement: 20 page
views, 10 routes, 390px and 1440px, no violations and no horizontal overflow.

The rejected alternative, because it is the obvious one: `--coral-ink` `#c12727` takes white text at
5.85:1 and would have matched their *arrangement*. It is a deep brick rather than a pinkish coral, so
it loses on what was actually asked for. One line if the dark text reads wrong on screen.

### Their social accounts are on the site, as words

Facebook, Instagram, X and Flickr, a fourth column in the footer grid. `.foot-grid` is
`auto-fit, minmax(16rem, 1fr)`, so a fourth item reflows on its own — no media query and no column
count to correct when a fifth thing arrives. The URLs live in `lib/centres.ts` next to
`CENTRE_FACTS`, because they are site content rather than configuration.

**Text links, where theirs are icon bubbles**, and three reasons. `img-src` is `'self' data:`, so
every icon is either a committed asset or an inlined path — and the developer credit two sections
down already refuses the inlined route for somebody else's mark, on the grounds that a drawn logo is
one `fill` away from breaching its own guidelines; four platform marks is four of that argument. An
icon-only link needs its accessible name supplied separately, and a name that exists only for screen
readers is a name nobody proofreads. And their current footer still shows a bird for X, which is a
neat demonstration that a glyph goes stale where a word does not.

No `target="_blank"`: an unrequested new window is a change of context under WCAG 3.2.5, and anybody
who wants one has a middle-click. No `rel="noreferrer"` either — the site's
`strict-origin-when-cross-origin` policy already sends the origin and nothing more, so adding it
would be cargo, and the policy stays the single place that decision lives.

### Two CSS specificity bugs in one footer, both the same shape

Both were invisible in the diff and obvious in a screenshot, and both are the kind that read as a
typo in the markup rather than a losing rule in the stylesheet.

- `.foot p { margin: 0 }` is (0,1,1) and `.foot-credit` is (0,1,0), so the credit's top margin was
  discarded and the line sat welded to the one above it. It is `.foot .foot-credit` now.
- `.foot .foot-head` and `.foot .foot-head-spaced` are both (0,2,0), so **source order decides** —
  and the first uses the `margin` shorthand, which sets `margin-top: 0`. Written in the wrong order
  it silently undoes the rule meant to override it. Caught before it shipped only because the first
  bug had just been paid for.

The credit's hairline needed `max-width: none` for a third reason of the same family: `p` caps at
66ch globally, so a border meant to span the footer stopped two-thirds across and read as an
underline struck through the text above it.

The bug found on the way is a specificity one and is the sort that looks like a typo in the markup.
`.foot p { margin: 0 }` is (0,1,1); `.foot-credit { margin-top: … }` is (0,1,0), so the margin was
being flattened and the credit sat jammed under the hours line looking like a continuation of it. It
is `.foot .foot-credit` now. A rule that loses is invisible in a diff and obvious in a screenshot.

An earlier attempt separated the credit with a `border-top`, which was wrong for a reason specific to
this stylesheet: `p` caps at 66ch globally, so the border stopped mid-footer and read as an underline
struck through the line above rather than as a divider. Space does the job the line was being asked
to do — the same conclusion the weave reached, one section up.
