# The console handover — making the shell feel finished

The second design handover (`handover/ECE Handover.dc.html`, 2026-08-10). Ten steps against real
file paths, aimed at structure rather than colour. What each one changed, and what it turned up.

## Overview

The first handoff — [[design-system]] — was a token pack and thirteen screens, and applying it
was largely a question of fidelity to a board. This one is the opposite: it opens by saying that
nothing in it touches `packages/core/src/tokens.ts`, because "the product does not look
unfinished because of its colours, it looks unfinished because of its structure." Every step is
a rearrangement of markup and a consolidation of spellings, not a repaint.

It supersedes `design_handoff_ece_platform/` as the current design intent, which matters for one
concrete reason: several screens the older page records as "applied" are changed here, and a
reader who trusts that page's deviation table without this one will restore behaviour this
handover deliberately moved. Where the two disagree, this page is later.

The order is the deliverable, not just the content. Each step is independently shippable and the
early ones are load-bearing for the later ones — `PageHeader` (step 3) and `Status` (step 4) are
the primitives that steps 5 through 10 spend, so building them out of order would mean writing
each screen's header twice.

## Key Points

- **The spec's build order is followed literally, one step per commit.** Steps 2 and 3 move DOM
  that the `a11y` and `roles` e2e suites assert against, and the spec says so itself.
- **Step 1's menu button is the whole shape of this handover in miniature**: a change with no
  new tokens, no new component and no new behaviour, that fixes a thing every phone user hits.
  The control that opens the drawer now sits at the edge the drawer opens from.
- **Reordered in the DOM, not with `order:`.** The spec asks for this and it is right: `order`
  moves the box and leaves the tab sequence behind it, so a keyboard user would meet the two
  controls in the opposite order to a sighted one. This is 1.3.2 Meaningful Sequence, and it is
  the kind of regression no screenshot shows.
- **The word "Menu" is now a visually hidden text node**, not an `aria-label` and not deleted.
  The accessible name is unchanged, which is why `a11y.spec.ts`'s `getByRole('button', { name:
  /Menu/ })` still matches — that locator was the test of whether the change was safe.
- **`handover/` is lint-ignored, like the pack before it.** It carries its own `support.js`
  browser runtime so the board opens offline; 93 `no-undef` errors from a vendored file are not
  a signal about this repo.

## Details

### Step 1 — the menu button moves to the left

`.side-head` was `justify-content: space-between` with the ident first and the toggle last, so
on a phone the ☰ sat at the right edge and the drawer it opened came in from the left. The tap
and its result were at opposite ends of a 390px screen.

Three changes, all in `SideRail.tsx` and `globals.css`:

- The `<button>` moved **above** `<div className="side-ident">` in the source.
- `.side-head` became a `gap: var(--space-3)` row with `flex: 1` on `.side-ident`, so the centre
  name takes the remaining width and truncates against the edge of the bar rather than against
  the button.
- `.nav-toggle` became a fixed `var(--target-min)` square with the label moved into a
  `.visually-hidden` span. A square button is the same size whatever it says, which is what
  lets it sit beside a centre name instead of stealing a variable slice of the bar from it.

`aria-expanded`, `aria-controls`, the focus return to the toggle on close, the scrim, the focus
trap and the Escape handler are all untouched.

**`position: relative` was added to `.nav-toggle`, and it is not cosmetic.** `.visually-hidden`
is absolutely positioned, and this repo has already shipped one defect where such an element
resolved against the page instead of a positioned ancestor and gave the document 31px of
horizontal scroll — the note against `.card` in `globals.css` records it. The hidden label here
sits at roughly x=38 and would not have overflowed, so this is insurance rather than a fix; it
is written down because the *reason* it is cheap is that somebody already paid for the lesson.

### Step 2 — six groups, and two counts the spec got wrong

`NavGroup` is a server component: `<h3>` + `<ul>`, rendering `null` when
`Children.toArray(children).filter(Boolean)` is empty. The six groups are the spec's — Today,
Tamariki, Records, People, Money, Centre — wrapped around the existing `<NavLink>` calls with
every `can()` condition, href, label and parent-specific label swap unchanged.

**The spec's description of the result is arithmetically wrong, and the mechanism it asks for is
right.** It says "an educator sees three headings and a parent sees none — the flat list is still
correct for them". Against the capability matrix in `@ece/core` that is not what the rule
produces:

| Role | Headings rendered | Why |
|---|---|---|
| owner / manager | 6 | every capability |
| educator | **4**, not 3 | `recordDailyPractice` carries Staff and Roster, so **People** survives alongside Today, Tamariki and Records |
| parent | **2**, not 0 | Overview, Children, Posts and Messages carry no `can()` guard at all, so **Today** and **Tamariki** always survive |

The mechanism was implemented as specified and the prose was not, because making the prose true
would mean adding capability conditions to four unguarded links — which the same spec forbids in
the next sentence, and which would be inventing an access rule to satisfy a sentence. A parent
therefore gets two headings over four links, which is more furniture than four links need. If
that is unwanted the fix is a presentation rule (suppress headings below some link count), not a
`can()` condition; it is not built, because nothing asked for it.

`Children.toArray` already drops `null`, `undefined` and booleans — verified, 6 children in, 2
out — so `.filter(Boolean)` removes nothing today. Kept as specified, and documented as
belt-and-braces rather than left to look load-bearing.

### Step 3 — one page header, and the prop that must not become a link

`PageHeader` takes `title`, `subtitle`, `helpHref`, `actions`, `status`, and **owns its own
bottom margin**. That last part is the component: there were four spellings of the same block
and, more to the point, four different amounts of space under it — `.page-head` with an inline
`1.25rem`, a `marginBottom: '1rem'` on the subtitle, `.sub`'s default `2rem`, or nothing at all.
Adopted on every `page.tsx` under `(app)` except one, and every inline margin override deleted
with it. There is now one number and changing it moves every screen together.

**`helpHref` is not a link and must never become one.** The handover's prop list names it and
its mockup draws a `?` beside the title, which reads like an anchor to `/help`. It is not: it is
the route key `TabHelp` looks a doc up by, and what renders is the existing in-place `<details>`
disclosure — server-rendered, no JavaScript, operable before React hydrates, argued for at length
in [[in-product-help]]. The prop name is the handover's; the behaviour is the code's. Turning it
into an anchor would undo the feature committed the day before and break the audit that clicks
`summary.help-mark` and expects `.help-body`. The docblock says so in those words, because the
name invites the mistake.

`PageActions` lost its own `margin: 0 0 1rem`. It had that because it used to be a block above
the content; every caller now passes it to `actions`, where it is a column in a flex row and the
margin is dead space at the top of the screen. Its argument about links versus buttons — the part
anybody would reuse — is untouched.

**One filled button per header, and three screens turned out to deserve zero.** `/reports` had
two filled buttons that navigate to sibling reports; they are secondary now. `/attendance`'s two
actions are a wall display and a download, and the thing that screen exists to do — sign a child
in — is on the row, not in the header. A read-only screen has no primary action, and filling one
anyway makes the loudest control on the page a way of leaving it.

**The child record is deliberately not converted.** `children/[id]` uses `.record-head`: an
avatar, a name, a meta line and a status flag. Step 6 rebuilds that header — flags under the
name, tabs as routes — and converting it here would mean inventing a `leading` slot for the
avatar in step 3 and rewriting it in step 6. It is the one page under `(app)` still on its own
header, and it is one commit away rather than forgotten.

**The CSS budget moved the wrong way, by 0.1kB.** `first-load-css` is 4.2kB against a 4kB limit,
having been 4.1kB before this step and already over. `.page-header`, `.page-status` and step 2's
nav-group rules are what added it. Nothing was orphaned that could be removed to pay for it —
`.section-head` still has six callers and `.page-head` is now PageHeader's own row class. Step 4
is where this comes back: consolidating four `.flag` spellings into one primitive should remove
more than these two steps added, and if it does not, that is a finding rather than a rounding
error.

### Step 4 — Status, and a prediction that was wrong

`Status` takes a tone and renders the existing `.flag` classes. **The CSS was never the
ad-hoc part** — `.flag` and its modifiers were already one block. What varied was the *glyph*,
typed by hand at all 157 call sites: warn appeared as `●` on one screen and `◌` on the next, ok
as `✓` here and nothing there. A tone whose symbol changes between screens is a tone a reader
re-learns each time, and the symbol is not decoration — it is the half of 1.4.1 that keeps the
meaning off colour alone. Binding it to the tone makes that structural instead of a habit.

The glyph is now `aria-hidden`. "Black up-pointing triangle, 1 whānau not told" is worse than the
sentence, every label is complete without its symbol, and 1.4.1 is about what the eye can
distinguish. No test depended on the glyphs — checked before changing them.

**Five tones, not four.** The handover names ok / pending / warn / breach, and its own mockup of
the incidents strip draws a fifth: "3 awaiting acknowledgement" in grey. That is not any of the
four, and specifically it is not `pending`, which in this product means *waiting to reach the
server* — the offline queue's blue. Rendering it in that blue would tell an educator three
reports are stuck in the outbox. So `neutral` exists, carries no symbol, and the four named tones
mean exactly what the handover says.

`.flag-pending` moved from beside the offline strip, 530 lines up, to sit with its four siblings.
That distance had a cost: a screen wanting a pending chip reached for `.flag-quiet`, whose
background is also `--pending-soft` and which therefore looks *almost* right.

Two things kept their hand-written classes, on purpose. `AttendanceRow`'s critical condition
carries `role="note"`, and a component that accepted arbitrary roles would be a `<span>` with
extra steps. The two unverified-ratio caveats are `<p className="flag flag-warn">` — block
paragraphs, not chips, and a primitive that has to be told to stop being inline is not the same
primitive.

**The prediction in step 3 was wrong and is left standing rather than edited.** That note said the
CSS budget would come back here. It did not: `first-load-css` is 4.2kB against a 4kB limit,
unchanged by this step, because the duplication `Status` removed was in TSX and TSX is not in the
CSS budget. Consolidating the three copies of the eyebrow declaration — `.side h2`, `.side nav h3`
and `.section > h2` were five identical declarations written out three times — was a genuine
saving and still did not move a figure reported to one decimal place.

So the honest position: this handover has put `first-load-css` 0.1kB further over a limit it was
already 0.1kB over. That is a number to raise deliberately or to pay down deliberately, and
`check:bundle` says as much itself. It is not something to keep predicting away.

### The footer's three links are a second landmark, and that is what kept a test passing

Account, Notifications and Help moved to `.side-foot`. They went into a
`<nav aria-label="Your account">` rather than a bare `<ul>`, for two reasons that agree.

The principled one: they are navigation, and the spec's own argument for moving them — "they are
about the person, not the centre" — is exactly the distinction a landmark label carries. Two
labelled landmarks is not the six the spec warns against; the six groups are headings inside the
one rail nav.

The practical one, found by reading the test before writing the code: `roles.spec.ts` scopes its
whole nav assertion to `page.locator('aside.side nav')` and asserts **Help is visible for all four
roles**. A bare `<ul>` in the footer would have moved Help out of that locator and failed four
tests, and the failure would have looked like a capability regression rather than a DOM move.
`.side nav a` also matches inside the footer nav, so the link treatment is inherited rather than
restated.

### The new assertion, and the mutation test that lied

`roles.spec.ts` gained `NAV_GROUPS`: which headings each role should be offered, and which must
not exist. Nothing else in the repo could catch a regression here — the links are correctly
absent either way, so every existing assertion passes with six empty headings on an educator's
screen, and an empty "Money" heading is a disclosure that money screens exist.

It passed first try, which this repo treats as a reason for suspicion rather than confidence. The
mutation — deleting `if (items.length === 0) return null;` — **also passed**, and the reason is
recorded in [[conventions]]: a `next start` left over from a screenshot capture, and
`reuseExistingServer`. Against a fresh server the mutant failed on educator/"Money" and
parent/"Records" and left manager passing, which is the correct shape.

Worth stating plainly: had that check not been run, the honest-looking conclusion would have been
that the new assertions were worthless.

### One comment that stopped being true, extended rather than deleted

Incidents carried "Beside Attendance because it is the same shift and the same tablet — not under
Compliance". The grouping splits that: Attendance is under **Today**, Incidents under **Records**.

Half the argument survives — Compliance is under **Centre**, so Incidents is still nowhere near
the binder — and the half that does not is now written down beside it, with the distinction that
replaced it (Attendance is watched, an incident is filed) and the instruction that if it proves
wrong in use the fix is to move Incidents into Today rather than to dissolve the groups. A comment
that quietly stops describing its own code is how the next reader is misled by something that was
once true.

### A stale comment left in place, with a correction attached

The `@media (max-width: 767px)` preamble in `globals.css` still argues **against** a hamburger —
"a disclosure widget hides eight destinations behind a tap and needs state, a focus trap and an
escape key". That was true when the rail became a wrapping top bar and was overtaken when the
drawer arrived; `SideRail.tsx` already carries the correction ("wrong about an inline expander
and right about this").

It was not deleted. The cost it lists is exactly the cost that ended up being paid, and a
comment that records a rejected design is worth more than a comment that records only the
winner. A pointer to the argument that changed the answer was added instead.

### The CSS budget was already breached before this handover started

`npm run check:bundle` is **red on `main`**, and was before step 1 touched anything. Measured by
stashing the change, rebuilding `apps/web` and re-running: `first-load-js` 112.8kB against a
106kB limit, `first-load-css` 4.1kB against 4kB — byte-identical with the change applied and
without it.

This matters more than 0.1kB of CSS sounds, because it is the constraint the handover names
explicitly: new shared styles go in `globals.css` only when two or more screens use them, and a
single distinctive screen gets a route-scoped sheet as `kiosk/kiosk.css` does. Steps 2, 3, 4 and
7 all add shared styles, and they are adding them to a budget that is already over. So the rule
is not a preference here; every one of those steps has to pay for itself, either by consolidating
more spellings than it introduces — which is precisely what the `Status` primitive in step 4 is
for — or by not going in `globals.css` at all.

The JS overage is a separate matter and is not this handover's to fix: nothing in these ten steps
adds a client component that was not already there. Recorded so that a red `check:bundle` after
step 10 is not mistaken for something these commits did.

### What the demo seed could not do, and what was used instead

The screenshots in `handover/screens/` are captured against the demo centres (`demo-mt-albert`,
`demo-mt-roskill`), signed in as the account that already owns them. The session is established
with an **admin-generated magic link**, not a password: there is no shared credential for that
account, and minting one on a live database to take a screenshot would be a worse idea than any
screenshot is worth. `/auth/confirm` already accepts `token_hash`, so nothing was added to the
app for this.

One trap worth recording. Under `next start`, the redirect out of `/auth/confirm` is built from
`new URL(request.url).origin`, and Next reports that origin as `localhost` **regardless of the
host the request arrived on**. A capture run pointed at `127.0.0.1:3210` therefore set its
session cookies on one host and was redirected to another, arriving signed out with no error
anywhere. Not a fault in the route — `originOf()` handles forwarded headers for the links that
matter — but it is invisible, and the symptom (a screenshot of the login page) does not point
at its cause.

## See Also

- [[design-system]] — the pack this supersedes, and the deviation table it left behind
- [[in-product-help]] — the `?` affordance that `PageHeader` takes over in step 3
- [[conventions]] — token generation, and why nothing here regenerates them

*Last updated: 2026-08-11 (steps 1-4 of 10)*
