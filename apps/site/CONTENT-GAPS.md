# Content gaps — Little Pearls website

Everything this website would like to say and cannot yet, in one place, in the shape of
[`llm-wiki/wiki/unverified-claims.md`](../../llm-wiki/wiki/unverified-claims.md).

## Why this file exists

Every fact on the site traces to Little Pearls' own website, their philosophy PDF, or
[`docs/tenant-little-pearls.md`](../../docs/tenant-little-pearls.md). Nothing was taken from a
third-party directory, and nothing was written to fill a space.

That discipline is not squeamishness. This is a real service that real families choose between, and
a plausible-looking fee, capacity or ratio is worse than a blank — a parent acts on it. The same
rule already governs the platform: `fee_schedules` ships with no amounts anywhere, and
`RATIO_TABLES_VERIFIED` is `false` so every ratio screen carries a notice saying nobody has checked
the bands against the regulations.

Several of these gaps are **visible on the site**, in a marked block, rather than only tracked
here. A placeholder that lives only in a tracking file is a placeholder that ships.

## Open

### 1. Fees are not published anywhere

Their existing page is titled "Enrolment & Fees" and contains **no fee amount**. The only route to
one is an Issuu-hosted PDF, linked over plain HTTP, whose existence could not be confirmed —
issuu.com did not resolve during research.

Fees are the single most-searched thing on a childcare site, so this is the most valuable gap to
close. **To close it:** the centre supplies the current schedule and confirms it may be published.
Until then `/enrolment` says fees are available on request, in a marked block.

### 2. 20 Hours ECE, WINZ and Best Start

Third-party listings state that both centres offer 20 Hours ECE. **Their own site never says so**,
and neither does anything else we hold. Not stated on the site.

**To close it:** the centre confirms which funding applies at each site.

### 3. Licensed capacity

Directory summaries suggest 65 FTE at Mt Albert including up to 18 under two, and 53 FTE at Mt
Roskill including up to 14 under two. Those were read from **search-result summaries**, because
both Education Counts and ERO returned HTTP 403 to a direct fetch.

Not published. A capacity figure tells a parent whether there is likely to be room, and a wrong one
sends them away or wastes their visit.

### 4. Ministry service numbers

46365 (Mt Albert) and 47407 (Mt Roskill). Two independent government directories agree, and
`docs/tenant-little-pearls.md` already records that both were **read from URL parameters, not from a
rendered Ministry page**. Good enough to seed a database row that nothing depends on; not good
enough to print on a public page.

**To close it:** confirm each against a licence certificate or Ministry correspondence the centre
holds.

### 5. Staff names, roles and photographs

Their "Our Staff" page names nobody, lists no roles and shows no photographs. It is the weakest
page they have — parents choosing who will care for a three-month-old want to see the centre
manager and head teachers.

**To close it:** the centre decides who may be named, and each person agrees. A photograph needs
that person's agreement in writing.

### 6. Two ratio claims that are about a regulatory minimum

Their careers page says the centres run "higher than required ratios" and "more than the minimum
number of staff required by the Ministry of Education". Both are claims **relative to a regulation
this repo has not sourced** — the platform's own ratio bands are unverified for exactly that
reason — so neither is repeated on the site.

The centre's *own* published ratios (1:3–4 infant, 1:6–7 toddler, 1:7–8 preschool) **are** on
`/rooms`, stated as what they staff to and never as what a regulation requires.

**Changed 2026-08-07.** Each one used to be followed on the page by "(as published by the centre)".
That attribution is honest on a third-party directory and self-defeating here, because on their own
site the centre *is* the publisher — it read as the service declining to stand behind its own number
in front of a parent. The distinction this gap exists to protect is untouched: their published ratio
is sourced and stays; the two claims about a regulatory minimum stay off the site.

**Changed 2026-08-17 — the manager confirmed the figures, and they were not the old site's.** The
enrolment reply the centre sends to families (relayed by the owner, family details redacted) states
**1:3 infant, 1:5 toddler, 1:7–8 preschool**. The toddler figure is stricter than the 1:6–7 the old
website carried, which is exactly why the fix brief demanded confirmation before stating anything
plainly. `/rooms` now carries the confirmed numbers with the hedged ranges gone.

The same email reaffirms "our teacher ratios exceed the standards set by the Ministry of Education"
— **still not published**, for two reasons that now point the same way: the minimum has never been
sourced here, and the manager's own instruction for the site's voice is to avoid claims that bind or
build expectations. The numbers are on the page; the comparison waits for Schedule 2 to be read, and
possibly forever.

### 7. Mt Roskill's opening time — CLOSED 2026-08-26

Their site said 7.30am for both centres; a third-party directory said Mt Roskill opened at 7.00am.
The rule was "their own site wins until the centre says otherwise, and the disagreement is recorded
rather than averaged."

**The centre has said otherwise.** Relayed by the owner on 2026-08-26: the day is
**7.30am–5.30pm**, and the youngest age accepted is now **6 months**, not 3. Both figures on the
2018 site were stale — the closing time by half an hour, the age floor by three months.

So the directory is not outvoted, it is superseded, and this gap is closed. Two things worth
keeping from it:

- **The direction of both corrections matters to a parent.** A shorter day and a higher minimum age
  are the kind of stale facts that turn into a family arriving at 5.45pm, or enquiring about a
  four-month-old. Neither is a cosmetic edit.
- **Both figures lived in four files** — `CENTRE_FACTS`, the site description, the rooms
  description, and a JSON-LD `openingHours` block that Google reads for the knowledge panel. The
  JSON-LD is the one nobody would have eyeballed, and it is the copy a parent sees in search
  results without visiting the site. `src/lib/__tests__/centreFacts.test.ts` now asserts all four
  agree, because nothing else in the build compares them: they are strings, and typecheck cannot
  see a stale one.

### 8. Is the on-site chef at both centres?

Their homepage says "**our centre** has a full time on-site chef" — singular, written when there
was one site. The site repeats the food offering without claiming which centres it covers.

### 9. Social accounts, and three plain-HTTP links

Their footer links to Facebook (over `http://`), Twitter (`twitter.com/littlepearls_nz`, predating
X), Instagram and Flickr. **None could be confirmed as active** — Facebook returned only a title
and issuu.com did not resolve.

Not carried over. A footer of dead links is worse than no footer.

### 10. Photographs — seven in use, four withheld

**Updated 2026-08-07**, when their existing photography was brought across. This gap used to say the
site carried no photographs at all; it now carries seven, and the four that are missing are missing for
a reason that has not changed.

Their old site has eleven photographs. Every one was downloaded and **looked at**, rather than judged
from its filename, and they split cleanly:

| In use | Shows |
|---|---|
| `centre-entrance.webp` | The entrance, with the logo on the wall |
| `preschool-room.webp` | The preschool room, tables and artwork |
| `infant-room.webp` | Open shelves, baskets, blocks, an armchair |
| `quiet-corner.webp` | A sofa and canopy through an ivy-trailed doorway |
| `play-kitchen.webp` | The wooden play kitchen |
| `playground.webp` | Artificial grass, timber archway, climbing frame |
| `sandpit.webp` | Decked sandpit under two thatched umbrellas |

Nobody's consent is engaged by a photograph of an empty room, so these needed no permission beyond the
centre's own.

> **2026-08-07 — the manager has confirmed the centre holds consents.** Relayed by the owner from
> Taner Basar. Two things still worth pinning down before these go up, and neither is a reason to
> stall: whether the consent covers **public/website** use specifically rather than photographs in
> general, and whether it covers **these** photographs — they were taken around 2018, so the tamariki
> in them are now school-aged and many will have left. Consent recorded on an enrolment form for "use
> of images" is not always the same permission. The centre is the agency responsible for that call;
> this note exists so the basis for it is on the record rather than in a chat.
>
> Separately, and as an editorial rather than legal point: the sleeping pair is the one to think
> twice about. It is a lovely photograph and a picture of two sleeping toddlers on a public website
> invites a different kind of attention than a picture of a sandpit.

**Four are withheld**, listed in `src/lib/photos.ts` with what each shows: a group of five children at a
table looking straight at the camera, a toddler covered in paint with their face filling the frame, a
child drawing in profile, and two toddlers asleep on a rug.

**To close it:** the centre confirms it holds **current written consent for public use** for each child
in each photograph. Not consent in general, and not the consent that covers a learning journal — the
platform's own schema separates `photo_internal` from `photo_public` precisely because families who
agree to one routinely refuse the other. Consent given in 2018, for a site nobody has updated since, is
not consent for a new site in 2026. The sleeping pair would want particular thought even with a
signature.

Better than reusing any of them: new photography taken knowing it is for a public website, with the
consent collected at the time.

### 15. Their nautical icons are third-party, and the licence is not ours to assume

Their site decorates pages with a boat, a submarine, fish and building blocks. The filenames give them
away — `noun_boat_1630770.png`, `noun_submarine_605221.png` — those numbers are **Noun Project** asset
ids. The four social icons are `iconmonstr-*.png`, from Iconmonstr.

**They were deliberately not copied across.** A Noun Project asset is either CC BY, which requires
visible attribution, or royalty-free under a subscription held by whoever built the old site — and
their current pages carry no attribution, so which of those applies cannot be determined from the
outside. Copying them into this repo would be inheriting somebody else's licence position sight unseen.

Nothing is lost today: the site reads well without them, and the four social icons have no use because
the site links to no social accounts (gap 9 — nobody has confirmed the accounts are live).

**To close it:** either the centre confirms the original licence, or the decorative marks get drawn
fresh as inline SVG. The second is cheap, has no licence question, scales without a second file, and
would tint from the brand tokens instead of being fixed-colour PNGs.

### 16. How long Google's map tiles may be held

Added 2026-08-07 with the maps themselves, so it is a known gap rather than a discovery.

`/contact` and both centre pages now show a map. The container fetches it from the Maps Static API
and serves the bytes from this origin — which is what keeps the reader's browser from ever
contacting Google, and is also, unavoidably, **caching Google's content**. Their Maps Platform terms
place limits on that, and nobody here has read the current version of them.

So the TTLs in `src/lib/staticMap.ts` are set short and conservative — six hours for an image, an
hour in the reader's browser — rather than argued up to a limit somebody half-remembers. **Do not
treat those numbers as a finding about the terms.** They are a guess made in the safe direction.

**To close it:** read the current Maps Platform Terms of Service and the Maps Static API service
specific terms, and write down what they actually permit. Three outcomes are possible and only one
is work: the caching is fine as it stands; the TTL needs a number; or the image must be requested by
the reader's browser, in which case the choice is between opening `img-src` to
`maps.googleapis.com` — which hands Google every reader's IP address and puts the API key on their
screen — and taking the maps back out. That third case is a decision for the owner, not a fix.

### 11. Whether the old enrolment form still reaches anyone

Their form posts to `scripts/form-u832.php`, an Adobe Muse mailer last modified in 2018. It was not
tested — submitting it would have contacted the centre. If it has been silently failing, there may
be enquiries nobody ever received.

**To close it:** ask the centre when they last received an enquiry through the website.

### 12. The careers form cannot take a CV

Added 2026-08-06 with the form itself, so it is a known gap rather than a discovery.

The form collects contact details, the role wanted, an earliest start date, a self-declared
practising certificate and a free-text message. It does **not** accept an attachment, so the page
asks applicants to email their CV to `career@littlepearls.org.nz` as well — which means one
application arrives in two places and staff reconcile them by hand.

The reason is not effort. A CV holds an address, an employment history and referees' names and phone
numbers, and those referees agreed to nothing. Storing one needs a private bucket, storage policies
that admit an unauthenticated uploader, a retention rule and a line in the privacy statement. The
schema records the shortfall rather than hiding it: `job_applications.source` distinguishes an
application that came through the website from one staff typed in off an email.

**To close it:** decide how long the centre wants to keep an unsuccessful applicant's CV. That
answer is the retention rule, and the rest follows from it.

### 13. There is no vacancy list

The page says "current vacancies are not listed here yet" and invites an application anyway, which
is what their old page did in different words. Nothing in the platform models a vacancy.

**To close it:** ask the centre whether they want to advertise specific roles, or would rather keep
receiving open applications. If it is the former, that is a table this schema does not have.

### 14. An emailed application cannot be logged in the platform

Added 2026-08-07, found by tracing the screen against the code rather than by using it.

Gap 12 says CVs arrive by email. The staff screen's empty state originally went further and told
managers that an emailed application "can be added to this list" — which the product cannot do.
`recordApplication` exists in `@ece/api` with `source` values for `email`, `walk_in` and `referral`,
and nothing calls it: there is no form. The copy now says so plainly instead.

**To close it:** a small "log an application we received another way" form on `/applications`. The
query function and the schema are already there, so this is a form and a server action, not a
feature. It is worth doing at the same time as gap 12, because both exist for the same reason.

### 17. The "Why pearls" copy is not the centre's own words

Added 2026-08-16 with the pearl-and-ocean design.

**This is the only text on the site the centre did not write**, and that is why it is a gap rather
than a paragraph. Everything else here traces to their own site or their philosophy PDF; the closing
note of this file has said since it was written that *nothing on the site is unsourced*. Four pieces
of prose now are:

- the section intro, "No two are alike, and none of it is hurried…"
- the three card headings and their paragraphs — *Something singular arrives*, *Layer upon layer*,
  *Something to treasure*

They come from the design handoff, which flags them itself as "a first draft, not approved text" and
lists the manager's sign-off as a thing to get **before publishing**. They are on the homepage now
because the pearls are decoration without them — the section is where the analogy is actually made —
and a placeholder would have been worse than a draft somebody has to read.

Nothing in them is a claim of fact. They describe an approach, in the register the centre's own
philosophy statement uses, and no figure, ratio, hour or capacity appears. So the risk is tone and
authorship rather than accuracy.

**To close it:** the centre manager reads four short paragraphs and either approves them, edits
them, or replaces them with their own. They are all in `apps/site/src/app/page.tsx`, in one section,
with no interpolation.

**Update 2026-08-17:** the manager has now set the voice for the whole site — plain, warm, sincere,
nothing boastful, nothing that binds or builds expectations — and supplied the strategic plan, whose
"What we want to be known for" lines are now on `/philosophy` in their own words. The "Why pearls"
draft reads consistently with that voice, but consistent-with is not approved: this gap stays open
until the manager reads those four paragraphs specifically.

### 18. Which photograph belongs in the hero pearl

Added 2026-08-16.

The hero pearl is a 420px circular crop and it currently holds `painting.webp` — a single toddler,
face-on, covered in blue paint. **It was chosen on compositional grounds, not editorial ones**: of
the ten photographs the centre owns it is the only one with a single subject at the centre of the
frame, and a circle turns a group shot into a picture of somebody's shoulder.

Consent is not the open question — the centre confirmed on 2026-08-07 that it holds the consents for
the four photographs showing children, and this is one of them (see `lib/photos.ts`). What is open
is that **this photograph is now the single largest thing on the front page**, which is a different
decision from being one of three in a row further down, and nobody at the centre has been asked
about that specific promotion. The design handoff lists "which consented photos go in the hero pearl
and the three story pearls" as a thing to confirm before publishing.

**To close it:** show the manager the homepage and ask whether that child's photograph is the one
they want as the front page. If not, `PHOTOS.painting` in `page.tsx` is a one-word change — but note
the `sheen` and focal-point fields on the replacement, because a circular crop plus a bright
highlight will destroy a badly-placed face.

### 19. Whether the enquiry form should ask for a child's date of birth

Added 2026-08-16. **Asked for by the centre manager**, who wants what the old website collects.

**UNBLOCKED 2026-08-29.** Nothing has been built and the form is unchanged, but the reason it was
blocked is gone: the professional-indemnity gate in `docs/tenant-little-pearls.md` was lifted by
owner decision on that date, after being traced to a day-one bullet in a list of open questions
rather than to any external requirement. This is now an ordinary piece of work waiting to be asked
for.

The shape agreed for when it is unblocked is **month and year — "March 2024" — not an exact date**.
It gives the centre the room, the transition month and a waitlist position, and stops short of a
value that identifies one child on its own. It knowingly reverses migration 0054, which dropped
exactly this field.

Worth saying to the manager, because it changes what "like the current website" means: **their old
form posts to a 2018 Adobe Muse PHP mailer whose delivery could not be verified** — see gap 11. It
is not a working precedent for collecting a birth date; it is a form that may not reach anybody.

**To close it:** build it. A migration superseding 0054, a new function signature, the `child_name`
catalogue assertion in `rls_isolation.sql` rewritten to pin the *new* boundary rather than deleted,
and the privacy statement updated to say the platform now holds a child's birth month from a public
form. 0054's argument against the field has to be answered in whatever supersedes it rather than
quietly overwritten — the reversal is a change of requirements, not a correction.

### 20. ERO reports exist and the site does not point at them

Added 2026-08-17. The manager's enrolment email tells families: "You can view our ERO reports for
the Mt Albert and Mt Roskill branches online through the ERO website by searching for 'Little
Pearls Educare Centre'." An ERO report is the strongest independent trust signal a centre can offer
and the centre itself volunteers it — so the site should link both reports from the centre pages.

Not done yet because the two report URLs have not been fetched and verified, and this repo does not
publish a link nobody has opened. **To close it:** find both centres' pages on ero.govt.nz, open
them, confirm they are the right service (match the street address, not just the name), and add one
line per centre page. Two links, no new design.

## Resolved by rebuilding

- **No `<meta name="viewport">` and no responsive layout.** Fixed: the site is fluid and asserted
  at 390px.
- **Four addressable hosts.** Fixed: one canonical host, enforced with a 308.
- **No page description, no Open Graph, homepage `<title>` of "About".** Fixed.
- **No robots.txt; a sitemap with 2018 dates and `http://` URLs.** Fixed, and the sitemap is
  generated from the route list so a page cannot be forgotten.
- **Every `<img alt="">`, including the logo; headings faked with styled `<p>`.** Fixed: real
  heading elements throughout. Every photograph now carries a described `alt`, asserted by a test —
  axe cannot catch this, because `alt=""` is a *valid* way to say an image is decorative and no tool
  can tell that a photograph of a playground is not.
- **The tagline and the centre names were images of text.** Adobe Muse rendered them as PNG, so they
  could not be selected, translated, searched or resized. They are real text now, and the PNGs were
  not brought across.
- **Philosophy only as a PDF.** Now a page, with macrons restored and its typos fixed.
- **"Our Centres" described rooms, not centres.** Split into `/centres/*` and `/rooms`.
- **Careers was a mailto link, so every application lived in a shared mailbox** with no record of
  who had been replied to. Now a form that creates a record the centre's manager can act on. The CV
  still arrives by email — gap 12.

*Last updated 2026-08-16.*

*The closing line here used to read "nothing on the site is unsourced". **That is no longer true and
the correction is gap 17**: the four "Why pearls" paragraphs on the homepage come from the design
handoff rather than from the centre, and they are awaiting the manager's sign-off. Everything else
above is still a question for the centre rather than a claim on the page.*
