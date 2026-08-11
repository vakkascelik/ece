# Change log

*Append-only record of all wiki changes. Correcting an earlier entry means a new entry that
says so.*

---

2026-08-11 — **The footer is their coral, the social accounts are on the site, and the bare console
hostname stopped being a 404.** `apps/site/src/app/globals.css`, `apps/site/src/app/layout.tsx`,
`apps/site/src/lib/centres.ts`, `apps/web/next.config.ts`, `apps/web/src/app/login/layout.tsx`,
`apps/web/src/app/globals.css`. See [[public-website]] and [[deployment]].

Four requests, and the interesting part is that two of them were one-line changes that were not.

**The footer background was asked for as "same as current one; pinkish" and the colour was the easy
half.** `--coral` is `#ff6565`, already in the tokens from their own stylesheet. But `tokens.ts` has
recorded from the beginning that none of their brand colours can carry text, and both colours already
in that footer fail on coral — body `--ink` at 2.44:1 and `.foot-head`'s `--teal-ink` at 2.01:1, the
worst pair on the page. Their live site puts white on it, at 2.88:1. So `background` alone would have
shipped two contrast failures onto every page of a compliance product and looked perfect doing it.
All the footer text moves to `#1b1a18` (6.05:1), and the `--teal` hairline — 1.19:1 on coral, not a
violation but invisible — becomes a tone of the text. `#1b1a18` on coral was **already** an asserted
pair, so this cannot regress silently, and `audit:site` makes the claim a measurement: 20 page views,
10 routes, two widths, no violations. `--coral-ink` was rejected: it takes white at 5.85:1 and would
have matched their arrangement, but it is a brick, not the pink that was asked for.

**The social links are words, not icon bubbles.** `img-src` is `'self' data:`, so each icon is a
committed asset or an inlined path — and the developer credit already refuses inlining somebody
else's mark because it is one `fill` from breaching their guidelines. An icon-only link also needs a
name supplied separately, which is a name nobody proofreads. Their current footer still shows a bird
for X, which makes the point on its own.

**`ece-production-fc07.up.railway.app/` was a 404 and that was reported, not predicted.** `basePath`
moves every route, so the bookmarked address broke while the console was fine at `/portal/login`. A
`redirects()` entry with `basePath: false` sees the unprefixed path and sends `/` to the mount. Root
only: `/:path*` would match the raw `/portal/login` and loop it to `/portal/portal/login`. 307, for
the sticky-308 reason already written up twice in this repo.

**The console footer was the request worth refusing as specified.** Little Pearls' coral footer on the
sign-in page would compile one customer's address book into a build that serves every centre — the
first Key Point in [[deployment]] is that nothing about a centre is in it. A relative
`<a href="/">Back to the website</a>` needs none of that: `/` on the host it was served from *is* the
customer's site, whoever they are. The trick is that it must be a plain anchor and never `next/link`,
which prepends `basePath` and would send somebody trying to leave straight back to `/portal` —
confirmed in the shipped HTML, where the anchor is `/` and the script beside it is `/portal/_next/…`.
It sits in a `login/layout.tsx` because `page.tsx` is `'use client'` and cannot read a non-public
variable, and a `NEXT_PUBLIC_` twin would be two variables for one fact.

**Verified rather than inferred, including the bit a layout could have broken.** Wrapping `/login` in
a layout is exactly the change that could kill the sign-in flow, so the action was posted through the
proxy with the real `$ACTION_ID`: the response carries `Those details are not right.`, meaning the
server action ran, reached Supabase and came back. The e2e suite was **not** run — with the mount
unset the layout renders nothing at all, so its unmounted behaviour is unchanged by construction, and
the mounted path is not something Playwright can reach without rewriting every navigation.

2026-08-11 — **`deploy:auth` threw away the path, which would have sent every invitation to the
marketing homepage.** `scripts/deploy-auth-config.ts`. See [[deployment]].

Found by reading the script before running it against the live project, which is the only reason it
was found at all. It set `site_url` from `new URL(domain).origin`, and `origin` discards everything
after the host. That was right while the console owned its hostname and became wrong the moment it
was mounted at `/portal`: **every invitation and password-reset link lands on `site_url`**, so a new
kaiako would have clicked their invitation and arrived at ten pages of marketing copy with an auth
token attached to a page that cannot use it. No error, no log line, and a symptom that reads as a
broken email rather than a missing path segment.

The path is kept now, and `uri_allow_list` inherits it, which is a tightening rather than a side
effect — a redirect target outside the console should never have been permitted. Verified with
`--dry-run` first, then applied: `site_url` is
`https://little-pearls-production.up.railway.app/portal`.

Two things about the old value that make this urgent rather than tidy. It was
`https://ece-production-fc07.up.railway.app`, and that root **now 404s**, because `basePath` moved
every route in the app — so any invitation issued before today is already dead, not merely pointing
somewhere stale. And the PAT in `.env.local` had expired, so the whole Supabase half of this work
was unreachable until it was replaced; the token is account-wide and listed a second, unrelated
project, which is the hazard `deploy-railway.md` already describes.

2026-08-11 — **The console has no domain, so it is served from the customer's website at
`/portal`.** `apps/web/next.config.ts`, `apps/site/next.config.ts`, `apps/site/src/middleware.ts`,
`apps/site/src/app/robots.ts`, `apps/web/src/lib/securityHeaders.ts`, `railway.json`. See
[[deployment]].

The alternative was sending families to `ece-production-fc07.up.railway.app`. A subdomain of
`littlepearls.org.nz` was the cheaper answer and was dropped on instruction — `portal.` does not
resolve and the website is still on its Railway hostname — so the only remaining way to reach the
console from one address is a path mount. **Railway routes by hostname, not by path**, so the
marketing container proxies `/portal/*` to the console service and `apps/web` runs with `basePath`
set to the same prefix.

`basePath` rather than stripping the prefix at the proxy, and the reason is not style: both apps
otherwise serve assets from `/_next/`, and the website's chunks answering the console's requests is
a page that renders and then dies in hydration. Verified rather than argued — the console's HTML
now contains no unprefixed `/_next/` reference at all, and both apps' chunks return 200 on one
origin.

**Four traps found by reading, one by running.** `basePath` moves `/api/health`, so `railway.json`
had to name the prefixed path or the deploy would have failed its health check with a container
serving perfectly — `:3001/api/health` returning 404 locally is the proof it was needed. The
website's middleware had to stop matching `/portal`, because middleware runs *before* the config
rewrites and would have stamped a second CSP, with a nonce from a different response, onto every
console page. `rewrites()` is baked into `routes-manifest.json` at build time, so setting the
destination on a running service does nothing. And excluding `/portal` from that matcher removed
the only `X-Robots-Tag` covering it while `robots.txt` said `allow: /` — the console would have
been *invited* into search results, and `apps/web` had no robots handling of any kind.

**A comment was deleted for asserting a constraint that does not exist.** There were two rewrite
rules, the second on the assumption that `:path*` would not match the bare `/portal`. The generated
manifest disagreed — the segment group is optional — and a running proxy confirmed `/portal` 307s
to `/portal/login` with one rule. The extra rule was harmless; its comment was not, because a wrong
comment outlives the code it explains.

**The Windows trap in `CLAUDE.md` fired twice in one session, in two different tools.**
`export ECE_PORTAL_MOUNT=/portal` in Git Bash reached `next build` as `C:/Program Files/Git/portal`
and both builds failed; the identical conversion then wrote that same string into **both Railway
services** through the CLI, where it was caught only by reading the values back. MSYS2 rewrites
POSIX-looking values whenever it spawns a native process, and `railway.exe` is as native as
`next build`. A leading slash on the mount is now optional so a value with no slash can be used on
Windows, but the durable lesson is the readback: **set a variable, then print it.**

**Two gates could not be run at first, and one still cannot be trusted to this change.** The
Supabase PAT in `.env.local` was dead — `GET /v1/projects` returned 401 — and `SUPABASE_DB_URL`
was empty, so `test:rls` and `review:security` had no credential at all. With a fresh PAT both
pass: 447/447 isolation assertions, 16/16 security checks. `check:bundle` fails, `apps/web`
first-load JS 112.9kB against a 106kB budget — and that is **not this change**: reverting both
`apps/web` files and rebuilding gave the identical 112.9kB, so it belongs to the uncommitted root
layout and brand-mark work in the tree, which is left uncommitted here.

**The e2e suite does not cover the mount**, and saying so is the point. Playwright resolves
`page.goto('/login')` with `new URL()`, so a leading slash discards any prefix on `baseURL`;
covering the mounted config would mean rewriting every navigation in about twenty spec files. The
suite proves the app unmounted. The mount's coverage is manual.

**One debt, with a date on it.** Supabase's `site_url` is a single value for the whole project, so
while it points at this mount, *every* tenant's invitation and password-reset links land on Little
Pearls' hostname. Doorway needs a domain before customer #2 — not before go-live.

2026-08-11 — **Correction: `doorway.co.nz` is not available, and never was on the day the name
was adopted.** `llm-wiki/wiki/unverified-claims.md` §19. See [[unverified-claims]].

The entry recorded the domain check as the one of three that was *done*. It was the one that was
wrong. The .nz registry (`whois.srs.net.nz`, queried directly rather than through a registrar's
search page) has `doorway.co.nz` registered through 1st Domains, delegated to `ns1/ns2.afternic.com`,
and carrying `pendingDelete`, `redemptionPeriod` and `serverHold` since 2026-07-04.

Read that carefully, because it cuts two ways. It is registered, so the claim was false. But
Afternic is GoDaddy's aftermarket and those statuses are a lapse, not a business — and
`Original Created: 2006-06-02` against `Creation Date: 2024-07-04` says the name already dropped
once and was caught by a reseller who has now failed to sell it and stopped paying. **A parked
domain is a speculator, not a competing user of the word, so this does not move the trade mark
risk that §19 exists to track.** The IPONZ result from earlier the same day stands untouched.

`doorway.nz` was briefly written up here as the real threat — registered since 2020, Cloudflare
nameservers, fully locked, so presumably somebody's business. **Fetching it took thirty seconds
and killed that reading.** It serves 384 bytes of `<frameset>` pointing at
`jsp.netregistry.net/theBizCard.jsp`, empty title, empty description; MX is `partnerconsole.net`.
Both are Netregistry defaults. Six years registered, nothing built. Locked-and-delegated is what
a registrar does by default, not evidence of a going concern, and treating it as evidence was the
same mistake in miniature as trusting the registrar's search page.

Two smaller things, both recorded because they are about method. The registrar page also
reported `doorwayy.co.nz` unavailable; the registry returns `Not found`, i.e. it is free. So a
registrar's search was wrong in both directions inside one day. **Ask the registry.** And the
90-day .nz pending-release period, which would put `doorway.co.nz`'s release in early October
2026, is written into §19 as a figure to check rather than a figure checked — it came from
knowledge of .nz policy, not from anything queried.

2026-08-11 — **The overview answers a question, and the rail becomes chrome.**
`apps/web/src/app/(app)/page.tsx`, `globals.css`. See [[console-handover]].

The overview rendered a count of who has a login and a card about data sensitivity. Neither is
something anybody signs in to find out, and it was the screen every person in the product lands
on. It now carries the ratio band — the same `RatioBanner` the roll uses, not a smaller copy —
and a **Needs attention** list built from `summariseIncidents`, `summariseHazards`, `assessAll`
and `drillStatuses`, each item linking to the screen that fixes it. Every figure is the same call
its destination makes, so a count here cannot disagree with the page it points at.

`drillStatuses` returns `overdue: boolean | null` and `facilities.ts` warns callers: `null` means
no interval stated, which is a third state and not a late drill. The filter is `=== true`, so a
centre that declined to state an interval does not appear permanently overdue against a rule it
never set.

**The rail is sunken, not dark, and the numbers chose it.** On `--ink`: white 17.39:1, but
`--ink-muted` 2.65:1 and `--accent` **2.90:1** — and `--accent` is the current-page colour. A
dark rail needs a second accent and a second muted existing only there, which is a parallel
palette for one region, and this repo has already paid for one of those. On `--surface-sunken`
every foreground already present still passes AA. **No state colour was spent**: green, amber,
red and blue still mean one thing each, which is the only reason a red flag on a roll means a
child could stop breathing.

2026-08-11 — **Every handover capture refreshed against the current shell.**
`handover/screens/`. See [[console-handover]].

Five console screenshots were taken before icons, collapsible groups and the Doorway mark landed
— they showed a rail the product no longer has, which for images whose whole job is to show what
was built is worse than having none. All eight refreshed at `deviceScaleFactor: 2`.

Two traps, both now in [[console-handover]]. The capture output path was `process.cwd()`, so
running the harness from `apps/web` — which its own Playwright config requires — wrote five
captures into `apps/web/handover/screens/`, reported success and moved nothing. A path that
depends on where you were standing is not a path. And the harness needed its own Playwright
config, because the main one now excludes `e2e/.artifacts/`; both live there and are gitignored,
so the wiki carries the reproduction steps.

2026-08-11 — **The offline drill stopped needing a human's password, and passed 10/10.**
`scripts/offline-drill.ts`, `README.md`. See [[offline-outbox]].

It signed in as a named person and demanded `ECE_DRILL_PASSWORD`. That is unrunnable by anybody
who is not them — Supabase stores `auth.users.encrypted_password` as a bcrypt hash and no key,
service role or PAT returns it — and it could never have run in CI, which is most of what a
drill is for. It now provisions its own account: a `.invalid` address (RFC 2606, the convention
`seed-demo.ts` already uses), an **educator** membership on the demo centre, and a fresh random
password set per run and stored nowhere. `ECE_DRILL_PASSWORD` still overrides for anybody who
wants to drill as a real person.

Educator rather than owner: `recordDailyPractice` is everything the drill exercises, and a drill
account with more rights than the act it drills is a standing invitation.

**A defect the change surfaced, and it had been there all along.** The second-device client
called `signInWithPassword` and never checked the error. With a stale credential it stayed
*anonymous*, and the failure surfaced three lines later as
`permission denied for table staff_count_events` — which reads like a policy defect and is
nothing of the kind: `anon` has `revoke all` on that table, so the grant refuses before any
policy is consulted and the message never mentions sign-in. Checked now, and named in a comment,
because the next person to see that error will start by reading 0010.

10/10 with the outbox contract intact: three events land, keys are reused without duplicating, an
event keeps the time it happened rather than the time it was sent, two devices agree, and a
20-day-old event is refused with a code the outbox treats as permanent. Still not covered — the
`expo-sqlite` queue itself, which needs a device. A real airplane-mode drill remains required.

2026-08-11 — **A trade mark check was run on "Doorway", and it is good news that is not a
clearance.** [[unverified-claims]] §19.

The owner ran IPONZ's free Trade Mark Check on the word `doorway` with **no class selected**. 25
results, closest-matches-first, and the finding is a negative worth having: **no identical
`DOORWAY` word mark appeared.** The top of a closest-first list was `STAPLES RODWAY`, which is
the matcher reporting it found nothing nearer — an exact mark would have sorted first. The near
neighbours are phonetic: `DOO-AWAY / DOOAWAY`, `Deerway`, `QUAI D'ORSAY`, four `NORWAY` marks.

Recorded as a partial result rather than banked as a clearance, because three limits are on the
tool's own screen rather than invented here: no class was selected and co-existence is decided on
classes; only the first 8 of 25 results were seen; and this is the free pre-application check,
which offers a paid IPONZ search as its own next step. The classes this product actually needs
asked about are 9, 42, 41 and possibly 35, and the same free tool will answer that in a minute.

The companies-register check is still outstanding.

2026-08-11 — **The product is called Doorway everywhere now, and the mark has one source.**
`packages/core/src/brand.ts`, `apps/web` (`icon.tsx`, `apple-icon.tsx`, `DoorwayMark.tsx`,
`layout.tsx` ×2, `globals.css`), `apps/site/src/app/layout.tsx`, `apps/mobile/app.json`. See
[[unverified-claims]] §19.

Three names for one product until today: the console's tab said "ECE Platform", the mobile app
said "ECE", and the only one anybody outside this repo had seen — on a customer's live website —
said Doorway. The console had **no favicon at all**, which is what a browser tab showing a grey
globe was reporting.

`PRODUCT_NAME` and `MARK` are in `@ece/core` now, and the console's rail, the console's two
generated icons and the public site's masthead all read them. Three surfaces drawing the same
logo from three hand-typed copies is the failure `tokens.ts` exists to prevent, applied to
identity — and a drifted logo is quieter and more embarrassing than a drifted colour.

The icons are **generated** by `next/og` from that geometry rather than committed as PNGs.
`apps/site` commits its icon because that is a customer's drawn asset whose bytes are the thing
to keep; ours is three primitives, and a committed raster would be the fourth copy — the one
nobody notices going stale, because nobody diffs a PNG in review. `next/og` ships inside `next`,
so no dependency, which the design handover forbids anyway.

**The name is adopted, not cleared.** The owner confirmed `doorway.co.nz` is available and said
to proceed; that is one check of three. A free domain says nothing about a registered mark in a
class covering software or education services, and it is the mark that can force a rename. §19
is updated rather than closed, and now records that a rename is one edit — `PRODUCT_NAME` — which
is the reason the consolidation was worth doing on the same day the name went into four more
places.

Also corrected a comment on `.side` in `globals.css` that still said collapsing the groups had
been rejected. They collapse; the comment was left over from the reasoning corrected two entries
below.

2026-08-11 — **The nav groups collapse after all, and the entry below was wrong about why they
could not.** `apps/web/src/app/(app)/NavGroup.tsx`, `NavGroupMemory.tsx`, `navGroups.ts`,
`navGroups.server.ts`, `layout.tsx`, `globals.css`, `e2e/a11y.spec.ts`. See
[[console-handover]].

**This corrects the entry immediately below.** It refused collapsible groups partly because
remembering the state "makes the rail a client component with storage on every screen, against a
JS budget already 6.9kB over". That was the load-bearing reason and it was false.
`<details>`/`<summary>` collapses with **no JavaScript at all** — focusable, Enter and Space,
announced as expanded or collapsed, working before hydration. This repo already depends on
exactly that: it is why `HelpNote` is a `<details>` and why the kiosk draws its own keypad. The
counter-argument was sitting in two files in the same directory and was not consulted, and it
was used to decline something somebody had asked for twice.

What survives from that entry are constraints, not refusals, and they shaped the build. Default
**open**, never closed — Attendance is opened dozens of times a day at the door and shipping it
behind a tap would charge everybody to tidy the rail for a few. And it has to be **remembered**,
or you close Money, click Attendance, and Money is back; so a cookie, read on the server, so the
`<details>` arrives right rather than flashing open and collapsing on every load.

The cookie stores what is **closed**. With no cookie every group is open, so the failure mode of
a preference is never "the navigation disappeared".

`navGroups.ts` / `navGroups.server.ts` split for the reason `locale.ts` / `locale.server.ts`
already did — a Client Component needs the cookie's name, and importing it from a module calling
`cookies()` pulls a server-only API into the client bundle. **The build refused, which is the
good outcome**, but it is the second occurrence of this exact split so it is now written down
twice.

`NavGroupMemory` listens in the **capture** phase, because `toggle` does not bubble, and
re-derives the closed list from the DOM rather than tracking state — what is stored cannot drift
from what is on screen. One component beside the nav; `NavGroup` stays a server component.

The e2e test asserts the **memory**, not the collapsing: native `<details>` cannot really break,
the cookie link can, and nothing else would notice because every other assertion opens a page
fresh where the default is open. Mutation-tested by deleting `NavGroupMemory` — fails on the
right assertion with the message that names the cause. 117/117 afterwards.

2026-08-11 — **Icons in the rail, drawn rather than installed; and the rail scrolls itself
rather than collapsing.** `apps/web/src/app/(app)/NavIcon.tsx`, `NavLink.tsx`, `layout.tsx`,
`globals.css`. See [[console-handover]].

Twenty-four hand-authored inline SVGs. No package: this is a few kilobytes of path data against
a library that ships several hundred and updates on somebody else's schedule, and they are
server-rendered so they cost nothing on either budget — `first-load-css` 3.5kB → 3.6kB.

Not text glyphs, unlike the flags, and the distinction is worth keeping straight. `▲` and `✓`
are text over there because they must survive a copy-paste into an email. A nav glyph from a
font renders as colour emoji on Windows and something else on macOS; it needs to look the same
on every tablet in the centre, which is a different requirement with a different answer.

`icon` is a prop on `NavLink`, not part of `children`, so an icon cannot be passed instead of a
label — an icon-only link has no accessible name, and the type forbids the one arrangement that
breaks. 116/116 unchanged is the evidence.

**The dropdown question was measured, then declined.** At 1440×900 with an owner the rail was
1536px tall against a 900px viewport, Sign out began 1299px down, and the page scrolled 636px to
reach it — on `/attendance` that scrolled the roll away. Real problem; grouping had made it
worse by about 80px net. The fix is `position: sticky` plus the rail's own `overflow-y`: rail
900px, page scroll 0.

Collapsing was rejected on this product's terms, not on taste. Attendance is opened dozens of
times a day on a tablet at the door and a collapsed group puts a tap in front of it; the state
has to be remembered per person or it re-collapses on every navigation, which is worse than not
having it; and remembering it makes the rail a client component with storage on every screen,
against a JS budget already 6.9kB over. Scrolling costs nothing and hides nothing.

2026-08-11 — **The CSS budget paid down rather than raised, and two defects the handover never
mentioned.** `apps/web/src/app/globals.css`, `attendance/attendance.css`,
`children/[id]/record.css`, `(app)/page.tsx`, `(app)/children/page.tsx`. See
[[console-handover]] and [[unverified-claims]] §35.

`first-load-css` ended the handover at 4.2kB against a 4kB limit. It is **3.5kB** now — 0.6kB
below where it stood before any of this work began — and the limit was not touched. The ratio
block, the roll, the wall display, the offline strip and the child record's header moved out of
`globals.css` into the two route sheets that now exist. Each is used by exactly one route, and
`check:bundle` measures the root layout's stylesheet, so every screen was downloading the wall
display's 88px numerals.

That is the handover's own route-sheet rule applied backwards to the CSS that predated it, and
the rule turned out to be worth more than the steps written against it: applying it retroactively
recovered about three times what steps 2 and 3 had added. The comments moved with the rules —
a rule that arrives in a new file without its argument is a rule somebody deletes.

`.healthcard*` was deleted rather than moved: step 6 removed its only user. `.eyebrow` is equally
dead and was **left alone**, because it predates this work and the rule is to remove only the
orphans a change creates — named in `globals.css` so the next person starts there.

**Two defects, neither in the handover.** `/` told every owner on sign-in that "enrolment,
attendance and daily records are not built", years after they were — a placard from before the
product did its job, on the one screen everybody lands on. And `/children` carried a child's
anaphylaxis response plan in a `title` attribute: mouse-only meaning, on the roll an educator
scans on a tablet. `AttendanceRow` lost the same pattern in Phase 6; this was the last place it
survived, which is how a rule quietly becomes a preference.

The insurance clause the overview card carried is [[unverified-claims]] §35 rather than a silent
deletion. The product now asserts neither that professional indemnity cover exists nor that it
does not, and that is the honest position rather than the comfortable one.

Whole suite green afterwards: 116/116, including the wall display's computed-font-size assertions
— which is what proves a route sheet that failed to load would fail loudly rather than pass as a
smaller screen.

2026-08-11 — **A screenshot harness in `e2e/.artifacts/` was being collected as a test, and it
poisoned the shared tenant.** `apps/web/playwright.config.ts`, `e2e/narrative.spec.ts`.

Found on the first full-suite run after the console handover. The owner project's `testMatch` is
deliberately inverted — a new spec is picked up by default and excluding one has to be written
down — and `.artifacts/` is where Playwright already keeps its storage state and tenant file, so
a capture harness dropped there matched. It ran ahead of `incidents.spec.ts` alphabetically and
left a **draft incident in the shared audit tenant**: two `Finalise` buttons, a strict-mode
violation, and a failure in a file nobody had touched.

Nothing in the gitignored artefacts directory should ever be a test, and the config now says so.
The second failure was the same settings-Save ambiguity as three earlier ones — `narrative.spec`
drives the AI toggle, which is now the Integrations card.

Whole suite green afterwards: 116/116.

2026-08-11 — **Mobile: a strip that keeps its height, and an empty state that cannot promise
push; step 10 of the second design handover, and the last.** `apps/mobile/components/`,
`screens/`. See [[console-handover]].

`ChildCard` needed nothing: `SignInButton` has rendered one button labelled with the next state
since Phase 2, at 64px rather than the handover's 44, and shrinking the most-tapped control in
the product to match a spec is the regression [[design-system]] already refused once.

`OfflineStrip` returned `null` when the queue was clear, so the roll jumped by a whole strip
every time it drained — under the thumb of somebody already reaching for a child's row, where a
mis-tap signs the wrong child in or out. It keeps its height now, silent, and the reserved box is
hidden from the accessibility tree rather than filled with invisible text.

`EmptyState.action` is required as asked, and is a union rather than a button: `{ label, onPress }`
where there is something to press, `{ next }` where there is not. Two of the three screens have
nothing a reader can do — nothing makes a kaiako post, nothing on a phone enrols a child — and a
required button would have put one there anyway.

**The handover's own example copy would have shipped a false promise.** It suggests "Nothing from
the centre yet — you'll get a notification". This product does not send notifications:
`lib/push.ts` says in its own docblock that none of it has ever run, and it is in
[[unverified-claims]] for that reason. That sentence, on the screen a family opens most, would
have been the product asserting a capability nobody has checked — rule 5, in its purest form,
arriving as a design suggestion rather than as code. The empty states say the opposite instead,
which is true today and which somebody will have to come back and delete when push works.

Verified with `expo export --platform android` as well as typecheck, because Metro's resolver is
not TypeScript's.

2026-08-11 — **The kiosk's connection strip stops moving the roll; step 9 of the second design
handover.** `kiosk/KioskScreen.tsx`, `kiosk/kiosk.css`. See [[console-handover]].

Most of this step was already built: one column, `--target-primary` throughout, the three-step
flow, no affordance leading anywhere else, and a keypad drawn in the page rather than a text
input — which is why the PIN never reaches an input element, a URL or browser storage, and is
what 0044's in-database comparison exists to allow.

The strip is now always rendered. It appeared only when offline, so the roll jumped down the
moment the wifi dropped, under the finger of somebody already reaching for their child's name.
Breach-toned rather than warn, because there is no offline queue here and a tap made now does
nothing; amber would put it in the same class as a certificate expiring next month. The
confirmation is full-screen and clears after eight seconds rather than six — it has to be
readable from where somebody is standing as they turn to leave.

**"Blocking when offline" was refused, and the screen's own comment is why.** `navigator.onLine`
reports the link, not whether the server is reachable, so it warns and never decides. Blocking on
it means a captive portal refuses a sign-in that would have worked, at the door, with a parent
standing there — the same failure the instruction is trying to prevent, reached from the other
side.

2026-08-11 — **Admin screens: sectioned settings, expanding account rows; step 8 of the second
design handover.** `settings/`, `billing/`, `staff/`, `members/`, `packages/api/src/billing.ts`.
See [[console-handover]].

Settings is one form per card with its own save. `updateCentre` already took a partial patch, so
a section writes its own columns and no others — the alternative, hidden inputs carrying the
other sections' values, would make one person's save overwrite another's. Three of the
handover's five section names have nothing to put in them: no rooms, no opening hours, no
per-centre notification preferences, no centre-level retention setting. Empty cards would be
inventing settings.

`listPaymentsFor` is new, and `recordPayment` had been writing rows nothing ever read since
Phase 5 — a balance with no way to see what it was made of. The read needed no new policy:
`payments_select` delegates to the invoices policy, so the boundary is the one asserted since
0019. RLS suite 447/447.

**`bounded-queries.test.ts` caught the first draft**, which was an unpaged select across every
outstanding invoice at a centre. Truncating at PostgREST's silent 1000-row cap would have dropped
payments off the end, so a family who had paid would show a balance with nothing behind it —
precisely the conversation the feature exists to prevent going wrong. This is the check
[[reading-every-row]] exists for, doing its job on a function written the same day.

Adding outstanding counts to the list headers broke two e2e assertions on strict-mode
violations, and the tests were right: each header repeated, word for word, a sentence already
below it. Staff dropped the unlinked-certificate count because the card carries it with the
remedy attached; Accounts reports how many invoices are overdue rather than repeating the money
figure.

2026-08-11 — **The incident form gets two columns and keeps having one button; step 7 of the
second design handover.** `incidents/NewIncident.tsx`, new `incidents/incidents.css`. See
[[console-handover]].

The layout is the easy half: guide left, fields right, sticky action bar. The decision worth
recording is what was *not* built. The handover asks that Save draft and Finalise never sit
adjacent without an irreversibility warning between them — and this form has no Finalise button
at all, because finalising is a control on the register row, pressed by somebody who has read the
draft back. The form's own docblock made that argument before this handover existed: "a 'save and
send' would be pressed by somebody standing up holding a crying child". Adding one to match a
mockup would have undone it. The requirement is met more strongly than the mockup expresses it.

Amend now quotes what the original said. `basedOn` carried the text and spent it entirely on
pre-filling the fields, so an amendment was written by editing over the only on-screen copy of
what the family had already read — which is how two records come to disagree.

2026-08-11 — **The child record becomes five routes; step 6 of the second design handover.**
`children/[id]/` — new `layout.tsx`, `[tab]/page.tsx`, `RecordTabs.tsx`, `tabs.ts`, `record.css`
— plus six e2e specs. See [[console-handover]].

Tabs as routes, so a manager can send a colleague straight to the health tab. The part worth
recording is what tabs nearly cost. This record's one safety decision is that health is read
before identity metadata, because an allergy is read by somebody holding a child who has eaten
something; health on its own tab puts that allergy one tap away from every other screen, which is
worse than the scroll it replaced. So the flags moved into the header — breach-toned with the
response plan inline — above the age and date of birth and on **every tab**. The a11y tripwire
was rewritten from "Health `<h2>` precedes Details `<h2>`" to "the critical flag is measurably
above `.record-meta`, on all five tabs", which asserts more than it did.

**Learning is not built and its tab is absent rather than empty.** Nothing associates a post or a
curriculum strand with one child in a way this record could read; building it is a feature, not a
restyle, and an empty tab is a promise the product does not keep.

`notFound()` on an undefined tab renders the not-found page with a **200**, because the layout
streams and the status is already sent. Recorded because a status-code assertion looks obviously
right and cannot work here.

**A fifth pre-existing e2e break from `712ba7d`**, this one in `absence.spec.ts`: the Whānau help
note quotes the confirmation panel's caveat almost word for word. Five assertions across three
files now, all the same mechanism — the product documents its own copy on the same screen, and a
locator that matches copy by text stops pointing at the thing the copy describes. The rule: a
test that matches product copy needs a container.

2026-08-11 — **Attendance gets the ratio band and the queue count; step 5 of the second design
handover — and three e2e tests were already red.** `attendance/` (`page.tsx`, `RollClient.tsx`,
`AdultCount.tsx`, `AttendanceRow.tsx`, `OfflineStrip.tsx`, new `attendance.css`),
`e2e/offline.spec.ts`, `e2e/journey.spec.ts`. See [[console-handover]].

The screen work is straightforward: the ratio takes the width, the adult count sits beside it
with 44px ± controls, the health conditions that were already being fetched and discarded now
render on the row, and the "Here now" heading carries the queue count for that section. The new
CSS is route-scoped, and `check:bundle` measures the root layout only — so this step added shared
styles and moved `first-load-css` by **zero**. That is what the handover's route-sheet rule is
for, and steps 2 and 3 should have asked the question sooner.

**The finding is the tests.** Running the offline and journey suites — which steps 1 to 4 gave no
reason to run — turned up three failures, all red on `main` before this step, all with one cause.
`712ba7d` added in-product help that quotes the product's own sentences, and two of those quotes
are strings the suite matches on. `getByText('Waiting to send')` now resolves to two elements;
`getByText(/have not been checked against the regulations/i).first()` now resolves to the
**hidden help paragraph** rather than the visible ratio caveat.

The second is the one that matters. That assertion is the tripwire that stops the unverified-ratio
caveat being deleted from the banner while the flag says it is unverified. Pointed at the help
note, it was passing on hidden prose *about* the caveat and would have kept passing after the
caveat was removed. A tripwire satisfiable by documentation of itself is not a tripwire. Both are
scoped now, and the general rule is written down: once a product documents its own copy on the
same page, matching that copy by text stops being a way to find the thing it describes.

Nobody noticed because the help commit touched no route, no role and no schema, so none of
AGENTS.md §5's triggers called for the full e2e suite. The suites most likely to break on a copy
change are the ones nothing tells you to run.

Also: the offline strip said "1 sign-in **are** saved on this device". Only the noun was
pluralised, and the singular is the first queued tap — the moment somebody decides whether to
believe the screen about a child in the building.

2026-08-11 — **Status becomes a component; step 4 of the second design handover.**
`apps/web/src/app/(app)/Status.tsx`, `globals.css`, incidents, attendance, compliance. See
[[console-handover]].

The CSS was never the ad-hoc part. `.flag` and its four modifiers were already one block; what
varied was the **glyph**, typed by hand at every call site — warn as `●` on one screen and `◌` on
the next, ok as `✓` here and nothing there. That symbol is not decoration, it is the half of
1.4.1 that keeps the meaning off colour alone, and a tone whose symbol changes between screens is
one a reader re-learns each time. It is bound to the tone now, and `aria-hidden`, because "black
up-pointing triangle, 1 whānau not told" is worse than the sentence.

Five tones, not the four specified. The handover's own mockup draws a grey "3 awaiting
acknowledgement" beside the amber and red ones, and that is not `pending` — pending is the
offline queue's blue in this product, so rendering it there would say three reports are stuck in
the outbox.

**A correction to the step 3 entry above: the CSS budget did not come back here, as that entry
predicted it would.** The duplication `Status` removed lives in TSX, which the CSS budget does
not measure. Consolidating three identical copies of the eyebrow declaration was a real saving
and still did not move a figure reported to one decimal place. `first-load-css` is 4.2kB against
4kB — 0.1kB of that is this handover's, and 0.1kB predates it. That is a number to raise or pay
down deliberately, not to keep predicting away.

2026-08-11 — **One page header replaces four spellings; step 3 of the second design handover.**
`apps/web/src/app/(app)/PageHeader.tsx` and every `page.tsx` under `(app)` bar one. See
[[console-handover]].

The component is not the interesting part; the bottom margin is. Four spellings of the header
also meant four amounts of space under it — an inline `1.25rem`, a `marginBottom: '1rem'` on the
subtitle, `.sub`'s default `2rem`, or nothing — so the first line of content began at a different
height on almost every screen. `PageHeader` owns that number now and every inline override is
deleted.

`helpHref` is the trap in this step and is documented as one. The handover names the prop and
draws a `?`, which reads like an anchor to `/help`; it is actually the route key `TabHelp` looks
a doc up by, and what renders is the in-place `<details>` disclosure committed the day before.
Implementing the prop name literally as a link would have silently reverted [[in-product-help]].

Applying "at most one filled button" found three screens that deserve **zero**. `/reports` had
two filled buttons whose only job was to navigate elsewhere; `/attendance` has a wall display and
a download, while the thing it exists to do is on the row. On a read-only screen a filled button
promises a next action that does not exist.

`children/[id]` is deliberately still on `.record-head` — step 6 rebuilds that header, and
converting it here would mean inventing an avatar slot now and discarding it then.

`first-load-css` went 4.1kB → 4.2kB against a 4kB limit that was already breached. Nothing was
orphaned that could pay for it. Step 4 is where it should come back.

2026-08-11 — **Twenty-one nav links become six groups; step 2 of the second design handover.**
`apps/web/src/app/(app)/NavGroup.tsx`, `layout.tsx`, `globals.css`. See [[console-handover]],
and a correction to [[conventions]].

The spec's mechanism was implemented and its arithmetic was not, because the two disagree. It
predicts "an educator sees three headings and a parent sees none"; against the capability matrix
the rule it specifies gives an educator **four** (Staff and Roster ride on
`recordDailyPractice`, so People survives) and a parent **two** (Overview, Children, Posts and
Messages carry no `can()` guard at all). Making the sentence true would mean inventing capability
conditions for four unguarded links, which the same spec forbids two sentences later. The
counts are recorded rather than engineered around.

The footer's three links went into a second labelled `<nav>` rather than a bare list, and that
was decided by reading `roles.spec.ts` first: it scopes every nav assertion to
`aside.side nav` and asserts Help is visible for all four roles. A bare `<ul>` would have failed
four tests with something that looks exactly like a capability regression and is not.

**A correction to [[conventions]], earned the hard way.** That page says `recentlyToday()` clamps
the fixture's midnight trap. It clamps it *at seed time only*. This run seeded at 00:00:23 and
asserted at 00:01:50, so the sign-in was stamped on the 10th and read back on the 11th; the roll
emptied and the wall display's unverified-ratio caveat, which renders only when somebody is
present, was not on the page. One failure in fifty-six, in a test with nothing to do with
navigation, on the one night this work crossed midnight. No clamp can fix it — the day changes
after the clamp has run.

2026-08-10 — **The menu button moves to the left; step 1 of the second design handover.**
`apps/web/src/app/(app)/SideRail.tsx`, `globals.css`, `eslint.config.mjs`. See
[[console-handover]], and the superseded notice now at the top of [[design-system]].

A one-file change, recorded because of what it is a step of rather than what it does. The new
handover (`handover/ECE Handover.dc.html`) is ten steps of structure with **no token changes at
all**, which makes it the opposite of the pack it supersedes, and the first thing it asks for is
the drawer's toggle moved to the edge the drawer opens from.

The instruction that earns a log entry is "reorder the source, do not use `order:`". Both give
the same screenshot; only one gives the same tab order. That is 1.3.2 and it is invisible to
every check in this repo — axe reads the DOM, so it sees the sequence the CSS has already lied
about. The e2e suite passed unchanged (56/56) because the accessible name is unchanged: "Menu"
moved from a visible text node into a `.visually-hidden` one rather than into an `aria-label`,
so `getByRole('button', { name: /Menu/ })` still matches. That locator, written for a different
reason, is what made the change safe to verify.

`handover/` joins `design_handoff_ece_platform/` in the eslint ignore list — same shape, same
vendored `support.js`, 93 `no-undef` errors that say nothing about this repo.

2026-08-10 — **The plumbing for a te reo Māori interface, deliberately not the interface.**
`next-intl`, `apps/web/src/i18n/`, `apps/web/src/lib/locale.ts`,
`apps/web/messages/`, `/account`. See [[i18n]], [[unverified-claims]] §34.

The roadmap scoped this item itself as "mechanical work touching every component… a week
of tedium," and the honest response to that is not to fake a week of tedium in one sitting.
Generating te reo Māori text for every string across two apps with no fluent reviewer in
the loop would be asserting content this repo cannot check — the same failure
unverified-claims exists to name, and this repo has already paid for exactly that class of
mistake once, a macron on the wrong letter. So: the technical plumbing, built and proven
against one real page, with every translated value left as an explicit, prefixed
placeholder rather than a guess dressed up as an answer.

**A cookie, not next-intl's own `[locale]` routing.** That mode needs its own middleware,
and `middleware.ts` already does the one job the whole security model depends on — minting
the CSP nonce that lets `script-src 'strict-dynamic'` hold. Composing a second middleware
in was a real way to break that silently, the same failure mode root layout's own header
comment already records for a different mistake. `ece_locale` costs one cookie read in
`i18n/request.ts`, no middleware at all — the same shape `CENTRE_COOKIE` already uses for
which centre is active.

**A file split the build caught the need for, not reasoning ahead of time.** The first
draft put `LOCALES`/`Locale`/`LOCALE_LABELS` and the cookie-reading `getLocale()` in one
file. The build failed: a Client Component importing the constants pulled in `next/headers`
transitively, and Next refuses to bundle *any* import from a file that touches a
server-only API into client code, even an export the client never uses. Split into
`locale.ts` (pure) and `locale.server.ts` (the cookie read) and it compiled clean.

**One page, chosen to exercise both halves of next-intl's API.** `/account/page.tsx` is a
Server Component and awaits `getTranslations()`; its child `ChangePasswordForm.tsx` is a
Client Component and calls the hook form, `useTranslations()`, un-awaited. Migrating a page
that only needed one would have left the harder half — the one that actually ships to a
browser — unproven.

**The `[mi]` prefix on every value in `mi.json` is the entire safeguard against this
looking finished when it is not**, and nothing enforces it. Selecting "Te reo Māori" in the
switcher on `/account` proves the mechanism and shows, unmistakably, that the content
behind it is not real. unverified-claims item 34 says so and says what closing it means:
page by page, a fluent speaker, starting from the one page this actually reaches.

Verified against the running dev server rather than only the build: the cookie → config →
render pipeline checked on the unauthenticated `/login` page (shared root layout, so no
sign-in needed) — no cookie and an explicit `en` both render `<html lang="en-NZ">`, `mi`
renders `mi-NZ`, and a garbage value falls back to the default rather than erroring. A fully
authenticated check of `/account`'s rendered strings was attempted — replicating Next's
Server Actions POST protocol by hand through curl — and abandoned as disproportionate to
what the build's own RSC-boundary failure already proved.

---

2026-08-10 — **The lowest-priority item in the whole roadmap, and it still found two real
bugs.** 0058, `curriculum_strands`, `post_strands`. See [[curriculum-strands]],
[[unverified-claims]] §33.

Tier 4: tag a post to a Te Whāriki strand, so the evidence binder can show curriculum
coverage. The roadmap's own ranking puts this last, ahead of nothing — "do not build a
portfolio product" is the paragraph before it, and this is the one piece of that space that
is actually compliance rather than pedagogy.

**Seeded, not left empty — and that is a real distinction from `criteria`, not a shortcut.**
`criteria` refuses to guess because Ministry numbering gets renumbered periodically; the five
strand names are the stable top-level structure of a document unchanged since 2017. Seeded
with a `source` column all the same. What is NOT seeded, and has no column for it at all: any
goal or learning outcome under a strand — that is where the real detail and the real
disagreement lives, and transcribing it from memory would be asserting curriculum content
nobody here has checked.

**Said plainly rather than skated past: the five te reo names have not been diffed against a
primary source either**, only transcribed from consistent field knowledge. This repo has
already paid for exactly this class of mistake once — a macron rendered on the wrong letter,
`Māori` as `Maōri`, caught only by somebody looking at the page. A wrong macron in a column
labelled "source: Te Whāriki, 2017" is the quieter, worse version of the same failure,
because a compliance document is more likely to be checked than a heading font was.
unverified-claims item 33 records it and says what would close it.

**`post_strands` delegates its read policy to `posts` rather than re-deriving the
guardianship logic.** A policy's USING clause may reference another table, and that
reference is itself subject to the referenced table's own RLS — so `post_id in (select id
from public.posts)` already returns exactly what this caller could see, without a second
copy of `posts_select`'s branches to drift from the first.

**Caught before either was ever committed: a `FOR ALL` policy that reintroduced a bug 0022
had already removed.** The first draft copied `post_children_write`'s shape from reading
0013's *original* text rather than its current, live form — `post_children_write` had since
been split into separate INSERT and DELETE policies, precisely because a table with both a
`FOR SELECT` and a `FOR ALL` policy carries two permissive read paths that OR together, the
shape that produced the Phase 4 consent leak. `review:security` flagged it immediately.
Fixed in 0058 itself.

**And a PL/pgSQL trap the suite's own house style walked into.** Every permission-refusal
assertion in this file captures a result in a variable called `code`. `curriculum_strands`
has a real column also called `code`. `where code = 'wellbeing'` inside a block with
`declare code text` is genuinely ambiguous — PL/pgSQL raised 42702 rather than guessing,
caught only because the assertion was checking for 42501 specifically. Fixed by qualifying
the column (`curriculum_strands.code`) rather than renaming the variable everywhere else
already uses.

9 new RLS assertions, 447/447 overall. 16/16 security review after the policy split. Verified
end to end against the real database: tagging a draft leaves the binder's coverage count
unchanged; publishing makes it appear with no separate step.

---

2026-08-10 — **A queue that had a writer for nobody and a reader for nothing, for three
days.** 0056, 0057, `broadcast_emergency`, `/broadcast`, `/notifications`. See
[[emergency-broadcast]].

Phase 12's "emergency broadcast" item. `notifications` (0017) shipped with quiet-hours
arithmetic tested to 17 assertions and nothing in either app that ever wrote to it or read
from it — `grep` for `.from('notifications')` outside its own migration found nothing.

**The word "broadcast" does not mean what it usually means here, and the form says so.**
The roadmap asked for this built on push and email; this project has neither, and building a
real email vendor integration to make the word honest would be its own multi-day
undertaking with its own privacy-statement change — the exact shape of decision already made
once about SMS and deferred. So this ships the one channel that is real: a row on a page a
family has to think to open. `BroadcastForm.tsx`'s own copy says exactly that rather than
letting the word oversell it.

**`SECURITY DEFINER`, the same shape as `purge_child`, for the same reason.** Sending one
means writing into every active member's row — a fan-out 0017's own comment had already
called "a service-role action, like onboarding" when it declined to grant `authenticated`
any INSERT. The function's own `caller_has_role` check is therefore the only thing between a
caller and a centre that is not theirs, because SECURITY DEFINER bypasses every policy below
it.

**A separate `emergency_broadcasts` table, append-only, revoked from `service_role` too.**
`notifications_own` restricts a row to its recipient by design — an owner has no policy to
browse forty individual deliveries. So this is the fact instead: what was sent, by whom, to
how many. Checked by trying to delete a manual test row and being refused, the same way
`waitlist`'s missing DELETE grant got found two days ago.

**The RLS suite caught a real mistake in its own first draft.** The recipient-count
assertion originally checked the total as the sending owner, immediately after the call. It
failed — correctly: `notifications_own` means an owner reads only her own row through
ordinary RLS, same as anyone else, and the fan-out total is not a fact a normal session can
see in one query. Needed `service_role`, the same bypass the function itself uses. Left the
mistake in as the comment, because it is the kind one writes again without it.

**The recipient count in the test is computed, not remembered.** The shared fixture is 5,800
lines deep by the point this block runs, and an earlier test has already revoked one of
centre A's four memberships. A hard-coded `4` would have been a plausible number that was
simply wrong — the count is read from `memberships` at assertion time instead, which is also
the more honest description of what "reaches everyone" is supposed to mean.

**`wantsKind` gained a kind with no preference to check.** `emergency` has no boolean in
`NotificationPreferences` and will not get one — nobody opts out of an evacuation notice — so
the function returns `true` unconditionally for it rather than reading a field that does not
exist.

**What this is not, said plainly rather than left implied:** no unread badge, no push, no
email. A family has to think to open `/notifications`. Closing that properly is push
delivery working at all, which is unverified-claims item 5 and needs a device this session
does not have.

438/438 RLS (14 new), 16/16 security review, 495/495 unit tests, full build. Verified against
the real dev database end to end — signed in as the demo owner, sent a broadcast, read it
back through the API layer the web app actually calls, not just through raw SQL.

---

2026-08-09 — **`drill:offline`, finally run, and a bug it could not have found any other
way.** `offline-drill.ts`. See [[unverified-claims]] §21, [[offline-outbox]].

Item 21 has sat open since 2026-08-06: the web outbox had never been through the drill AGENTS
§5 names for this, because it needs `ECE_DRILL_PASSWORD` — the demo centre owner's own login —
and nobody had it to hand in the session that built the feature.

**The password for that account was not recoverable, only resettable.** Supabase stores a hash,
never the password, so there was no "look it up" available once it was not remembered. Reset
through `auth.admin.updateUserById` with the existing service-role key — the same mechanism
`seed-demo.ts` already uses for its synthetic parent — after asking first, because it is a real
login credential and changing it without saying so first would be the wrong kind of quiet.

**The admin client crashed on this machine; the Management API did not.** `auth.admin.listUsers()`
and `updateUserById` both took down the whole process with `AuthRetryableFetchError` followed by
a native libuv assertion (`UV_HANDLE_CLOSING`) — Windows, Node 24, something in how the GoTrue
admin endpoint's response is handled, not investigated further because a working path already
existed one line away. `test-rls.ts` already falls back to the Management API
(`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`) when `SUPABASE_DB_URL` is unset, for the exact
reason documented there — a PAT is account-wide and this repo already treats that as the
less-preferred, more-available fallback. The same endpoint, `crypt(..., gen_salt('bf'))` against
`auth.users` directly, set the password without going near the client that was crashing.

**The drill then failed for a second, unrelated reason, and it was the more important one.**
`.like('slug', '%albert%').single()` used to match exactly one centre. It now matches two —
`demo-mt-albert` and a real `little-pearls-mt-albert` tenant this project has since onboarded —
and `.single()` fails on two rows exactly as it fails on zero, so the drill's own die() message
("run onboard first") pointed at a database that already had the centre, just not uniquely.
**Only found by running it against what the database actually holds today**, which is the whole
argument for the drill existing rather than trusting that "the same function" was enough.

Fixed to an exact match on `demo-mt-albert`, the slug `seed-demo.ts` itself commits to and
guards elsewhere in that script. Worth stating plainly: the fuzzy match was not just broken, it
was a standing risk — a differently-named future centre could have made this drill write
invented attendance events into a real tenant instead of refusing to run.

10/10 drill checks passed once both were fixed: offline queue counts and pending-marking, first
flush lands exactly three events, a forced second flush recognises all three as duplicates
rather than writing more, a corrected sign-in time survives the outage, two devices agree on the
same server state, and a 20-day-old event is refused with the code the outbox treats as
permanent. **No cleanup afterward** — `offline-drill.ts`'s own header explains why: attendance is
append-only against the service role too, so clearing it needs the database owner, and the rows
sit in a tenant literally named "invented data".

What is still open, and always was a separate claim: the `expo-sqlite` queue itself needs a real
device, which is item 15, not this one. Item 21 is closed; item 15 is not.

---

2026-08-09 — **Two reports the roadmap called "waitlist conversion", and two importers that
refuse to guess a vendor's file format.** `attendanceTrend.ts`, `enquiryFunnel.ts`,
`/reports/trends`, `/reports/waitlist-conversion`, `import-storypark.ts`,
`import-discover.ts`. See [[reporting]], [[unverified-claims]] §31–32.

The last of Phase 13's non-money items from `docs/roadmap-phases-8-13.md`: attendance trends,
waitlist conversion, and the Storypark/Discover importers.

**It is not called "waitlist conversion" on the page, and the roadmap's own name is wrong.**
`enrolment_applications.status` is current state, not history — an enquiry that reached
`waitlisted` and later became `enrolled` now says `enrolled`, and the fact it passed through
that stage is gone from the row. The schema can answer "of everyone who enquired, how many
became a placement", not "of everyone who was ever waitlisted, specifically", and building the
second question anyway would have been the exact confidently-wrong report AGENTS.md §4.5
forbids. The page is titled for the question it actually answers.

**The conversion rate divides by decided enquiries, not by all of them**, and is `null` rather
than `0%` when nothing has been resolved — the same shape `averageChildren` already uses in
`occupancy.ts`, because `0%` reads as "every enquiry is failing" when the truth is "nobody has
been contacted back yet".

**`averageOverOpenDays` came out of `occupancy.ts` before it could be written a third time.**
The daily average, a new weekly one, a new per-weekday one — three chances for the rounding or
the open-day filter to drift apart. One function, three callers, caught before the second copy
existed rather than after.

**The trend report excludes the week `today` falls in, on every day of the week including
Sunday.** `completeWeeksBefore` — a Wednesday's three open days would otherwise average as
though the week had already finished, the same closed-day distortion the occupancy report
guards against, one level up. Mutation-tested the Sunday-bucketing case specifically:
`getUTCDay()` returns 0 for Sunday, and a bucketing rule with no remap sends it into the
*following* week rather than the one it belongs to — the kind of off-by-one that passes on six
days out of seven and was caught by a test written for the seventh.

**Neither importer parses a real vendor file, and says so rather than pretending otherwise.**
This repo has never seen a real Storypark export, has not sourced its column layout, and
"Discover" is not even a specifically identified product — the roadmap names the script and
nothing else. Both importers do what `import-criteria.ts` already does for the Ministry's
criteria: define this product's own intake JSON, documented in each script's header, and
require a person to map the real export into it by hand. Guessing a vendor format and shipping
an importer that looks complete and silently mismaps a column is a worse outcome than admitting
the format is unsourced.

**Storypark writes text only, and a `photos` key in the file is a hard stop, not a silently
dropped field.** A photograph in this product cannot exist without a recorded consent decision
— [[consent-gated-media]] is the whole reason those flags exist — and a picture pulled from an
old journal export has no consent row behind it here. Caught before it mattered: the first
draft used `T12:00:00Z` for a story's date with no time attached, which for a UTC+13 offset
already rolls the calendar date over to the next day by the time anyone in Auckland reads it —
the exact class of bug `localDates.test.ts` exists to catch, built by hand instead of with
`.toISOString().slice(0, 10)`, so the guard's regex would not have caught this one either.
`T00:01:00Z` fixes it and the comment says why, including the assumption it relies on.

**Discover writes into `waitlist` (0018), never into `children`.** 0052 already argued this once
about the public enquiry form — "a stranger's claim about a child is not a child record… there
is deliberately no function that does it" — and a row copied from another company's database is
the same category of claim, arguably weaker. `waitlist` already exists for exactly this and had
never had a writer. It also has **no DELETE grant for any role, service_role included** — found
by trying to clean up a manual test row and getting refused, which is 0018's own design working
rather than a bug in the test; the row was retired with an UPDATE and a resolution note instead,
which is what a centre would actually do with a mistaken entry.

**Both importers verified against the real dev database, not just read.** Matched by name
(including `preferred_name`), rejected an unmatched name and a bad date without guessing,
skipped a re-run of the same file as already-imported, and refused a file carrying a `photos`
key outright. A reference bug (`matched.indexOf({ childId, story })`, which can never find
anything — it is a fresh object literal compared by reference) was caught here rather than left
for whoever ran this against a real file first.

16/16 core tests for the two new pure functions, full gate green.

---

2026-08-10 — **A question mark on every screen, and the page behind it.** New:
[[in-product-help]]. `HelpNote`, `help/tabs.ts`, `/help`.

Documentation for the people using the admin panel rather than the people building it. A `?`
beside every screen's heading and beside the eight sections of the child record, and a `/help`
page listing every screen the reader's role can open. Both read the same array, so they cannot
drift.

**`<details>`, not a tooltip, and the precedent was already here.** `AttendanceRow` once
carried a child's anaphylaxis response plan in a `title` attribute and it was **deleted** rather
than restyled — a `title` is invisible to a keyboard, a touch screen and most screen readers.
Building the help surface on that attribute would have repeated the mistake in the one place
whose whole job is explaining things. Native `<details>` is focusable, operable and announced,
with no ARIA to get wrong; `RatioBanner`'s "Which rule is this?" is the same shape.

**186 B of client bundle, which is a correctness property.** Nothing here is a client
component. Yesterday's diagnosis was a tap on the roll that landed before hydration and did
nothing, silently — help that is inert for the first moment of a page is broken exactly when
somebody unfamiliar is poking at it. The panel is in flow rather than an overlay for the
related reason: a popup on a door tablet is a trap.

**Every entry says what the screen will not tell you**, copied from the behaviour rather than
composed — the ratio wording from `RatioBanner`, the funding wording from the funding page, the
broadcast wording from `BroadcastForm`. A manager who believes the ratio block confirmed they
are legally covered is worse off than one who never opened the screen, and a summary that
dropped those sentences would be the one place a reader gets the comfortable version.

**The tab list is checked against `layout.tsx`, not against another list.** `TABS` is exactly
the hand-maintained list [[conventions]] collects four instances of, and it would fail the same
silent way. `helpCoverage.test.ts` parses the navigation and asserts both directions.
Mutation-tested: removing the `/settings` entry fails the named assertion and prints the route.
It also asserts the parse found more than ten links first, because a restructured `layout.tsx`
returning nothing would make every other assertion pass vacuously.

**Three buttons were left alone, and that is a finding rather than an omission.** Broadcast's
Send, the sleep register's Record a check, and `PageActions` all already explain themselves in
always-visible copy. Putting that behind a `?` would move information from "read this" to "open
this if curious" — a downgrade dressed as a feature. The child record's section headings were
the real gap.

**One mistake worth recording**: the first version put the `<details>` *inside* an `<h2>`. That
is invalid HTML and it folds the whole help paragraph into the heading's accessible name, so a
screen reader announces the heading as an essay. Caught by reading it back, not by a tool —
neither typecheck nor lint nor axe would have said a word.

a11y: zero WCAG 2.2 AA violations on `/help` and on a screen with a note open. roles: 17/17,
with `/help` added to the matrix and to all four navigation lists.

---

2026-08-09 — **A wiki pass that found a defect in the thing it was documenting.** See
[[privacy-and-retention]], [[parent-self-service]], [[conventions]].

Writing `detail_confirmations` up on the retention page — where it belongs, because refusing to
store a snapshot is a retention decision and not a product one — meant reading 0055's policies
again next to `caller_guardian_ids()`. They do not match.

The insert policy's second half hand-rolls `exists (select 1 from public.guardians g where
g.id = guardian_id and g.user_id = auth.uid())`. The predicate that already answers this is
**stricter**: it also requires a live membership *at the guardian's own centre* and
`archived_at is null`. So a caller who is a guardian at two centres can name their centre-B
guardian record on a confirmation for their centre-A child, and `detail_confirmations` carries
no `centre_id` to catch it — deliberately, since it reaches its tenant through the child.

Not a cross-tenant read; the select policy is still `caller_may_see_child`. It is a row pairing
a child with a guardian who has no business on it.

**[[conventions]] says "use the predicates", and it was written down the day before.** That is
the part worth keeping. A convention in prose is only reachable by somebody who rereads that
page, which is not a mechanism — the version that would have caught this scans policy bodies
the way the UTC-date guard scans `prosrc`.

Also recorded: the audit-exemption countermeasure from the four-in-one-day pattern **worked**.
0055 went into both lists in the same commit because the shape was already written down.

---

2026-08-09 — **A setup step that had never once worked.** `sleep.spec.ts`. See
[[offline-outbox]].

Two failures in the e2e suite, on a spec that has nothing to do with anything shipped today. The
sleep register rendered perfectly and said *"Nobody is signed in, so there is nobody to check."*

Four lines of setup, two independent defects, and they had been cancelling each other out:

1. It clicked `getByRole('button', { name: /Sign in/ }).first()` — **whichever child happens to be
   away**. Three children are on the roll by then, including one `journey.spec.ts` enrols fresh
   each run. The reproduction signed in "Aroha Journey-…" and the spec then looked for Tāne.
2. It navigated away immediately. The roll is **optimistic on purpose** — `toggle` enqueues to
   the outbox and calls `void send()`, unawaited — so the row moves in the same tick while the
   write is still in flight. The trace shows `POST /rest/v1/attendance_events` with **status -1,
   aborted by the navigation**.

The spec passed for eight runs because an earlier file happened to leave the child signed in, so
the broken step never mattered. Its own comment claimed it removed exactly that dependency.

**The product is not at fault, and I thought it was twice.** The aborted POST loses nothing: the
entry stays queued and the next roll visit retries it, which is what the outbox is for. What was
wrong was a test asserting server state one navigation after an optimistic local write.

**Two theories died on the way**, both worth recording because each was plausible and each was
wrong. A hydration race — killed by the spec passing standalone against a fresh tenant. A
sort-order bug — killed by reading `children.ts`, which orders by `last_name`, putting Tāne
first. Neither survived evidence, and the trace settled it in the end rather than any amount of
reading.

Verified by re-running the exact four-file sequence that failed twice: 17/17. Also: the two
`roles.spec.ts` route-sweep timeouts in the same run were **load, not logic** — they passed on an
idle machine. But those sweeps now take ~47s against a 60s budget, up from ~26s, which is worth
watching on its own.

---

2026-08-09 — **When a family last said their details are right.** 0055, `detail_confirmations`,
`ConfirmPanel`. See [[parent-self-service]]. §3.3.

A reviewer asks how a centre knows its emergency contacts are current, and this product could not
answer. It held the details and the date they were *entered*, which is a different fact — a phone
number typed in 2023 and never touched is either correct or three years stale, and nothing
distinguished those.

**Append-only, and here that is the entire argument rather than a habit.** "Last confirmed in
March" is only worth saying if nobody could have written it in April. UPDATE and DELETE withheld
from every role including `service_role`.

**Both exemption lists in the same commit.** `ai_requests` went into one and not the other this
morning, and only the second list caught it. This time `review:security` went HIGH once — for the
missing trigger — and the fix touched `rls_isolation.sql` and `security-review.ts` together.

**What it refuses to store, and the cost said out loud.** No snapshot of what was confirmed. The
richer design copies the phone and address in so the product can say "confirmed, and nothing has
changed since" — a real question this table cannot answer. Refused because a snapshot is a second
copy of a family's contact details under a different retention rule, on an **append-only table that
cannot be corrected or purged**; `guardians` is purgeable when a child leaves and a frozen
duplicate is not. The question is still answerable: `guardians` carries the audit trigger, so
"changed since" is a comparison against `audit_events` rather than a column here — and that
comparison is office-only, because a guardian cannot read `audit_events`. **The screen says the
caveat rather than hiding it**, and the e2e asserts the sentence is on the page.

**A placement bug that looked exactly like a policy bug.** The first run failed on the very first
insert with `new row violates row-level security policy`, which reads as a broken policy. The
policy was fine. I had put the block near the end of the suite — *after* the offboarding sections
revoke Priya's membership and archive Ana — and `caller_ward_ids()` requires a **live** membership
by design, which 0004's own header states. Every assertion failed for a reason that had nothing to
do with the thing under test.

I nearly diagnosed it wrong twice over: first suspecting my hand-rolled `exists` on `guardians`
(which `conventions.md` does warn about), then probing the live database where the fixture rows do
not exist and reading three zeros as evidence. **A probe against the wrong database is not
evidence, and it looks exactly like evidence.** The block now sits above the purge section with a
note saying why.

**And the heredoc bit again.** `cat >>` with apostrophes in the content — "child's details" — which
CLAUDE.md explicitly warns about and which has now broken three times. The correction is the same
every time: use Write/Edit for anything long.

424/424 RLS, 16/16 security review, and the e2e's own test green in a full run
(`absence.spec.ts:73`). The suite finished 107/109 — the two failures were `sleep.spec.ts` and
had nothing to do with this table — a setup step in it had never worked. See the entry above.

---

2026-08-09 — **The enquiry form, and the queue behind it.** `apps/site/src/app/enrolment`,
`/enquiries`, `packages/api/src/enquiries.ts`. See [[parent-self-service]].

The app layer for 0052–0054. Three things in it were decided by something already in the repo
rather than by me, which is the pattern of the whole day.

**The site's narrow import stays narrow.** `apps/site` maps `@ece/api/recruitment` and now
`@ece/api/enquiries` — never `@ece/api`. The marketing site deliberately cannot reach the rest of
the query layer, and a public form importing the module that also holds invoicing would quietly
undo that. `enquiries.ts` exists to keep the property, not because enquiries needed a file.

**The age question is a `<select>`, and that is the design rather than the styling.** A date input
is a date of birth however it is labelled. "Not born yet" is a real option: families join waitlists
before the birth, which is exactly when a centre most wants to hear from them.

**The honeypot uses `.trap`, not `.visually-hidden`.** A visually-hidden field is still in the
accessibility tree, so somebody on a screen reader might fill it in and have their enquiry silently
discarded — *a trap that punishes blind families is worse than no trap*. The reasoning was already
in `globals.css` from the careers form. I nearly wrote `.honeypot`, along with `.checks` and
`.check`, none of which exist: **third time this session I invented CSS classes**, and the third
time the fix was to go and read what was already there.

**The office screen has no "promote to child" button.** Marking an enquiry `enrolled` is a label;
creating the child, the guardians and the enrolment stays hand-work. 0052 refuses to automate the
moment a stranger's claim becomes the centre's record about a child, and a button would make it a
click.

**A gap named rather than implied.** The a11y sweep covers `/enquiries` **empty**, because the
fixture files no enquiry — so the populated table, with a select and two buttons per row, is
unaudited. That is written into the spec as a comment. A passing audit of an empty page reads as
coverage of a page that was never rendered, which is the same failure the `/reports` entry was
added to prevent this morning.

108/108 e2e, 414/414 RLS, 16/16 security review, 479 unit tests, site audit clean across 20 page
views.

---

2026-08-09 — **A correction: the enquiry asks for an age band, not a child's name.** 0054. See
[[parent-self-service]].

I went to build the public form and found the page I was about to put it on had already decided
the question, in a comment written when the site was built:

> *"When an enquiry form is built it will collect the guardian's details and a coarse age band,
> and it will not ask for a child's name or date of birth."*

0052 — mine, from an hour earlier — shipped `child_name text not null`. The enquiry could not be
filed without naming a child.

**The page's two reasons are both stronger than mine.** `docs/tenant-little-pearls.md` holds this
deployment to **zero personal information** until professional indemnity insurance is in place, and
a public endpoint writing an identifiable under-five into this database crosses the line that doc
exists to hold — on the weakest lawful basis in the product, because nobody has signed anything and
no consent conversation has happened. And the plainer one: **the centre does not need a child's
name to phone a guardian back.**

0052 argued a first name was "the least this can be". That is reasoning from the table outwards.
From the family inwards it is not needed at all — the enquiry is a request for a conversation with
an *adult*, and the adult's name is already on the row. So the schema changed, not the page. That
is AGENTS.md §5's rule working in the direction it is usually quoted in reverse: the wiki was right.

**What replaced it.** A coarse band — `expecting`, `under-2`, `2-and-over` — which answers "which
room, roughly when" and nothing else. `expecting` is a real case: families join waitlists before
the child is born, and a nullable birth month could not have said so. `child_born` is dropped
outright: "March 2024" is a date of birth with the day filed off, and it invites exactly the field
the page refuses. `child_name` survives as **nullable**, because an enquiry the office takes by
phone from a family it has met may carry one — *the form does not ask*, which is a different
statement from the column not existing, and the honest one.

**The idempotency key had to move with it.** It was email plus child name, so a sibling was not
swallowed; it is now email plus band, which carries the same property for a family with a baby and
a three-year-old. It cannot separate twins in one band, and 0054 says so rather than leaving
somebody to find out — the fix is a conversation, which is what an enquiry is for, and that beats
asking every family for a name to disambiguate a rare case.

**The old signature is dropped, not left beside the new one.** Two overloads of a name on
`review:security`'s allowlist would both be reachable by `anon`, and the allowlist is keyed by
name — the old one would stay callable, still demanding a child's name, with nothing reporting it.
A superseded public write path is not a deprecation, it is a second door.

**Two assertions that pin the decision rather than the behaviour.** A behavioural test cannot catch
this coming back, because whoever re-added the parameter would write a test that passes it. So the
suite reads the catalogue: the function takes no argument matching `child_name`, and the column is
nullable.

Mutation-testing those was itself instructive. Adding the parameter as a **ninth** argument made
every existing call ambiguous — `42725 function ... is not unique` — so the suite died before
reaching my assertion, which is a stronger failure than I designed for but not the one I was
testing. Replacing at the same arity then failed an *earlier* behavioural assertion, because my
stub did nothing. The predicate was finally checked directly against the mutated catalogue, where
it returned 1 rather than 0. Three attempts to mutate one assertion, and the lesson is the one
`conventions.md` already records: a mutation that fails somewhere else has not tested the thing you
meant to test.

414/414 RLS, 16/16 security review.

---

2026-08-09 — **Enrolment enquiries, and the check whose explanation had to be rewritten.** 0052,
0053, `submit_enrolment_application`. See [[parent-self-service]] and [[security-review]].

The second write an unauthenticated caller may perform in this schema, and the first that concerns
a named child. Structurally `job_applications` again; the differences are where the thought went.

**What is not asked is the design.** No date of birth, no NSN, no health information, no
immunisation status. Each is useful for placing a child and each is a special category of personal
information about a **third party** — the child — handed over by somebody this product has not
authenticated and cannot verify is their guardian. The birth *month* is asked instead, as free
text, because the real question is "which room, roughly when". The same line 0024 draws in refusing
CV attachments.

**The idempotency key is email AND child name.** Keying on the email alone silently swallows a
family enquiring about a second child, which is the case a centre most wants to know about.
Mutation-tested by deleting the name clause: killed by the assertion named for it.

---

**The plan said check 8 would fail and that its MESSAGE must be rewritten, not just its allowlist.
That was right, and it was a bigger job than extending a list.**

The allowlist's argument was written for a list of *one* — "the one genuinely public function" —
which reads as an exception. Two is a **category**, and a reader needs the category rather than a
special case. It is now four properties a member must have: resolves the tenant from a slug rather
than an id, returns void, is rate-limited, and is idempotent.

**And the severity had to move.** The finding was `low` because of what it said — *"each returns
nothing without a JWT, so this is defence in depth rather than a hole"* — and that reassurance was
load-bearing. The check reads catalogue ACLs, not function bodies, so it **cannot know** whether
that is true of what it is reporting; it stopped being true of any function in 0024 and is now
false of two. Removing the reassurance without moving the severity would have left a finding rated
for a sentence that no longer existed. It is `high` now: an unrecorded anon-executable definer
function runs as its owner, so RLS is not in front of it, and `anon` is a key that ships in a
browser. Zero noise today, and mutation-tested by granting `report_absence` to anon — which the new
message correctly tells a reader to **revoke**, since it takes a uuid rather than a slug.

---

**A test that passed for the wrong reason, found by a mutation that did nothing.** Granting `anon`
SELECT on `enrolment_applications` **did not fail the suite**. I nearly moved on. The read still
raised 42501 — but on `permission denied for function caller_has_role`, not on the table: the
SELECT policy calls that predicate and `anon` has no EXECUTE on it, so the policy cannot even be
evaluated.

That is real defence in depth and worth knowing about. It also means the behavioural assertion is
**insensitive to the grant being widened** — the same shape as the `security_invoker` assertion
that passed because of a nested view. The grant is now asserted directly against
`information_schema`, and that one fails the moment anybody grants `anon` anything here.

Getting there took a probe that reported `current_user` and `sqlerrm` back through the assertion
label, because the catalogue said one thing and the suite said another and neither was lying. Worth
remembering as a technique: when an assertion and the catalogue disagree, make the assertion tell
you what it actually saw.

**And I edited an applied migration again.** Appended the audit trigger to 0052 after it had been
applied — the checksum contract, learned once already on 0045. Caught it before running anything,
restored 0052 byte-for-byte, confirmed the runner still accepted it, and put the trigger in 0053.
The insert it audits will carry a **null actor**, which is correct rather than a gap: the writer is
`anon` and there is nobody this product can name. 0053 says so, because the tempting "fix" is to
attribute it to the centre's owner — a record saying the owner filed an application about a child
they have never met.

411/411 RLS, 16/16 security review, 470 unit tests.

**Not built yet:** the office screen and the public form. The table, the write path and the checks
are complete and tested; nothing in TypeScript calls the function, so there is no dead code
waiting. That is the next commit rather than a gap in this one.

---

2026-08-09 — **A parent tells the centre their child is away.** 0051, `report_absence`,
`BookingsPanel`. New page: [[parent-self-service]]. Section 3 of the plan opens.

The first write a family may make to the centre's own records, and the argument that made it safe
to hand over is one sentence already in the schema: 0018's enum comment says `absent` is *booked
and did not attend, usually still charged*, while `cancelled` is *withdrawn in time*. **So this
write cannot change what a family owes.** It is a notification, not a financial act, which is
exactly why a guardian may perform it unsupervised at 7am from a phone — and why `cancelled` and
`closed` stay office-only.

**The plan's design does not work, and the reason is a property of RLS rather than taste.** It said
"a guardian-scoped policy on `bookings`". A policy's `WITH CHECK` sees only the NEW row, so it
**cannot say "and nothing else changed"** — anything permissive enough to allow the status change
also lets a parent rewrite the office's `note` and shift the session times on the same row. Pinning
those would mean comparing each column against its old value, which a policy cannot reference. A
definer function can, so it is one, on the same pattern as `kiosk_sign_child`. Granted to
`authenticated` rather than `anon`, so `review:security` check 8 and its allowlist are untouched.

**A deliberate departure, recorded rather than done quietly: today is allowed.** The plan said
future-only, which excludes the dominant case — a sick child *this morning* — and would have made
the feature useless. What is refused is the past, which is what the instruction was really guarding.
Even that is about the integrity of a record rather than money, since `absent` still charges.

**An assertion that lied, and it is the most useful thing here.** The audit check first ran as the
parent and failed, and the obvious reading was "the trigger did not fire". It had fired. **A parent
cannot SELECT `audit_events` at all**, so the count was zero because of the policy on the *reader*.
An assertion whose subject cannot see its own evidence reports the wrong failure and sends somebody
hunting a bug that is not there. It now reads as the owner, plus a second assertion for the correct
asymmetry: the parent's action is recorded and the parent cannot read the record.

**The suite's UTC-date guard flagged my function, and the false positive was worth more than the
fix.** The scan reads `prosrc`, which includes comments — so a function body that *explains* the
hazard trips the guard for saying the words. Mine did: "never `current_date`, which is the
session's". The tempting repair is an allowlist entry, which would permanently exempt a function
from the check that matters.

So the scan now strips SQL comments first — and **that closed a false negative nobody had noticed**.
The old test was `prosrc ilike '%::date%' and prosrc not ilike '%at time zone%'`, so a function with
`now()::date` in the code and the words "at time zone" anywhere in a comment **passed**. A comment
could silence the guard. Both directions are mutation-tested: a planted `current_date` function and
a planted `now()::date` function with a misleading comment are each caught by name.

**And the bounded-query guard refused an argument I had written into a comment.** I claimed
`listChildBookings` was structurally bounded — one row per child per day by `bookings_one_per_day`,
so four weeks is 28 rows. True, and refused anyway: reads in the money and evidence paths are paged
unconditionally with no allowlist available. The rule is right. My bound was a property of *today's*
window parameter, and a later caller asking for a year would have inherited an argument made for
four weeks. Paged, as `listInvoiceLines` already argues: uniform treatment beats a judgement each
reader has to re-make with less context than the person who made it.

**The wording is the feature.** The button says "Tell the centre", never "Cancel" — cancel names a
different status, and a parent pressing it would reasonably believe they had stopped a charge. The
panel says the fee is unchanged, and the e2e asserts both the sentence and the absence of the word.
Only a `booked` day offers the control, because an enabled button that answers "you cannot do that"
teaches people to distrust every button on the page. Staff see the panel without the column: the
button means *a family told us*, and a manager pressing it would record that a family said
something they did not.

393/393 RLS, 16/16 security review, 470 unit tests, 107/107 e2e.

---

2026-08-09 — **Occupancy, and the denominator this product never had.** 0050,
`packages/core/src/occupancy.ts`, `readAttendanceByDay`, `/reports`. New page: [[reporting]].

The last item in §2, and it opened with a finding rather than a feature: **this product could not
compute occupancy at all, and had never noticed.** It knew how many children attended and had never
known how many it was allowed — `centres` carried no licence capacity. The number every multi-site
operator asks for was missing a denominator, and nothing said so because nothing had tried.

**So the interesting decision was what to do about the absence, not how to divide.** A default is
the obvious move and it is wrong in a way that survives review: a New Zealand licence runs from
about ten places to about a hundred and fifty, so a default can be **wrong by a factor of three
while producing percentages that look entirely real**, and one of them ends up in a board paper.
`licensed_places` is therefore nullable with no default, the same contract as the sleep and drill
intervals — null means the centre has not stated one, which is a different fact from any number.

**The union is the mechanism, not the documentation.** `DayOccupancy` has two branches and the
not-stated one has no `percent` field at all, so a caller cannot read a percentage without having
handled the case where there is not one. `percent: null` was considered and rejected: every call
site re-invents the sentence and one of them eventually renders `null%` or quietly `?? 0`. Same
reasoning as `ModelPayload` having no string branch — make the wrong thing unsayable rather than
forbidden.

**The percentage is deliberately not capped at 100, and the page explains why it is not a breach.**
A day over the licence is the most important row the report can hold. But `children` counts everyone
present at *any point*, so a morning child leaving before an afternoon child arrives can push a day
over the licence while the centre was never over it at any instant. A report that called that a
breach would accuse a centre of something it did not do, so the screen names which question it is
answering and points at the ratio history for the other. Two questions that look like one.

**The average is over open days.** Ninety children across five calendar days is 18; across the
three the centre was open it is 30. The first is a third of the truth and nothing about it looks
wrong. `daysWithAttendance` is returned alongside so a reader knows what the average is over, and
the page says it in words. Null rather than zero when nothing was recorded, because "we have no
data" and "no children came" are different statements and only one is alarming.

**Four mutations, four killed by name:** collapsing not-stated into 0%, averaging over calendar
days, capping the percentage, and `>` instead of `>=` at capacity. The last one matters more than it
looks — at capacity is the day a centre turned a family away, and `>` drops it silently.

**And the optimisation I refused.** `count(distinct child_id) group by date` in Postgres returns one
small answer instead of thousands of rows, and it is not used: the grouping key is a **local date**
and the column is an instant, so the SQL would have to embed `at time zone 'Pacific/Auckland'` — and
this schema has a `timezone` column precisely so that no query hardcodes one. `localDates.test.ts`
scans for exactly that and would reject it. The caller passes windows it already computed from the
centre's zone and the bucketing happens in TypeScript. Slower and correct beats faster and thirteen
hours out twice a year.

**The grant went in the same migration as the column**, which is the whole lesson of 0047/0048 —
`centres` carries column-level UPDATE grants, and a column added without one makes Postgres refuse
the entire settings form rather than just the new field. Asserted against `information_schema`
rather than by attempting a write, because a successful write proves a grant exists for whoever is
writing and says nothing about the column being in the list. Mutation-tested by revoking it.

**And the pattern showed up a fourth time.** `/reports` was not in `a11y.spec.ts`'s hand-maintained
route list, so the new page would have shipped as the one screen no accessibility audit had ever
seen — and the sweep would have gone on reporting every *listed* screen clean, truthfully, while
saying nothing about this one. Four defects in one day with a single cause: two audit-exemption
lists, the teardown's account ids, and now the audited routes. Three of the four fail silently and
one never fails at all. Collected in [[conventions]] with the tell — a literal list that must be
edited when an unrelated file grows — so the fifth is recognised as an instance rather than a fresh
surprise.

381/381 RLS, 16/16 security review, 470 unit tests, 105/105 e2e — the last including an
accessibility audit of the new page, which is the thing that would otherwise have been missing.

---

2026-08-09 — **Xero, as a file rather than an integration.** `/billing/xero.csv`,
`packages/core/src/xero.ts`, `listIssuedInvoiceLines`. See [[exports]].

The roadmap said sales-invoice CSV, no OAuth, and not to add OAuth until asked. That still holds and
the reasoning is worth restating: a refresh token per centre is a new class of secret in a database
that holds none, plus a rotation job, plus a failure mode where a silently expired token means
invoices quietly stop syncing — bought for something a bookkeeper does monthly.

**I sourced the format instead of recalling it, and the distinction turned out to matter.** From
Xero Central directly: only `ContactName` and `InvoiceNumber` are required; one row per invoice
*line*, grouped by a shared `InvoiceNumber`; `DD/MM/YYYY`; amounts tax-inclusive or tax-exclusive but
never mixed; other fields may be left blank; and *"don't delete any columns or change any column
headings."* What I could **not** source is the exact list and order of the remaining columns — that
came from a third-party mirror of the template, and no import has been run. [[unverified-claims]]
§30. The last instruction is what makes the gap real: a wrong column set is a rejected file.

That is the *tolerable* failure though, and the design leans on it. Xero refuses and says why; a
bookkeeper loses ten minutes. The failure worth engineering against is a file Xero **accepts and
gets wrong**, and there are two of those:

**`AccountCode` and `TaxType` are blank, deliberately.** This product has no chart of accounts and
no tax field anywhere in the schema — an invoice is quantity × unit price. `200` and
`15% GST on Income` are the plausible defaults and both are guesses about somebody else's books
wearing the appearance of facts. Revenue posted to a wrongly-guessed account **reconciles
perfectly** and is found by an accountant months later. Xero's own page says other fields may be
left blank, so blank is both correct and supported. Asserted in a test rather than left as an
absence, because an empty column looks like an oversight to whoever reads it next.

**No derived totals.** `Total`, `TaxTotal`, `LineAmount`, `TaxAmount` are absent from the column set
rather than blank in it. Xero computes them from the lines, and a total we emitted that disagreed
with quantity × unit price would be a wrong number it had no reason to question. Same rule as
`invoice_totals` being a view: a money figure kept in two places drifts, and the copy is the one
that lies.

**`xeroDate` does not construct a `Date`, and that is a real bug avoided rather than a stylistic
preference.** `new Date('2026-01-01')` is midnight UTC; formatting it anywhere behind UTC renders
`31/12/2025` — a whole invoice in the wrong financial year, silently, on a server set to UTC, which
is production. This repo has now fixed that same shape three times, so the test asserts both ends of
a year.

**Drafts are excluded**, which is the filter's entire purpose. A draft is an invoice nobody sent;
importing one creates a receivable for money that was never asked for.

**One query, not one per invoice.** `invoices!inner(...)` rather than looping `listInvoiceLines` —
a term's invoicing is hundreds of invoices and therefore hundreds of round trips for a file somebody
is waiting on. Worth noticing while reading it: `invoice_lines` carries no `centre_id`, so the
tenant boundary for that read is entirely the policy on `invoices` the join walks through. There is
no `.eq('centre_id', …)` to forget because there is no such column.

**And a comment that pointed at the wrong file.** `csvDownload` claimed *"the route×role matrix in
`roles.spec.ts` covers the export paths"*. It does not — `roles.spec.ts` contains no export path at
all. The coverage is real and lives in `exports.spec.ts`; only the pointer was wrong. Corrected in
place, because a comment that sends a reader to the wrong file to verify a **security** claim is
worse than one that sends them nowhere: the reader who checks finds an empty grep and has to decide
whether the claim or the comment is broken. `/billing/xero.csv` is now in that matrix.

---

2026-08-09 — **Tier A: one screen, one button, eight integers.** The compliance narrative.
`compliance/narrative.ts`, `ComplianceNarrative.tsx`, `narrative.spec.ts`. See [[model-calls]].

The last step of `docs/claude-api-plan.md` that can be built without a key. It sends eight numbers
and five fixed words, and the two decisions worth recording are both about what is *not* sent.

**The centre's name is withheld even though it would improve the prose.** A name plus a breach count
is a small disclosure, but it is a disclosure about an identifiable organisation — and the screen can
put the name back locally, for free, after the sentences come back. There was no trade to make.

**An open breach is `null`, not zero, and the payload had to say so.** `minutesInBreach` is null when
a breach was still open at the last recorded event of a day. Summing that as zero produces a total
that reads like a total and is a floor, which is [[reading-every-row]]'s bug in a different costume:
a compliance figure that understates itself silently. So a separate count goes alongside, and the
instruction tells the model to say the figure is a floor when it is one. I caught this by writing a
comment claiming I had handled it and then noticing I had not — the comment was written first, which
is the only reason it was caught at all.

**The figures are passed into the action, never re-read inside it.** The prose has to describe the
same numbers as the table above it, and one set of variables is the only way to guarantee that. The
side effect is the more valuable half: the action *cannot* reach the database for figures, so it
cannot quietly widen later.

**It is a button, and it sits below the computed answer.** A generated sentence sitting on the
dashboard by default becomes part of how the screen reads, and within a fortnight somebody is
skimming prose instead of the table. The table is the product. Also: it costs money per render, on
the page a manager leaves open — and a cross-border disclosure that happens because somebody pressed
a button is a different thing from one that happens because they opened a page.

**The draft label goes above the prose, not below it.** A caveat underneath is read second, if at
all, and by then the sentences have been taken as a finding.

**`check:bundle` was not enough on its own, so I checked the artefact.** "Within budget" only says
first-load JS did not move; it does not say the SDK stayed server-side. Grepping the built chunks
found `anthropic` in two client files — which turned out to be **Sentry's own AI
auto-instrumentation**, present already and nothing to do with this. The real markers —
`anthropic-version` and the system prompt's first sentence — appear in `.next/server` and in no
client chunk. Worth doing the second check rather than reading a green line.

**The e2e caught two things and one of them was my test.** `getByRole('alert')` matched Next's
`__next-route-announcer__`, an empty live region on every route, so the query resolved to two
elements. Scoped to the panel rather than dropped to a CSS class — the ARIA role is the contract
worth asserting.

The other was a teardown failure, and the obvious suspect was wrong. `ai_requests` is append-only
with DELETE revoked from `service_role`, which is exactly the shape that broke this teardown twice
before on `payments`. Tested rather than assumed: a probe centre with an `ai_requests` row deleted
cleanly, because referential actions run as the constraint owner and are not subject to the grant.
So the FK cascade is not the problem, and the note in `destroyAuditTenant` about `payments` does not
extend to this table.

**A correction to yesterday's assertion, and it is the kind that matters.** The `ai_features` check
read *"nought centres across the whole table have this on"* — a census, not the property its own
label claims. It is **false in normal operation**: the first customer to legitimately enable the
feature turns `test:rls` red on every run. An e2e run that switched the flag on and had not yet put
it back is what surfaced it, which is the harmless version; the harmful version is a real centre
doing the same thing, the suite failing for a reason that is not a defect, and the pressure at that
moment being to delete a security assertion to make a suite go green. **A check whose normal state
is failing is a check that gets removed.** It now asserts what the label always meant — a centre
inserted without mentioning the column comes out false, and the catalogue default is `false` — both
of which survive a customer using the feature and still fail if a migration adds `default true` or
backfills.

I also found it by running `test:rls` *during* a live e2e run, which is the same mistake
`conventions.md` already records about running a build during one. The conclusion happened to be
real; the method was not sound, and it is only luck that those two coincided.

**And a defect that is not mine, found because a new spec made the teardown fail twice.** The
teardown's `sweepStaleAuditTenants` had inverted into the thing it was written to prevent. Three
tenants from an earlier session still held a payment — created during the very investigation that
established a payment cannot be deleted — and were never reclaimed. Once they aged past the
two-hour cutoff, every run's sweep picked them up, the **batch** delete failed on the whole batch,
the function threw, and the teardown died before reaching `destroyAuditTenant`. So each run
stranded its own tenant, which two hours later became another the sweep would fail on. **Twelve had
accumulated**, and the only symptom throughout was one red teardown at the end of an otherwise
green run — the easiest thing in a suite to read as noise, because every test passed.

The sweep is per-tenant now and skips an unremovable centre with its reason printed; the teardown
wraps it, because housekeeping for other runs must never block cleanup of this one. **The
append-only guarantee was working correctly the whole time** and nothing here weakened it — the
stranded rows were cleared as the table owner, out of band. The bug was never that payments cannot
be deleted. It was that one undeletable thing stopped everything else from being deleted.

**And the escape hatch did not escape.** The fixture's new warning points at `npm run sweep:audit`,
which runs as the table owner — so I checked whether that would actually have worked, and it would
not have. Owner privilege does not defeat `on delete restrict`; the payment has to go first and
nothing deleted it. Writing an instruction I had not verified would have been the same failure this
repo keeps recording, so the script now clears payments for exactly the tenants it is sweeping,
scoped by the ids it already selected. It is the only place permitted to do that.

Its centre loop was fail-fast too, and one stuck tenant aborted it **before the accounts section** —
which is where the rest of the damage turned out to be: `--dry-run` found **60 orphan logins**, the
same accumulation the fixture's own comment describes from an earlier occurrence. It recurred
because the loop had been made resilient for centres and not for what ran after them. Recorded in
[[conventions]]: when a cleanup step can fail, the visible casualty is rarely the expensive one.

**And a third leak, which is mine.** With the sixty cleared, one audit account remained: the kiosk
login. `destroyAuditTenant` deletes a hand-written list of ids and I added the kiosk role to the
fixture earlier this session without adding it there — so every run since has leaked exactly one
account. One per run is the worst rate for noticing: too slow to see, and **it never fails
anything**. The tenant drops, the teardown reports success, the count climbs. I found it by counting
rows after the sweep, not by any test, and no test would ever have caught it. A list written by hand
does not grow when the thing it enumerates grows — the same shape as the two audit-exemption lists
above, on the same day.

**What the new spec proves, and what it cannot.** No key, so `modelClient()` returns null and the
action stops one step short of the network. That sounds like it makes the test worthless; it does
not, because **everything on this side of the call is the half with a database in it** — capability,
flag, month boundary in the centre's timezone, spend read, `checkSpend`, and the insert into
`ai_requests`, all against live Postgres under a real JWT. It also proves the panel is absent until a
centre turns the feature on, which no unit test can see. The model call is the one purely-network
step, and it is the one step still uncovered. [[unverified-claims]] §27 unchanged.

---

2026-08-09 — **The caller, the cap and the usage record.** 0049, `packages/ai`,
`packages/core/src/modelSpend.ts`, `packages/api/src/ai.ts`. New page: [[model-calls]].

The far side of yesterday's boundary. Nothing here changes what may be sent — that was settled by
`redactForModel` and is not revisited. What is new is the thing that sends it, the arithmetic that
decides when to stop, and the table that records both.

**`packages/ai` is deliberately two calls wide.** `ModelClient` is a hand-written structural
interface rather than the SDK's own type, which does two jobs: it makes the surface this product
depends on visible in one place, and it lets every test supply a fake. That matters more than usual
here, because there is no key in this environment and never has been — the fake is not a convenience,
it is the only way any of this runs at all.

**The branch worth naming is the refusal check, and it is about how the failure would look.** A
refusal comes back as an HTTP 200 with an empty `content` array. Code that reads `content[0].text`
optimistically does not throw — it renders `undefined`. On a compliance screen that is a blank panel
with no error anywhere and no way for a manager to find out why. Not theoretical: a childcare
product's figures sit next to incidents and injuries, which is exactly the neighbourhood where a
safety classifier declines. Mutation-tested — removing the guard fails the assertion named for it.

**The provider's error message is dropped rather than shown.** An API error quotes the offending
request back, and the request holds the centre's figures. `actionError.ts` exists because Postgres
does the identical thing with the value that violated a constraint; the same reasoning applies to a
second external system, and it applied without anybody having to rediscover it.

**The spend cap checks the switch before the cap, and refuses *at* the line rather than past it.**
Both mutation-tested, and the first is not pedantry: a centre that never enabled this must not be
told it has exhausted an allowance it never asked for. `estimateCents` rounds **up**, which is the
mirror of `toHours` flooring — the shared rule is that an estimate errs against the party doing the
estimating, and here that means erring toward refusing a call rather than toward a surprise bill.
Four mutations on this file and its caller, four killed by name.

**A structural bound I could not defend, so I paged instead.** The tempting argument for reading a
month of usage unbounded is that the NZ$20 cap bounds the row count — a few hundred rows, well under
PostgREST's thousand. **That argument is false in the one direction that matters.** A `blocked` row
costs zero cents: the cap refuses the call, records it, and the counter does not move. A client
looping against a disabled feature therefore writes rows for free, without limit — and this read is
the one the cap itself depends on. Truncated at a thousand it would return a spend *lower* than the
truth and re-allow calls that should be refused. That is [[reading-every-row]]'s original bug wearing
new clothes, so it goes through `fetchAll`.

**0049 is append-only, and the assertion is on the SQLSTATE, not on the row count.** A withheld
GRANT raises 42501; a missing policy silently filters. Both look identical from the client, and only
one of them survives a later migration adding a policy. The mutation proved the difference rather
than assuming it: granting UPDATE back made the statement **succeed with no exception**, and the
suite failed with `got none (the update SUCCEEDED)`. Including `service_role`, which is the branch
that matters — the web app's server actions hold that key.

**The table records the shape of a call, never its content**, and the consequence is stated on the
table itself: it cannot answer *what did we send*. That answer is structural instead —
`redactForModel` cannot express a name. An audit log of payloads would be a weaker guarantee wearing
a stronger one's clothes, and it would give the disclosure a second lifetime inside our own database
under a different retention rule.

**Two exemption lists, and the second one caught me.** `ai_requests` carries no audit trigger, and
that has to be declared in `rls_isolation.sql` *and* in `scripts/security-review.ts`. I did the
first and not the second: the RLS suite went green at 375/375 and `review:security` returned a
`HIGH`. That is the good failure — but the underlying arrangement is two hand-maintained copies of
one list in two languages, which is precisely what `tokens:check` exists to prevent elsewhere in
this repo. Recorded in [[model-calls]] rather than unified, because unifying crosses a language
boundary and is a bigger change than this one earned. If a third copy appears, unify all three.

**[[unverified-claims]] §27 corrected rather than edited.** It said "the call does not [exist]",
which stopped being true today. The call exists and has still never run, and finished-looking code
is a better reason to keep that entry than an absence was. New §29 on the price list: `OPUS_5_PRICING`
is a number typed from a web page, not from an invoice. The exposure is bounded — it feeds only the
NZ$20 cap, so being wrong by a factor of two costs a centre NZ$40 — and everything derived from it
is named an estimate in the column, the type and the screen.

Nobody has read a generated narrative, because none has been generated. 375/375 RLS, 16/16 security
review, 449 unit tests.

---

2026-08-09 — **The switch and the boundary, before there is anything behind them.** 0047 plus
`redactForModel`. See `docs/claude-api-plan.md`.

The ask was to use a Claude API key in the product — alerts, generated reports. **Most of that ask
is refused, and the refusal is the plan's first section.** This repo already computes ratio
breaches, overdue checks, arrears ages and roster shortfalls exactly, in pure functions with
mutation-tested assertions. An LLM in that path is a model that is right 99% of the time replacing
code that is always right, and the 1% lands on a ratio breach. It also breaks the rule the product
is built on: a generated compliance alert is an assertion nobody checked, wearing the interface of
one that was — over bands where `RATIO_TABLES_VERIFIED` is still `false`. Arithmetic decides
*whether* to alert; a model may only phrase the explanation afterwards.

The second constraint was already written down here too: the roadmap refuses auto-translation
because *"sending a post about a named child to an overseas API is a cross-border disclosure of
personal information (IPP 12)"*. That applies to every idea in the ask, so the plan is tiered by
what data crosses the border, not by what is easy.

**The boundary is an allowlist, and that is the whole design.** The obvious version takes a rich
object and strips the dangerous fields — a denylist, wrong the moment somebody adds a field,
silently, in the direction of disclosure. So a payload is `number | boolean | null` only: there is
no string field to leak through, and a caller who wants to send a child's name cannot express it in
the type. It **throws rather than sanitising**, because a function that quietly dropped the
offending value would send a subtly wrong figure and teach nobody anything.

**The phone regex was wrong and the test caught it.** `(\+?64|0)[\s-]?\d[\s-]?\d{2,4}…` matched
separators positionally, so `021 555 1234` walked straight through. People write a phone number
every way there is; the fix strips separators first and then asks a simple question. That is the
entire argument for testing a redactor — one that silently stops redacting looks exactly like one
that works.

Four mutations, each caught by the test named for it: sanitising instead of throwing, dropping the
freeze, trusting declared labels, removing the phone check. Plus one against the database — setting
the column default to `true` failed the suite on *no centre permits sending data to an external
model unless somebody turned it on*. 361/361.

**Two entries added to [[unverified-claims]]**, and the first matters: **nothing has ever been sent
to Anthropic's API.** There is no key in this environment, so the live path is untested by
construction. The redactor is proven; that the request body a real call sends is the one the
redactor approved is not, and closing that needs a key and a drill. The second entry is standing
rather than closeable: generated prose is a draft, never a finding.

`privacy-statement.md` gained the fourth processor **in the same commit as the switch**, because
that document currently names three and is accurate — it must not become inaccurate in the commit
that adds a fourth. The settings toggle shipped in the same commit too, to avoid a fifth setting
landing ahead of its field.

**And 0047 broke the settings form, which 0048 fixes.** `centres` does not carry a table-wide
UPDATE grant — it carries a **column-level** one naming each column an owner may change. Adding
`ai_features` without adding it there meant Postgres refused the statement before any policy ran,
and because `updateCentre` builds one UPDATE from every changed field, **the whole form stopped
saving**: the sleep interval, the ratio source, the centre's name. A feature nobody had enabled
broke three that already worked.

Typecheck, lint, every unit suite and `review:security` were green. It was caught by
`settings.spec.ts`, which asserts `.error` is absent *before* reloading — written earlier for an
unrelated reason, and the only thing in the repo that can tell "refused" from "did not persist".
Now in [[conventions]], because the new-table checklist says *policy and grant* and says nothing
about adding a column to a table whose grant is per-column.

Two smaller things. The new assertion first went in beside the "nobody has it on" negative and
broke a later audit assertion — that one reads the most recent `centres` update, and two writes
from mine made the latest row name `ai_features` instead of the rename it was about; moved below
it. And a missing **grant** raises `42501` where a missing **policy** filters silently, so the
mutation aborts the transaction rather than failing the named assertion — the suite still goes red,
but for a visibly different reason.

---

2026-08-09 — **CSV downloads across the product, and PDF gets a button.** See [[exports]].

There was no download anywhere in this repo: one route handler (`api/health`), no
`Content-Disposition`, no CSV. The existing export is a print stylesheet with a sentence telling
the reader to choose *Save as PDF* — still the right call for PDF, and now behind a `window.print()`
button, because an instruction only helps somebody who already knows they want it.

**A byte-order mark is a product decision here, not a detail.** Excel on Windows reads a BOM-less
CSV in the system codepage, so every macron becomes mojibake — `Tāne` as `TÄne`. This is a product
whose stated values include a commitment to te reo Māori, and the first thing a centre does with an
export is open it in Excel and send it to somebody. Asserted in the e2e against the fixture child,
who is called Tāne. The *filename* strips macrons, and that is the one place they are deliberately
removed: a filename crosses shells, mail clients and Explorer.

**A cell beginning `=` is executed by Excel**, and every field here is typed by somebody — a name,
an incident note, a payment reference. Guarded with an apostrophe prefix, which alters the value on
purpose. **The first implementation guarded numbers too**, so every credit and every negative
variance became `'-4500` — text, in a column an accountant is about to sum. The test caught it
before the bug was suspected. A value that arrives as a number was computed by the product, not
typed by a person, so there is nothing to inject.

**An export is a read path, not a formatting concern.** A route handler sits outside the `(app)`
layout, so nothing checks a capability for it; each one re-checks its own. Two are deliberately
*stricter than their own page*: `/children` is readable by a parent (who sees one child) and
`/staff` by an educator, but a **file** leaves the product and sits in a downloads folder.

`exports.spec.ts` uses `page.request` rather than `page.goto`, because **a download never
navigates** — `Content-Disposition: attachment` makes `goto` abort and the URL stays put, so a
download added to the roles matrix would pass while testing nothing. Mutation-tested by widening
the children export to `viewOwnChildren`; the educator and parent rows both failed.

**Then the full suite failed on two export rows and the code was fine.** I had restored the mutated
guard and not rebuilt, so `next start` was serving the mutated `.next` against restored source —
and `git diff` was clean, which is exactly what makes it convincing. It is the mirror image of the
trap recorded a day earlier: that one is a build during a run, this one is *no* build after a
restore. A mutation test has four steps and the fourth gets dropped — mutate, build, run, restore
**and build again**. 102/102 once rebuilt.

Two smaller ones: I invented a `button-link` class that does not exist — the same silent failure as
the kiosk's `.button` — when `.page-actions .btn` already existed and its comment in `globals.css`
made the same argument I was about to write. And the shell ate a backtick out of an index entry
for the second time this session; `Edit` rather than `node -e`, which CLAUDE.md already says.

---

2026-08-09 — **Arrears (0045), and a mutation that changed nothing.** See [[funding-and-billing]].

A view, not a table, under the same rule as `invoice_totals`: a stored balance drifts from its own
detail, and this one moves every time money arrives. **It trusts the payments rather than
`invoices.status`** — a `paid` invoice whose payments do not cover it still shows its balance,
because status is a label somebody set and the payments are the fact. Mutation-tested by narrowing
the filter to `status = 'issued'`, which fails on exactly that line.

The ageing is in `@ece/core` and not in SQL, the same split `ratios.ts` makes. Four mutations, each
caught by the test named for it. Three judgements worth keeping: an invoice with **no due date**
gets `no-due-date` rather than being folded into "current"; **credits are never netted** against
somebody else's debt; and nothing owed is not in arrears whatever the date says.

**Then the mutation that changed nothing.** Turning `security_invoker = off` on `invoice_arrears`
and running the entire suite gave 350/350 — including an assertion I had labelled *"security\_
invoker carries the boundary"*. It does not. The view joins `invoice_totals`, which is itself an
invoker view, and the nested one kept enforcing the boundary. My assertion was passing for a reason
other than the one it claimed, and would have gone on passing until somebody rewrote the join to
read `invoice_lines` directly — at which point the boundary would have rested entirely on a setting
nothing was checking.

I nearly recorded that as "the assertions don't pin it" and moved on. Verified instead, on both
sides: `pg_class.reloptions` confirmed the setting really was off, and a throwaway probe view over
`centres` with `security_invoker = off` returned **5 rows to a caller with a random `sub` who is a
member of nothing**. So the mechanism is real and the test was blind to it.

The fix is a class-level assertion over `pg_class.reloptions`: every view in `public` must declare
`security_invoker = on`. It names the offender when it fails, cannot be satisfied by accident, and
covers every view added after it — the first view-level invariant in the suite. The behavioural
assertion was relabelled to claim only what it proves. 351/351.

**The general lesson, now in [[conventions]]:** when a nested object can satisfy your assertion for
you, assert the property directly rather than its consequence.

**And then the accounts screen**, because a reader with nothing rendering it is the same "ships
ahead of its screen" pattern I had criticised in the roster work three commits earlier.
`packages/api` had held invoices since Phase 5 with no page importing them, so `formatCents` is the
first money this product has ever displayed. Read-only on purpose: an issued invoice is frozen by a
trigger and a policy, and a button here would mean reproducing that reasoning in a form.

**Seeding a part-paid invoice broke the teardown twice, in two different ways**, and both are the
schema working rather than gaps. `payments.invoice_id` is `on delete restrict`, so the payment
pinned its invoice and the cascade from `centres` died on a foreign key. Deleting the payments first
was `permission denied` — DELETE on `payments` is withheld from `service_role` as well as
`authenticated`. Every prior run had invoices with nothing paid against them, so neither had ever
been reached.

I stopped seeding the payment rather than routing around it. The Management API would have worked
in the teardown, and would have handed the e2e suite a credential it deliberately does not have,
making CI need a project-wide token to clean up after itself. Not worth one test figure. The
sweeper had the identical hole and it mattered more there — it is what reclaims a run that died
before its own teardown, which is exactly when nobody is watching.

A smaller one on the way: I wrote an `nzDaysAgo` helper the fixture already had as `nzDate(-40)`,
and its doc comment silently orphaned `recentlyToday`'s. Deleted.

**Then `funding_receipts` (0046), and the figure it refuses to compute.** The obvious design takes
the funded hours this product already calculates, multiplies by a rate, and compares that to what
arrived. **There are no rates in this repo**, deliberately, and publishing one nobody has checked
would make every variance a fiction with a dollar sign on it. So both figures are entered by the
centre and the product does the subtraction. Three judgements, each asserted: a null claim is *not
stated* rather than zero; shortfall and overpayment are never netted; and money with no date is
refused by a constraint. Mutation-tested by widening the policy to educators — failed on *an
educator reads NO funding receipts*. 360/360.

**The migration runner refused me, and it was right.** I had edited 0045's comment *after* applying
it, so the checksum no longer matched and 0046 would not run. The runner offers "re-apply by hand
and update the checksum"; I re-applied 0045 (every statement is idempotent) and then tried to update
the ledger, which the permission layer blocked — correctly, because that is the one table recording
whether the schema is trustworthy.

The better fix needed no ledger surgery at all: **restore the applied file byte-for-byte and put the
new understanding in the next migration.** An applied migration is a record of what ran; new
understanding belongs in the next one or in the wiki. Verified by recomputing the checksum against
`schema_migrations` before continuing. Now in [[conventions]].

---

2026-08-09 — **The kiosk becomes reachable**, and the redirect loop 0043 had already shipped. See
[[kiosk-and-pins]].

**A defect of my own, in `main` since yesterday.** Narrowing `memberships_select` was right; its
consequence in the application was not traced. A kiosk reads zero membership rows and one centre,
so `requireCtx` found a centre with no role and sent it to `/select-centre` — which rendered, told
a door tablet *"You have access to more than one"* above a list of one, and bounced back on the
only button it had. A two-step loop, invisible to the RLS suite because every policy was correct.
Unreachable in production only because no kiosk membership existed yet.

**The mutation test lied the first time, and that is the part worth keeping.** Removing the guard
from `requireCtx` left the new e2e passing — `/select-centre` carries the same guard, so the
tablet still *arrived* at `/kiosk`, one hop later. The assertion is about the destination and
there were two roads to it. Only mutating both produced the `waitForURL` timeout that proves the
test can fail at all. Defence in depth is right here and it makes single-point mutation testing
misleading; the fix is to mutate the property, not the line.

A second, smaller trap on the way: deleting the guard outright left `isKiosk` imported and unused,
which fails the build's lint, so the `&&` chain short-circuited and the suite never ran — a green
terminal that had tested nothing. Mutations need a **runtime-false** condition, which is the third
time this repo has learned that and the second time in two days.

`/kiosk` is a sibling of `(app)`, not a route inside it. `?wall=1` was the closest precedent and
is only a precedent for sizing: it still renders the rail, including a sign-out control, which on
an unattended screen means anybody walking past can log the tablet out and the centre finds out at
the end of the day with no roll.

Two absences, both on the screen: **no offline queue** (nowhere to put a guardian or a PIN, and a
PIN in `localStorage` defeats 0044 entirely — also §21, never drilled) and **no ratio**
(`kiosk_roll()` returns no date of birth, so the bands cannot be computed). The roadmap promised
name *and photo*; the function returns no photo and that stands — a photograph of a child on a
screen facing the street is a decision nobody has made.

**`check:bundle` failed, and it was right to.** The kiosk styles pushed `first-load-css` from 4.0
to 4.4 kB. The check offers to have the number raised "deliberately, with a reason", and the
reason would have been a bad one: a door tablet's stylesheet was being downloaded by every parent
opening the app on a phone. Moved to a route-scoped `kiosk.css` — the first stylesheet in this app
that is not `globals.css` — and `first-load-css` is now **3.9 kB**, under where it started. Met by
shipping less, not by moving the line.

**A test that asserted the state of the world rather than the behaviour.** The first end-to-end
version clicked "Sign in" and hung for sixty seconds, because the fixture had already signed that
child in and the tablet correctly offered "Sign out". It would have passed or failed depending on
which specs ran before it. Direction is now read off the button.

---

2026-08-08 — **The door tablet.** 0044: guardian PINs, attestation on attendance, and two bugs in
my own migration that would have shipped looking like features. See [[kiosk-and-pins]].

**The roadmap's own instruction was wrong and following it would have been a real weakness.** It
said to hash PINs "the [[invitations]] precedent" — SHA-256. Correct there, because an invitation
token is 256 bits of randomness. A four-digit PIN is ten thousand candidates: SHA-256 of it is a
rainbow table somebody builds in a second, and unsalted, every PIN in a leaked table falls to the
same one. bcrypt via pgcrypto, per-row salt, verified against the live database before being
relied on. `guardian_pins` has RLS on and **not one policy** — the opposite of the convention,
and the suite asserts an owner cannot read a hash, because "no policy" looks identical to "policy
forgotten".

**The verify function returns a status and never raises, and that is not a style preference.** A
`raise exception` rolls back the failed-attempt counter incremented immediately before it, giving
a brute-force limiter that counts to one forever. It is the obvious implementation. Demonstrated
rather than argued: a probe that increments and then raises, called inside an exception handler,
leaves the counter reading 0.

**`can_collect` has existed since 0003 and was never enforced anywhere.** It was data staff read
off a screen and applied with judgement. A door has no judgement, so 0044 is the first thing here
to enforce it — on sign-out only, because bringing a child in is not taking one away. Asserted
against Ana's two guardians: her mother, who may collect, and her grandmother, who is on the
record and not on the collection list. Mutation-tested by deleting the gate; failed on exactly
that line.

**Two bugs in my own migration, both of which would have passed every check.**

The audit trigger would have recorded *nothing*. `audit_trigger` attributes a row to a tenant
through `centre_id`, `child_id` or `invoice_id` and gives up **silently** when it finds none.
`guardian_pins` has none of the three. The trigger would have existed, the class-level assertion
would have gone on passing — it checks the trigger *exists* — and no audit row would ever have
been written. Caught by reading the function's body before trusting it, not by any check.

Then a quieter version of the same thing: `guardian_pins` is keyed on the guardian and has no
`id`, so `entity_id` would have been null. A permitted value, so nothing fails, and the audit
reads *"a PIN changed at this centre"* without saying whose — worse than an error, because it
looks like a record. Both fixed in the shared function, both safe against every existing table by
inspection of the catalogue rather than by assumption.

`attendance_insert` was **not** widened, which the roadmap was right to insist on. The kiosk
writes through a definer function; staff writes are governed by exactly the rule they were
governed by yesterday, and the suite asserts that rule is still intact. 343/343.

Two entries added to [[unverified-claims]]: the kiosk cannot enforce a parenting order, because
`custody_arrangements` is prose written for a person to read and there is no machine-readable
form of it — so a centre that has left `can_collect` at its default for a guardian who must not
collect has a kiosk that will let them. And the lockout numbers are a judgement with no standard
behind them.

---

2026-08-08 — **A new role is a change to every policy that does not name roles.** 0042 adds
`kiosk` to `member_role`; 0043 shuts the four doors it would have opened. See [[tenancy-and-rls]].

The kiosk itself does not exist yet — no PINs, no attendance path, no screen. This is only the
role value and the narrowing, and the order is the point: **the doors are shut before there is a
key.** Applying 0042 alone is safe precisely because nothing can hold the role.

The hazard was latent and is worth stating plainly. `caller_centre_ids()` asks *which centres does
this caller belong to* and never asks in what capacity, so a `kiosk` membership row would have
inherited whatever a parent gets. Audited against the live catalogue rather than by reading
migrations: six policies read it, and four of them would have handed a door tablet published
pānui, **the photographs attached to them**, the membership list, and the ability to open a
message thread as the centre. The media one is the one that matters — that screen faces the
entrance.

Two were deliberately kept and the keeping is written into the migration: `centres_select`,
because a kiosk renders the centre's name, and `audit_insert`, because a device that acts and
leaves no trace is worse than one that reads a name.

**An allowlist, not `role <> 'kiosk'`.** A denylist is wrong the next time somebody adds a role,
and wrong silently. `caller_staff_centre_ids()` needed no change at all here because it already
names its three roles — it was safe against a role that did not exist when it was written, which
is the property worth copying.

**Two things verified rather than assumed, and the first probe was wrong.** `alter type … add
value` cannot be followed by a use of that value in the same transaction, so the enum needs its
own migration. The first probe appeared to disprove that — because it created the type in the
same transaction, which Postgres permits. Re-probed against a pre-existing type: `55P04 unsafe use
of new value`. Second, `typecheck` passes silently when a role is added to `MEMBER_ROLES`, because
`CAPABILITIES` lists roles per capability, so a new role arrives holding none. That is the right
default and a bad way to learn it, so `capabilities.test.ts` now asserts the kiosk holds nothing
— against an owner-holds-everything control, since a `can()` broken to return false for everybody
would satisfy the assertion perfectly.

The RLS suite gained the same pairing throughout: every refusal has the positive beside it,
because a narrowing that broke `caller_person_centre_ids()` outright would satisfy all four
refusals and break the product. Mutation-tested by widening the function back to role-agnostic —
failed on *a kiosk CANNOT read a published pānui* — then restored and verified against `pg_proc`.
321/321.

**A wrong control, caught by it failing.** The first positive control asserted an educator could
read their centre's media, and it failed — not because of the narrowing, but because every media
row in the fixture is either deleted by the *staff can still delete what they cannot read* test or
hidden by the consent-withdrawal one. The fix was to seed a photograph on the published pānui
inside the new section, which tests the exact branch 0043 changed rather than a neighbouring one.

---

2026-08-08 — **The forward ratio forecast**, and the shifts and leave it needed. See
[[staff-as-people]].

`0041` records what is *planned*, as opposed to everything else in Phase 10, which records what
happened. The migration's one interesting object is an exclusion constraint: a double-booked person
is counted twice in a forecast, so the roster reads adequately staffed when it is not. Two details
on it look like bugs and are not — `[)` bounds, so a shift ending at 16:00 does not collide with one
starting at 16:00; and cancelled shifts are excluded, so a cancelled 8-till-4 does not block the
replacement 8-till-4. Leave has **no** overlap constraint on purpose: sick leave declared during
booked annual leave is real, and refusing it pushes the correction outside the system.

`forecastDay` is the join — bookings for the children, shifts minus approved leave for the adults —
and it is the first screen here that answers a question somebody can still act on. It never touches
a timezone, which is the payoff for 0041's column shape rather than a happy accident.

**Twelve tests passed on the first run, which the house rule says to distrust.** Five mutations
followed and each was caught by exactly the test named for it: widening approved-only leave,
closing the half-open bound, taking the age band on a fixed today, dropping untimed bookings, and
removing the leave filter. Two more through the browser — deleting the translated overlap message,
and hiding an on-leave shift instead of badging it. Both failed, both only in the right place.

The RLS suite gained the class of assertion that section exists for and the constraint was
mutation-tested against the live database in both directions, restored and verified byte-identical
against `pg_constraint` and `pg_policies`. 312/312.

**Four things I got wrong in the first draft**, none caught by typecheck, lint or build.

The worst was a date heading, and what makes it worth writing down is that **the comment beside it
claimed the bug had been avoided**. `new Date(Date.UTC(…))` formatted by an `Intl.DateTimeFormat`
with no `timeZone` renders in the *runtime's* zone, so 2026-09-15 reads as "Monday, 14 Sept" in New
York and Honolulu — measured, in four zones, rather than reasoned about. Two failures at once: a
wrong heading, and a hydration mismatch, because the component renders on a server that is on UTC
and again in a browser that is not. New Zealand is east of UTC so nobody local would ever have seen
it, which is exactly the kind of bug that ships. `timeZone: 'UTC'` on the formatter; the dates were
already the centre's local days before they got there.

The page used a `.button` class and a `ul.plain` class, and **neither exists in the stylesheet** —
the week navigation would have rendered as unstyled links and the shift list with bullets. Invented
class names fail silently in exactly the way a missing import does not. `.button` was also the wrong
idea: those links change the URL, so they must be shareable and openable in a new tab.

And the first reader was per-day, so a seven-day page made **thirty-one queries to answer what four
answer**. `forecastDay` is pure, so a week of rows splits with a filter rather than a fetch. The
range version also had to be *paged* where the per-day one did not: a week of bookings is the roll
times seven, and a fortnight at a 150-child service crosses PostgREST's 1000-row cap — at which
point the forecast loses the last days of the period and reports them as quiet. `bounded-queries`
would have accepted the unpaged version with a plausible-sounding reason; the reason would have been
wrong.

**A failure I first wrote down as unexplained, and then explained.** A full run came back 84/85 with
`sleep.spec.ts` failing — a spec this change does not touch — and it passed in isolation
immediately afterwards. The cause was mine: I ran `npm run build` *while that suite was still
running*. `next start` serves `.next` from disk, so a rebuild replaces the application under the
running server mid-suite. The failing spec was #72 of 85, which is where the 72-second build landed.

It is a near neighbour of the two-concurrent-runs trap already recorded above and needed its own
entry, because the tell is different: that one shows a truncated run with no failure detail, this one
shows **one ordinary-looking failure in an otherwise complete run** — which reads exactly like a real
regression in unrelated code. Playwright also clears `test-results` at the start of each run, so the
isolated re-run destroyed the artefacts before they were read. Diagnose first, re-run second.

**And `unverified-claims` needed correcting, not just extending.** The ratio-bands entry said the
banner and the mobile bar carry the notice. A forecast is worse than either: a live banner is read
by somebody already standing in the room, while a forecast is acted on a week early by *not* calling
a reliever. Same unverified tables, higher cost.

---

2026-08-07 — **The site got a design**, at the centre's request: like the first one in concept, not
like other childcares, *unique, authentic and humble but good quality*. See [[public-website]].

The honest starting point is that what was there was accurate, accessible and generic — it could have
been an accountant's. The organising idea is **the pearl and the woven mat**, both already theirs: the
name and tagline, and Te Whāriki's own metaphor, which is physically in their rooms as baskets, a
canopy, rugs and thatched shade. The insight underneath it is that every other childcare site is loud
and their pedagogy is not — Pikler and RIE are about calm, unhurried environments, so the way to be
unique *and* authentic is to make the site as calm as the rooms, which nobody else in the market is
doing. White ground → warm `shell`, a saturated teal masthead → the same paper as the page, one
self-hosted display face, an arch on square photographs, and a woven swatch between sections drawn in
CSS. Eight new contrast pairs, measured before the colours were chosen.

**The typeface nearly shipped a spelling error.** Fraunces was chosen for its `SOFT` axis, which
rounds terminals the way their logo does. It misplaces every macron: `Whānau` with the bar over the
n, and `Māori` rendered as `Maōri`, which is a different word. Seven faces were rendered side by side
to prove it was the font and not the pipeline. It does not throw, does not visibly fall back and does
not fail a build — it renders a plausible wrong word on a site whose stated values include a
commitment to te reo Māori. Nothing here would have caught it; it was caught by rendering the words
and looking at them. Literata instead.

**And the day-old `audit:site` was lying, twice.** It waited for `domcontentloaded`, so it sometimes
measured an unstyled page — which fails target-size everywhere and passes contrast everywhere, making
the rule it exists to enforce the one it could least see. Worse, on Windows `server.kill()` kills the
`cmd.exe` shell and orphans Next: eleven orphaned servers accumulated, the audit bound to a port an
older one held, and that stale build 400'd every `/_next/static/*` request. So the answers never
changed no matter what the CSS said. A correct fix was tried, looked catastrophic, and was reverted —
and *that* was a third bug, the counter counting its own log lines instead of failing nodes.

Fixed by killing the process tree, counting nodes, and refusing to report at all when `body` has no
background. The lesson worth keeping: **31 lines of CSS were written to fix failures that did not
exist**, and came straight back out once the harness was honest. A broken measurement manufactures
defects as well as hiding them.

Three more photographs are up — the centre confirmed on 2026-08-07 that it holds the consents. The
sleeping pair stays out, and that is now an **editorial** recommendation rather than a consent
blocker, recorded as such in `photos.ts` and asserted by a test so nobody reads it as untouchable.

2026-08-07 — **Their own logo and photography moved onto the new site**, and the four photographs that
did not come with it. See [[public-website]].

Eleven photographs on their old site, all named after Flickr ids. Every one was downloaded and **looked
at** rather than judged from its filename, because that is the only way this call can be made. Seven show
the premises and nothing else — the entrance, four rooms, the playground, the sandpit — and those are in
now, renamed to what they show, taken from the `_2x` variants their own site already served, and
converted to WebP at a third to a half of the bytes. The logo came across too, trimmed and palette-
compressed from 30kB to 13kB, and the site has a favicon for the first time.

**Four show identifiable children and are not here.** A group of five at a table looking straight at the
camera, a toddler covered in paint, a child drawing, two asleep on a rug. They stay out until the centre
holds current written consent for **public** use for each child in each frame — the distinction the
platform already models as `photo_internal` versus `photo_public`, because families who agree to a photo
in a learning journal routinely refuse one on a website. Consent given in 2018 to a site nobody has
updated since is not consent for a new site now. The list lives in `src/lib/photos.ts` rather than only in
a markdown file, so the next person asked "can we put some photos of the children up?" finds the answer
beside the photographs.

Three assets were **images of text** — the tagline and both centre names, rendered to PNG by Adobe Muse —
and were left behind: the site already renders all three as real text, which is selectable, translatable
and resizable. Their nautical decorations were left behind on **licence** grounds: `noun_boat_1630770` and
`noun_submarine_605221` are Noun Project asset ids, the social icons are Iconmonstr, and a Noun Project
asset is either CC BY needing attribution or royalty-free under somebody else's subscription. Their pages
carry no attribution, so it cannot be determined from outside which applies, and copying them in would be
inheriting a licence position sight unseen. Gap 15, with the cheaper answer: draw them fresh as inline SVG
and let them take their colour from the tokens.

**And the axe claim for this site turned out to be a one-off.** [[public-website]] has said since the site
was built that all ten routes pass axe at 390px and 1440px with zero violations. True when written, and
not repeatable by anybody — the same species of claim this repo keeps catching. Adding eight images across
five pages is exactly what would have broken it quietly. `npm run audit:site` now runs it: twenty page
views, clean.

**It does not catch the failure the images risk, and that is worth recording.** Emptying one photograph's
`alt` and re-running the audit reported no violations anywhere. axe is right: `alt=""` is a *valid* way to
declare an image decorative, and no tool can know a photograph of a playground is not. So alt text is
guarded by a data-contract test — every entry described, longer than a label, not starting "photo of" —
which does catch it. `apps/site` had no test runner at all before yesterday; it now has 13 tests.

2026-08-07 — **Sixteen defects, found by tracing logic flows against the code rather than by any
check.** Every gate was green before this and every gate is green after it, which is the whole point:
`typecheck`, `lint`, `test`, `test:rls`, `tokens:check`, `check:docs`, `check:bundle`,
`review:security`, `build`, `build:site`, `test:e2e` and `drill:restore` all passed while a childcare
compliance product was hiding ratio breaches from its own licensing binder.

Migrations `0025`-`0028`. Corrections on [[attendance-and-ratios]], [[offline-outbox]],
[[password-recovery]], [[funding-and-billing]], [[security-review]], [[recruitment]],
[[unverified-claims]], the README and `docs/deploy-railway.md`. Every fix mutation-tested.

**The pattern, stated first because it is the finding.** Eleven of the sixteen were **a comment or a
document describing a protection the code did not have**. Not stale prose — load-bearing claims that a
reader would act on. `offline-outbox.md` described the shared-tablet scoping as a property of the
outbox; it was a property of *mobile*, and the web queue had none of it. `password-recovery.md` records
rejecting the weaker design for `/account`, and `/reset-password` implemented exactly the rejected
design. `deploy-railway.md` told the operator to check `/login` for CSP violations and then reassured
them the e2e suite covered it — while four routes had every script blocked. This repo's rule that a
wrong comment is a defect turns out to be the single most productive check it has, and nothing
automates it.

**The three that mattered most.**

*Every script on the public site was refused in production.* `script-src` is
`'self' 'nonce-…' 'strict-dynamic'`, and a statically prerendered page cannot carry a per-request
nonce — `careers.html` had 16 script tags and zero `nonce=` attributes. With `'strict-dynamic'`
present, CSP3 requires the browser to ignore `'self'`, so there was no fallback. All ten site routes
plus `/login`, `/no-access` and the app's 404. The site being shown to the centre's manager showed a
wall of security errors to anyone who opened devtools. Invisible because a React form degrades to a
full-page POST, so every login in the e2e suite kept working, and because the suite's CSP test visits a
*dynamic* route that could not fail. Both apps now render per request, set on the root layouts so a
prerendered page cannot be added by accident; verified by serving both builds and matching each script
tag's nonce against the response header.

*An issued invoice did not freeze — a line could still be DELETED from it.* `invoice_lines_write` was
`FOR ALL` with `status = 'draft'` in its WITH CHECK only, and PostgreSQL checks USING for DELETE. So
the condition never applied to that verb, and `0022` preserved the asymmetry faithfully when it split
the policy. Because a credit is a negative line by design, deleting one moves the total in either
direction: remove the "centre closed" credit and a family owes more than the invoice they hold, after
issue, with no void-and-reissue and no reason recorded. Three documents asserted the enforcement,
including the row in [[unverified-claims]] filing it as a claim that was *once* false and now
test-backed. `0025` fixes the verb and asserts the **class**: no `_write_delete` USING may be broader
than its `_write_insert` WITH CHECK, with an allowlist for the two tables where the difference is a
write-consistency rule. Found by asking the catalogue, which found two holes where one was reported —
`posts` had the same shape, letting any educator destroy a colleague's write-up of a child's day.

*The licensing binder hid real ratio breaches, and the correction feature was the mechanism.*
`attendance_events` is append-only with a supersede pointer, so every reader must resolve the chain.
Three readers existed and one did. `replayDay` applied both a corrected sign-out and its correction, so
breaches in that window vanished from `/compliance/binder` — the one artefact handed to a reviewer, in
the flattering direction. `attendance_today` had the same blindness with a nastier twist: **a correction
usually carries an EARLIER time than the row it replaces**, so `order by at desc` preferred the
superseded row, and a child corrected back onto the roll stayed off it. `resolveCorrections` is now
generic over `{ id, corrects }` so there is one rule rather than three readings of it.

**Two more that were live and quiet.** `/reset-password` accepted any signed-in session, so anyone at
an unlocked browser could set a new password without knowing the old one and lock the real holder out
of every device — now gated on the session's `amr` claim, chosen over a cookie because `httpOnly` stops
JavaScript and not a person with devtools open, and the two token shapes were measured on a throwaway
user rather than assumed. And `/auth/confirm`'s same-origin check was defeated by one backslash:
`new URL('/\\evil.com', origin)` resolves to `https://evil.com/`, because the WHATWG parser treats `\`
as `/`. An open redirect on the domain a password-reset email points at.

**The one that loses a child.** The web outbox's `flush` read a snapshot, awaited the network, then
wrote the survivors back wholesale — erasing anything enqueued during that window. A tap made while an
earlier flush was in the air disappeared with no error, no pending chip, the row back to "Not signed
in", and sign-out not blocked because the unsent count was zero. A child in the room, on nobody's roll
and out of the ratio, produced by the mechanism built to prevent exactly that. Mobile never had it: it
deletes by `client_uuid` instead of rewriting the queue. Now merged at commit time, which holds across
tabs too — where a reentrancy guard cannot help, because localStorage is shared.

**And the corrections feature, in production, was 12-13 hours out.** `correct()` called
`new Date(datetimeLocalString)` inside a `'use server'` action, and an offset-less string parses in the
runtime's zone — UTC on the server. So every correction attempted during the New Zealand working day was
refused by `attendance_not_future`, and the ones entered late enough to clear that window were stored at
the wrong instant and put a child who had gone home back onto the roll. Invisible because a dev machine
and CI on Pacific/Auckland parse the same string correctly; the bug exists only where `TZ=UTC`. The
comment above it was wrong twice over — it described a `time` input and the browser's clock, and the
field is `datetime-local` and the code runs on the server.

**Six were in the careers feature committed the previous day**, and they are listed on [[recruitment]]
rather than here. The two worth carrying: the honeypot returned a different sentence from a real
success, so it announced itself; and "either centre" was two uncompensated inserts, so a partial failure
told the applicant nothing was saved while their application sat in the database.

Also fixed: deleting a staff account was impossible once they had moved an application, because a
symmetric CHECK met `on delete set null` (`0026`); publishing or archiving a colleague's post was
refused by the policy while the UI offered it to every staff member (`0028`); a permanently-refused
sign-in was discarded with no message, because `describeSignOut`'s warning branch was unreachable; web
sign-out used the default global scope and killed the person's phone session, which this wiki has said
not to do since the mobile work; `createAnonClient` started a 30-second refresh ticker per password
change, with defaults right for a browser it has no callers in; the two-press delete existed only after
hydration; and the applications screen promised managers they could log an emailed application, which
nothing in the repo can do.


**Seventeenth, reported from a phone while the rest was being fixed: "Sign in to the centre app" led
to the site's own 404.** `SITE_APP_URL` had been set on the Railway service to the **description
column** out of the variable table in `docs/deploy-railway.md` — the literal words
*where "Sign in to the centre app" points*. `appUrl()` returned it verbatim, so the footer rendered
`<a href="where &quot;Sign in to the centre app&quot; points">`, which has no scheme and is therefore
a **relative** URL. The browser resolved it against the site's own host, and the site's own 404 page
is convincing enough that it looked like a routing bug rather than a configuration one.

Three things changed, because only one of them is about the variable. `apps/site/src/lib/site.ts`
validates both URL variables and falls back rather than emitting a broken `href` — recovering a
scheme-less host, which is the honest mistake, and refusing prose, `javascript:` and a bare word.
`/api/health` now reports `setButNotAUrl`, so a wrong value is visible without reading the HTML. And
the doc table changed: it had a copy-pasteable value and a prose description in adjacent columns, and
somebody copied the wrong one — the values are now literal and the prose is underneath.

`apps/site` also had **no test runner at all**, which is how a function feeding an `href` came to have
no validation. It has one now, and eight tests. One of them immediately earned its place: the first
version of the guard reported trouble by comparing its result to the fallback, and a scheme-less host
recovers to exactly the fallback — so "recovered" and "gave up" were indistinguishable and a working
configuration was reported as broken. Comparing to a fallback is not a way to ask whether something
worked.

RLS assertions 197 -> 203. End-to-end 55 -> 56. `drill:restore` re-run for three migrations: 35 tables,
4/4.

2026-08-06 — **Career applications are handled in the product**, and with them the first public
write path this schema has ever had. New page [[recruitment]]; migration `0024_recruitment.sql`.

The recruitment part is ordinary. The part that needed care is that until now the honest one-line
summary of `anon` was "reaches nothing at all", and a careers form needs an unauthenticated stranger
to create a row. Two designs were rejected before the built one. An **insert policy for `anon`** does
not work at all: every policy here is `TO public`, so it is evaluated for `anon`, and the predicates
call `caller_has_role` whose EXECUTE 0022 revoked from PUBLIC — the insert fails from *inside* the
policy with a 42501 that reads like a missing grant. An **HTTP endpoint on `apps/web` behind a shared
secret** was rejected on blast radius: it puts an unauthenticated endpoint on the container holding
children's records, holding the service-role key, which bypasses RLS on every table. What shipped is
one `security definer` function granted to `anon`, so the capability conferred by holding the anon key
is exactly "insert one application row, learn nothing". AGENTS rule 1 kept where it belongs.

Four properties are asserted rather than described. It **returns void**. It takes a **slug, never a
centre id** — a client-supplied uuid on an unauthenticated form that bypasses RLS is an invitation to
write into another tenant. A **repeat submission while an application is open is a quiet no-op**, not
an error, because "you have already applied" answers *has this address applied here* for anybody who
asks — the same oracle password recovery exists to avoid — and it is scoped to open statuses so
somebody declined last year can still apply, which is asserted because a unique index was the obvious
implementation and would have been wrong. And the **flood guard is in SQL**, because an in-process
limiter survives neither a restart nor a second instance. Twenty-two new assertions in
`rls_isolation.sql`, 192 total; the educator exclusion was mutation-tested by widening the policy and
confirming the suite failed on the right line.

**A check whose explanation had quietly stopped applying.** `review:security` reports anon-executable
definer functions and explained itself with "each returns nothing without a JWT, so this is defence in
depth rather than a hole". That was true of all seventeen and is **false** of the eighteenth, which is
designed to work without one. Leaving it would have been worse than no check — a reader would be told
the one genuinely public function returns nothing. It now has an allowlist with reasons, plus a second
finding for a *stale* allowlist entry, because a list that protects nothing is how it stops being a
decision. Both branches mutation-tested.

**DELETE is granted here and is not granted on `waitlist`**, which is the mirror of that decision
rather than an inconsistency. No service has a reason to hold the employment history of somebody it
did not employ. The claim that rests on it — "we removed your application" — is only true because
0021 stores changed column *names* and no payload, so both halves are asserted: that the deletion is
recorded, and that no audit row for it holds the applicant's name or email. Still not an erasure
right; the Act gives none, as this wiki already records. It is the retention principle.

Two defects that only a real database shows. **PostgREST turns an array insert into one multi-row
INSERT over the union of the keys present**, so a key missing from one object becomes an explicit NULL
instead of falling back to the column default — the e2e fixture omitted `status` on one of two rows
and got a not-null violation that reads like a schema defect. And **a concatenated select list
silently breaks row typing**: `supabase-js` parses the string at the type level, `'a' + 'b'` is plain
`string`, and the call comes back as `GenericStringError[]` with an error that names nothing relevant.

What is **not** built, recorded rather than implied: **no CV attachment** — it holds an address, an
employment history and referees who agreed to nothing, so it needs a bucket, storage policies for an
anonymous uploader, and a retention rule the centre has not given yet; CVs keep going to the mailbox
and `source` distinguishes those. **No vacancy list. No notification** when an application arrives.
Nothing belonging to a safety check is collected — no date of birth, no address, no criminal-record
question — because answering that into a public form is a disclosure made before anybody decided to
read the application. And `holds_practising_certificate` is nullable three-state and labelled on
screen as the applicant's claim, not as evidence.

Corrections made in the same commit rather than left: [[public-website]] said the site "has no
Supabase dependency at all… enforced by absence" and `docs/deploy-railway.md` said the service "has no
database access" — both now false, both corrected, and the surviving property stated precisely (the
**browser** still reaches nothing, verified by grepping `.next/static/` for the key and for any
Supabase string and finding neither). `decided_by`/`decided_at` were renamed to `status_changed_*`
before anything read them, by dropping and re-applying 0024 after confirming the table was empty —
moving something to "reviewing" is not a decision, and a column needing a comment to explain it does
not mean what it says is the smell itself. Definer count 17 → 18 in the README and
[[security-review]]. `drill:restore` **was** re-run, because a migration pulls it: 35 tables, 2864
rows, 4/4, every table identical after the round trip.

2026-08-06 — The centre's manager was invited: Taner Basar, taner@littlepearls.org.nz, **manager at
both centres**, at the owner's request. Two invitations because a membership is per-centre. Issued
with `createInvitation` and the app's own token helpers rather than `npm run onboard`, whose printed
link cannot establish a session — the fragment defect recorded in [[invitations]] is still unfixed,
and this is the first time it actually mattered rather than being a note. Recorded in
`docs/tenant-little-pearls.md`, along with the fact that the insurance gate is untouched: a manager
looking around an empty product is the point, entering a real child's allergies is not.

Found while doing it, and worth knowing before anybody writes another admin script: **service_role
cannot read the `centre_members` view** — "permission denied for view centre_members". It bypasses
RLS but not grants, so the UI's "already a member" guard could not be reproduced server-side. AGENTS
rule 2 working exactly as written.

2026-08-06 — Little Pearls' public website, rebuilt from scratch as `apps/site` — a third app in
this monorepo, deployed as its own Railway service. New page [[public-website]]. The rebuild was
forced rather than chosen: their site is Adobe Muse 2017 output, every file stamped
`Last-Modified: 3 July 2018`, and Adobe ended Muse support in 2020, so nobody could edit it in the
tool that made it. It also had no `viewport` meta and no media query anywhere, answered on four
hosts, and its "Enrolment & Fees" page contained no fee.

Two findings worth more than the pages. **Their entire brand palette fails WCAG AA with white
text** — white on their teal is 2.41:1, on their coral 2.88:1 — so the light palette is background
only, with darkened variants of their own hues for anything that must carry text. And **the first
attempt at those variants was wrong in a way that looked verified**: derived and asserted against
white, where they passed at 4.65:1, then axe found failures on all ten routes because the footer and
callouts sit on pale aqua, where the same colours measure 4.29:1. A pair checked against one
background is not a checked colour. Re-derived against the darkest surface they touch and now
asserted against all three, plus a test asserting that white on the light palette *still* fails, so
lightening the brand breaks the test that says the variants are needed.

Four monorepo files would have skipped a new app **silently**: the root `build` chain, the
react-hooks eslint glob, `tokens-css.ts` (one hardcoded output, `--check` comparing one file) and
`check-bundle.ts` (`const WEB = 'apps/web'`). `typecheck`, `lint` and `test` pick a workspace up for
free; those four report success while covering nothing. Both are now parameterised, and the measured
result validates the separate-app decision: the site's middleware is 31.5kB gzip against the app's
89.5kB, because it does no session refresh.

The enquiry form and platform news were **not** built, and the reasons are recorded rather than
deferred vaguely. Every policy here is `TO public`, so it is evaluated for `anon`, and the predicates
call `caller_has_role` whose EXECUTE `0022` revoked from PUBLIC — an anonymous insert fails from
*inside* the policy with a 42501 that reads like a missing grant. `review:security` check 8 fails the
build at high on any anon table grant. Nobody has DELETE on `waitlist`, including `service_role`, so
an anonymously-writable queue is a permanent spam store. And their form collects a child's name and
exact date of birth, which `docs/tenant-little-pearls.md` forbids until insurance is in place — the
centre does not need a child's legal name to phone a guardian back. News was rejected on
[[consent-gated-media]]'s own reasoning: withdrawal works because there is "no cache to invalidate",
and static HTML is that cache. [[deployment]] corrected — its naming rule now cuts both ways, and
"nothing about a centre is in the build" is true of the platform and false of the site.

2026-08-06 — Screens 4 and 5, which needed the thing that was missing: **the web app now has an
outbox.** For five phases "the offline path" meant mobile, and `attendance/actions.ts` justified
having no queue with "no offline gap to preserve, unlike on a tablet" — but the web app *is* what
runs on the tablet by the door, and a sign-in made with the wifi down simply failed. The tap
errored, the child was on nobody's roll, and the ratio counted the room one short.
`apps/web/src/lib/outbox.ts` mirrors the mobile contract on localStorage; details and the
mobile/web comparison in [[offline-outbox]].

The roll moved to the client, and not for interactivity — it had that. It moved because a queued
sign-in has to count toward the ratio and a server component cannot see a browser queue. One write
path, not two: every tap enqueues then flushes, because a fallback branch only exercised when the
wifi drops is a branch nobody has seen work. The old `signIn`/`signOut` server actions were removed
rather than left as a second way in; corrections and the adult count stay server actions, for
reasons recorded in both files.

Three findings, each worth more than the screens. **A pre-existing crash on the whānau child
screen**: `formatAge(dob, on)` takes a date and `splitByAgeBand(children, tz)` takes a timezone,
both optional strings, and `ChildScreen` passed the timezone to `formatAge` — which throws `Not an
ISO date: Pacific/Auckland`. Opening that screen crashed for anybody who had chosen a centre, which
is everybody; nothing caught it because nothing in that app has run on a device. I wrote the same
bug into the new roll and found it only by probing the helper instead of trusting the call.
**`browserDb()` was unusable, not unused** — it lived beside `next/headers`, so any client import
failed the build, which is almost certainly why it had never been called in months; moved to
`lib/supabaseBrowser.ts`. And **a test that signs out poisons every test after it**, because
sign-out revokes the refresh token server-side and the shared `OWNER_STATE` fixture went with it —
it surfaced three tests later as "owner → / landed /login".

Both new browser specs were mutation-tested. Two earlier mutation attempts never ran because lint
rejected them first: a mutation has to compile to prove anything, and `grep -c Compiled` is not a
build check — exit codes are. `drill:offline` was **not** run: it needs `ECE_DRILL_PASSWORD`, which
was not available. Recorded as [[unverified-claims]] item 21 rather than glossed, along with the
honest limit of the web offline story — work survives while the tab stays open, but the app is
server-rendered with no service worker, so a reload with no connection shows the browser's error
page.

2026-08-06 — The phone menu became a slide-in drawer, on request: the owner pointed at their own
charity admin console, where the menu overlays a dimmed page with a header and an ✕. **My earlier
reasoning was wrong on the part that mattered.** I twice argued against a drawer on the grounds
that an inline expander needs no focus trap — true, and beside the point. An expander *pushes the
page down when it opens*, so the thing you were reading moves. A drawer overlays and the page
stays put.

The cost is paid rather than skipped, because an overlay covering the page is a modal: Escape,
scrim click, focus in on open and back to the toggle on close, Tab trapped, body scroll locked.
All four asserted, because none are visible to axe or to a screenshot. Three details worth
keeping: closed means `visibility: hidden` and not merely translated off-canvas, or a keyboard
user tabs into a menu sitting off the left edge; the breakpoint is duplicated in `matchMedia`
because `role="dialog"` and `aria-modal` are attributes that cannot respond to a media query, and
leaving them on would tell a desktop screen-reader user the sidebar is a modal trapping them; and
the drawer is 70vw rather than 86vw, because the first attempt left a 70px strip of scrim —
technically tappable and not what anybody reaches for. That last one surfaced because Playwright
clicks an element's centre and the scrim's centre was *behind* the drawer: a fact about the test
that pointed at a real one.

Also **`--motion-*` now exists in the generated CSS**, easing curve included. The drawer needed
the pack's 260ms dialog timing and was about to hardcode it beside the `motion` token that already
held it — the exact duplication `tokens:check` exists to prevent. Rule recorded in [[conventions]]:
if a value lives in `tokens.ts` and a stylesheet wants it, emit it rather than copying it.

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

2026-08-07 — Ten pieces of design feedback on the public site, recorded in [[public-website]]. Nine
acted on, one deferred, and **one of them was factually wrong in a way worth keeping**: the claim
that black on their coral fails 4.5:1. It measures 6.05:1, it is asserted in
`LITTLE_PEARLS_CONTRAST_PAIRS`, and the number is recomputed into `tokens.css` on every generator
run. The coral went anyway — a saturated red-pink block reads as an alert whatever its ratio, and it
was carrying opening hours on eight routes. Taking the contrast argument at face value would have
produced the wrong fix: darken the coral until a number passes, and keep the alarm.

Two defects that no gate saw, both found by screenshotting the pages and looking at them after
`typecheck`, `lint`, `test`, `tokens:check`, `build:site` and `audit:site` were all green — the
homepage hero photograph also appearing in the row below it, and a masthead that cost three rows on
a 390px phone with the new sign-in link stranded alone on the third.

Corrected two pages rather than editing around them, per the contradiction clause above.
[[public-website]]'s feature table described a weave divider that has been removed, and
[[unverified-claims]] #19 said of the Doorway product name that "nothing in this repo uses it yet —
so there is no exposure today". The masthead of a real customer's public website now carries the
name and the mark on every route, before the IPONZ search has been run. That is the entry's own
warning arriving rather than being heeded, and it is written down as such.

2026-08-07 — Added a "Developed by Salix" credit to the site footer, recorded in [[public-website]].
Two things in a five-line change that a build could not have told anyone about, both found by
screenshotting the footer at 3x and looking at it.

Their **default** mark is the wrong file at footer size: it is a line drawing whose heaviest stroke
is 1.6 units in a 100-unit viewBox, so at 28px it lands near 0.4 device pixels and renders as a
scratch. Their own "16px is legible" note is about `favicon.svg`, which is a different drawing — a
solid tile with the leaf reversed out. Solid shapes survive being small; outlines do not.

And a CSS specificity bug of the shape that reads as a typo in the markup: `.foot p { margin: 0 }`
is (0,1,1) and `.foot-credit` is (0,1,0), so the credit's top margin was silently discarded and the
line sat welded to the one above it. **A rule that loses is invisible in a diff.**

2026-08-07 — The collapsed footer was reversed on the owner's call; the three columns are back, and
the credit moved to a bar at the very bottom. Recorded in [[public-website]].

The part worth keeping is not the layout. The collapse had bundled **a taste call** (fewer copies of
each address) with **a defect fix** (each centre's name was an `<h2>` in the footer *and* an `<h2>`
in the contact card, so `/contact`'s heading outline listed the same name twice at the same level).
"The previous footer was better" is about the first and not the second, so the columns came back and
the headings did not — they are `<p class="foot-head">`, identical on screen and correct underneath.
**When a change bundles a preference with a fix, unbundle them before reverting.**

Also a second specificity bug in the same footer, hours after the first: `.foot .foot-head` and
`.foot .foot-head-spaced` are both (0,2,0), so source order decides, and the first uses the `margin`
shorthand — which zeroes `margin-top` and silently undoes the rule meant to override it. Written in
the right order only because the first bug had just been paid for.

2026-08-07 — Maps on `/contact` and both centre pages, and **the Content Security Policy did not
change**. Recorded in [[public-website]] under *The map that is not an embed*.

This page's Rejected list said "a Google Maps embed — an iframe is a third party on a page read by
parents of three-month-olds, and `frame-src 'none'` stays", and `securityHeaders.ts` said the same.
The reasoning was right about iframes and was being applied to the wrong noun. What an embed costs a
reader is Google's JavaScript in the page, Google's cookies in their browser and their IP address
handed over for looking up a childcare centre — **none of which is a property of a map**. The
container fetches a PNG from the Maps Static API and serves it from `/api/map/<centre>`, so
`img-src 'self' data:` and `frame-src 'none'` are byte-identical, verified by curling the running
build rather than by reading the source. **Third time on this site that a request which appeared to
need a wider directive was answered by building it differently instead** — the webfont, the
photographs, now this. The pattern is worth more than any of the three.

The corollary nobody expects: a `<img src="https://maps.googleapis.com/...&key=">` puts the API key
on every reader's screen, restrictable only by a referrer header anybody can forge. Proxying is the
*more* private option **and** the one that keeps the key.

Two defects in my own first draft, one of them the interesting kind. `CentreMap` returned `null`
when there was no image — which silently took the "open in maps" link off both pages, so a missing
environment variable would have removed a working way to find the place. **The enhancement was
deleting the content.** Only the `<img>` is conditional now.

Coordinates are geocoded once and committed to `centres.ts` (`ROOFTOP`, no `partial_match`,
`formatted_address` matching what the file already said) rather than resolved per request. Handing
Google the address string works and was rejected: it moves "which building is this centre in" from a
reviewable value in a diff to a service call nobody sees, and the failure mode is a parent outside a
stranger's house with a three-month-old. A test asserts the request carries the coordinates and
**not** the street name.

Mutation-tested three guards rather than trusting a first-run pass — the content-type check, the
keep-the-stale-image branch, and the coordinate assertion. All three mutations failed exactly one
assertion each and nothing else.

**Maps are not live yet.** The Maps Static API is a separate product to enable in the Google Cloud
console from the Geocoding API the coordinates came from, and it is off — every request returns 403
with a plain-text body. The site is showing the fallback, which is the page it was yesterday plus a
"Get directions" button. Verified against the real endpoint; the success path was verified against a
local stand-in serving a real PNG, and the cache measured at two upstream calls across nine
requests. Recorded as gap 16 in `apps/site/CONTENT-GAPS.md` that **nobody has read Google's terms on
how long their content may be cached** — the TTLs are a guess in the safe direction, not a finding.

*Log last updated: 2026-08-09*
