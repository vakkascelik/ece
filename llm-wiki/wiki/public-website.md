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
- Their brand is used, not the platform's — and **none of their colours can carry text.**

## Details

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

- **A Google Maps embed.** A link out instead. An iframe is a third party on a page read by parents
  of three-month-olds, and `frame-src 'none'` stays.
- **A webfont.** The system stack, which is also what their current site uses. A webfont is a
  third-party request and a layout shift for a typeface nobody asked for.
- **Any analytics.** `docs/privacy-statement.md` says "no tracking of any kind" and "no third-party
  analytics script in either app" — that sentence now needs to say *any* app, and the answer stays
  no.
- **Their photographs.** All three homepage images are Flickr-hosted and show children. The platform
  models exactly why this matters: `photo_public` is a **separate consent** from `photo_internal`,
  because families who agree to a photo in the private journal routinely refuse one on a public
  website. The site ships with no child photographs at all.
- **Their social links.** Facebook over plain HTTP, a Twitter handle predating X, plus Flickr and
  Instagram. None could be confirmed active. A footer of dead links is worse than no footer.
- **Reproducing their enrolment form.** It collects a child's full name and exact date of birth from
  a public page and posts to a 2018 Muse PHP mailer. See below.

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

*Last updated: 2026-08-06*


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
