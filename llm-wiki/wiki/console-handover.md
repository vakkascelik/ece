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

### Step 5 — attendance, and three tests that were already red

The ratio takes a `minmax(0, 2fr)` column and the adult count sits beside it in `1fr`, stacking
below 768px. `AdultCount` is rendered by the server page and **passed into `RollClient` as an
element**: the ratio has to include the browser's queue, so it is computed in the client, while
the count owns a server action — passing the finished element is what lets them share a grid
without either crossing the boundary.

The ± controls are one form with two submit buttons. A submitter's own `name`/`value` go into
the FormData, so each button posts the count it means and `setAdults` still receives an
**absolute number** — which is what keeps it an event rather than an increment. Two "+1"s
arriving out of order would otherwise resolve to whichever landed last.

`AdultCount` lost its `<section>` landmark and its "Adults present" heading, which is now the
card's eyebrow. A landmark over a single card was not earning its place, and the count belongs
beside the ratio because they are one question.

**Health flags were already fetched and thrown away.** `listHealthByChild` was read for the
critical check and its non-critical rows discarded. They render now, warn-toned, and only when
nothing critical is on the row — two flags on one name is how the important one stops being read.

**The route-scoped sheet is the answer to the CSS budget.** `attendance.css` is imported by
`attendance/page.tsx`, and `check:bundle` measures the root layout's stylesheet only, so this
step added shared styles and moved `first-load-css` by zero. That is what the handover's rule was
for, and it is worth stating plainly after steps 2 and 3 each put a little into globals.css
without asking whether the screen was distinctive enough to pay for itself.

### The pending dot the spec asked for, and why the row keeps its words

The handover asks for "a pending dot on rows that came from the outbox". The row already carries
a labelled chip reading **Waiting to send**, and the comment beside it argues the case: "a real
text node, not a dot and not a greyed row … a greyed chip is a state somebody has to learn."

A bare dot would be colour alone, which is the one thing every flag in this product is built to
avoid — and it would be the exception in a codebase where the same rule is stated three times.
The chip stays. The section heading gained the count the spec asks for, scoped to the children
*that section claims are here* rather than to the whole outbox: a queued sign-out belongs to "Not
here", and counting it under "Here now" would say the opposite of what it means.

### Three e2e failures that were red on `main` before this step touched anything

Running the offline and journey suites — which steps 1 to 4 had no reason to run — turned up
three failures, and none of them are this handover's. All three have one cause, and it is worth
recording because the mechanism will recur.

Commit `712ba7d` added an in-product help note to every screen, and that note quotes the
product's own sentences back at the reader. Two of those quotes are strings the e2e suite matches
on:

- *"a row that has not been sent yet says 'Waiting to send'"* → `page.getByText('Waiting to
  send')` now resolves to two elements and fails strict mode. Two tests.
- *"The ratio figures have not been checked against the regulations by anybody"* →
  `getByText(/have not been checked.../i).first()` now matches the **hidden help paragraph**
  instead of the visible ratio caveat.

The second one is the dangerous half. That assertion is a deliberate tripwire — it exists so the
unverified-ratio caveat cannot be deleted from the banner while the flag stays false. Pointed at
the help note, it was passing on hidden prose *about* the caveat, and would have gone on passing
after the caveat itself was removed. **A tripwire that can be satisfied by documentation of
itself is not a tripwire.**

Both are now scoped — `.roll` for the chips, `.ratio` for the caveat. The general lesson: once a
product documents its own copy on the same page, matching that copy by text is no longer a way to
find the thing it describes.

Nobody noticed because the help commit touched no route, no role and no schema, so none of the
triggers in AGENTS.md §5 fired for the full e2e suite. That gap is real: the suites most likely
to break on a copy change are the ones nothing tells you to run.

### The offline strip could not count to one

`"1 sign-in are saved on this device"`, and `"1 sign-in on their way"`. Only the noun was
pluralised. The singular is not the rare case on this strip — it is the **first queued tap**,
which is the moment somebody is deciding whether to believe a screen about a child in the
building.

### Step 6 — the child record becomes five routes, and the safety property got stronger

`children/[id]/layout.tsx` owns everything that does not change between tabs; `page.tsx` is the
overview and `[tab]/page.tsx` is the other four. A layout rather than a component each page
renders, so the header does not remount when a tab changes — the flag row is what an educator is
reading *while* they navigate.

**Tabs could have destroyed the record's one safety decision, and this is the part to read.** The
page used to lead with a "Read this first" block above the identity metadata, because health is
"the only block read under time pressure": names and dates are read by somebody sitting down, an
allergy by somebody holding a child who has eaten something. Health on its own tab puts the
allergy one tap away from every other screen, which is worse than the scroll it replaced.

So the flags moved **into the header**: breach-toned for anaphylaxis and severe with the response
plan inline, warn for medication authorised, consents unanswered, no enrolment, no immunisation
record. They sit above the age and date of birth and they are on **every tab**, including the
paperwork ones. The property is stronger than it was.

The handover's mockup draws the meta line above the flags; its prose says "flags directly under
the name". The prose agrees with the safety argument, so the prose won.

`a11y.spec.ts`'s tripwire was rewritten to match. It read the `<h2>` order on one long page —
meaningless once each tab has its own headings — and now asserts the critical flag is visible and
**measurably above** `.record-meta` on all five tabs. If somebody later moves the flag row back
inside a tab, it fails on the tab they did not think about. Four more audits were added, one per
tab: the overview is the least dense of the five, and auditing only it would have reported a pass
on four screens nobody looked at.

**Learning is not built, and the tab is absent rather than empty.** The handover names six tabs.
Five are groupings of panels that already exist. Nothing in this product associates a post, a
learning moment or a curriculum strand with one child in a way this record could read, so
building it means building a per-child feed — a feature, not a restyle. An empty tab labelled
"Learning" is a promise the product does not keep, which is the same objection this record
already makes to an empty "Custody" heading.

**No tab is hidden from a guardian, and the mechanism is there anyway.** The handover asks for
tabs a guardian's capabilities cannot fill to be hidden. With this mapping there are none — a
parent legitimately reads their own child's whānau, health, attendance and paperwork, and the
panels inside already gate what they show. `tabs.ts` carries the `capability` field and reports
honestly that it currently excludes nobody, rather than a filter invented to make a sentence
true. That is the third time this handover has predicted a capability-driven hiding that the
capability matrix does not produce.

Each branch fetches only what it renders. The single-page version issued fourteen queries on
every open, including medication doses for a manager who came to fix a spelling.

### An undefined tab returns 200, and the test says why

`/children/[id]/finance` calls `notFound()` and shows the not-found page — with a **200**. The
record's layout does async work and streams, so by the time the page calls `notFound()` the
response has begun and the status can no longer be changed. A status-code assertion would have
been asserting something this app cannot deliver, so the test asserts what the person who
mistyped the URL is actually shown.

### A fifth assertion broken by the same in-product-help commit

`absence.spec.ts` asserted the confirmation panel's caveat by text. The Whānau help note quotes
that caveat almost word for word, so the locator resolved to two elements. Both texts are correct
and neither should change.

That is now **five** e2e assertions broken by `712ba7d`, across three files, all by the same
mechanism: the product documents its own copy on the same screen, and assertions that match copy
by text stop pointing at the thing the copy describes. Four were found by this handover only
because it happened to touch the screens they cover. The pattern is worth a rule — **a test that
matches product copy needs a container**, and the container is what says which of the two
sentences it means.

### Step 7 — the incident form, and the button that is deliberately absent

Two columns: what this is on the left, what to type on the right, with the guide **first in the
source** so that when the columns collapse on a narrow tablet somebody filing their first report
still reads the explanation before the fields. The action bar is `position: sticky; bottom: 0`
rather than `fixed`, so it stops at the form's own end instead of floating over the register
underneath once the form is scrolled past.

**There is no Finalise button on this form, and adding one would have been a regression.** The
handover asks that Save draft and Finalise "never look alike and never sit adjacent without the
irreversibility warning between them". This form already satisfies that more strongly than a
warning could: the two acts are on different screens. Finalising is a control on the register
row, pressed by somebody who has read the draft back — and the form's own docblock says why, in
words written before this handover existed: *"a 'save and send' would be pressed by somebody
standing up holding a crying child."*

So the requirement is met and the mockup is not reproduced. What was added instead is the
sentence saying where finalising happens, because a form with a single draft button and no
explanation reads like an unfinished form rather than a deliberate one.

The step list is labelled as the three things the report has to end up saying, not as form
steps — and step 3, "who was told", says on its face that it is recorded on the register after
finalising. Somebody filing their first report otherwise finishes this form believing the family
has been told.

**Amend now shows what the original said.** `basedOn` already carried the original's text and
spent it entirely on pre-filling the fields, so the writer was editing over the only copy on
screen of what the family actually read. It is now quoted in the left column, visibly not an
input: not editable, not what will be saved, and it must not look like either.

### Step 8 — admin screens, and three sections that do not exist

**Settings is one form per card, each with its own save.** `updateCentre` already took a partial
patch and wrote only the keys that were not `undefined`, so a section save touches its own
columns and no others — which is also what makes two people editing different sections safe. The
alternative, hidden inputs carrying the other sections' current values, would have made one
person's save silently overwrite another's. Each card has its own `useActionState`, so a failure
in one cannot report itself under another's button.

The handover names five sections: Centre details, Hours and rooms, Notifications, Integrations,
Data and retention. **Three of them have nothing to put in them** — this schema has no rooms and
no opening hours, no per-centre notification preferences, and no centre-level retention setting.
Empty cards would be inventing settings, and a settings screen offering a control the product
does not honour is worse than a short one. So: Centre details, Daily practice, Integrations.
"Daily practice" is not one of the five names because the fields in it are not hours and not
rooms, and a card named for something it does not contain is how somebody later fails to find
the setting they came for.

Integrations keeps its own card for a reason beyond naming: it holds the one control in this
product that sends data outside it, and a decision to send data offshore should not sit three
fields below a sleep interval where somebody can agree to it while looking at something else.

**Accounts rows expand to their payments, and the read did not exist.** `recordPayment` has been
in `packages/api` since Phase 5 and nothing ever read the rows back, so a balance was shown with
no way to see what it was made of. `listPaymentsFor` is new; `payments_select` in 0019 is
`exists (select 1 from invoices i where i.id = invoice_id)`, so a caller sees payments for
exactly the invoices they can already see and the boundary is the invoices policy asserted since
0019 rather than a second one written for this. RLS suite: 447/447.

**`bounded-queries.test.ts` refused the first draft of that function, and was right to.** It was
a plain `select` across every outstanding invoice at a centre. A fortnightly biller with a few
hundred families behind is not a strange case, and truncating at PostgREST's silent 1000-row cap
would drop payments off the end — so a family who had paid would show a balance with nothing
behind it, which is exactly the conversation the feature exists to prevent going wrong. Paged
with `fetchAll()`. This is the check [[reading-every-row]] exists for, catching a function
written the same day.

### Two headers that said the same thing twice

Adding outstanding counts to the list headers broke `staff.spec.ts` and `billing.spec.ts` on
strict-mode violations, and the tests were pointing at something real: each header now repeated,
word for word, a sentence already forty pixels below it. That is not emphasis.

Staff's header dropped the unlinked-certificate count, because the card below carries it *with
the remedy attached* — link them on Compliance, because nothing guesses which person a
certificate belongs to — and the copy with the remedy is the one worth keeping. Accounts' header
reports how many invoices are overdue rather than repeating the money figure, which is the more
useful of the two anyway: it is how many families somebody has to ring.

Three settings assertions were scoped to the Daily practice card, by heading rather than by
position, because the order of the cards is a layout decision and those are not tests about
layout.

### Step 9 — the kiosk mostly already was this, and one instruction was refused

Most of what the handover asks for on this route was built when the route was: one column,
`--target-primary` on every control, type from `--text-lg` up, the three-step flow, no affordance
that leads anywhere else, and a keypad drawn in the page rather than a text input that summons
the OS keyboard over the roll. That last one matters more than it looks — the PIN never reaches
an input element, a URL, `localStorage` or a cookie, which is the whole reason 0044 compares it
inside Postgres.

Two things changed:

**The connection strip is always rendered.** It appeared only when offline, so the roll jumped
down the moment the wifi dropped — under the finger of somebody already reaching for their
child's name. Reserving the height means the state can change mid-tap without the target moving,
which is the same requirement step 10 puts on the mobile app's strip. Quiet when connected,
breach-toned when not — not warn-toned, because there is no offline queue here and a tap made now
does nothing, whereas amber would put it in the same visual class as a certificate expiring next
month.

**The confirmation is full-screen and clears after eight seconds**, not six. It has to be
readable from where somebody is standing as they turn to leave, several steps away and not
looking straight at the tablet. Covering the roll is the point rather than the cost: it stops a
second family starting a sign-in on top of a confirmation the first one never saw.

**"Blocking when not [online]" was not implemented, deliberately.** The handover asks the offline
strip to block. The screen's own comment refuses that, and it is right: `navigator.onLine`
reports the link and not whether the server is reachable, so it is used to warn and never to
decide. Blocking on it means a captive portal or a flaky adapter refuses a sign-in that would
have worked, at the door, with a parent standing there — the exact failure the instruction is
trying to prevent, arrived at from the other side. The strip is now impossible to miss and says
what will happen; the attempt is still made, and a real failure is still reported by the server
rather than guessed at by the browser.

### Step 10 — mobile, where two of the three asks were already done better

**`ChildCard` needed nothing.** The handover asks for "one 44px action labelled with the next
state — 'Sign in' or 'Sign out', never both". `SignInButton` has rendered exactly one button
labelled with the next state since Phase 2, at `target.primary` (64px) rather than 44, and its
docblock says why: it is tapped by somebody with a child on one hip and a bag in the other, and
WCAG's floor has nothing to say about that. Shrinking it to 44 to match a spec would be the
regression [[design-system]] already refused once.

The one difference is that the flag row sits *beside* the action rather than above it. That is
also a recorded decision — the action used to be a block below the card, "which cost a whole row
of vertical space per child and put the button nearer the next child's name than to its own".
Left alone.

**`OfflineStrip` now keeps its height when silent.** It returned `null`, so the roll jumped by a
whole strip every time the queue drained or the wifi dropped — under the thumb of somebody
already reaching for a child's row, where a mis-tap signs the wrong child in or out and that is a
legal record. Silent and present is the only combination that is both honest and safe. The
reserved box is `accessibilityElementsHidden`, because the alternative — rendering invisible text
to derive the height — leaves "↻ Offline" reachable by a screen reader on a working connection.

**`EmptyState.action` is required, and it is a union.** The handover asks for it to be required
so that every empty state names what happens next rather than the absence, and it is right that
"No posts yet" is a dead end. But two of the three screens have nothing a reader can press:
nothing makes a kaiako post, and nothing on a parent's phone enrols a child. A required *button*
would have put one there anyway, which is how a screen comes to offer something that does not
work — and Pānui's own note already refused exactly that.

So `{ label, onPress }` when there is something to do, and `{ next }` when there is not. Messages
adopted `EmptyState` at the same time; it was still a single line of muted text, which is the
thing this component was extracted to stop.

### The handover's own example copy would have shipped a false promise

Its suggested wording is: *"Nothing from the centre yet — you'll get a notification"*.

**This product does not send notifications.** `apps/mobile/lib/push.ts` is written from the
documented API, typechecks, bundles, and — in its own words — "none of this has ever run", which
is why it is in [[unverified-claims]]. `/notifications` says the same thing about itself: nothing
tells a family the page has something new on it.

Putting that sentence on the screen a family opens most would have been the product asserting a
capability nobody has checked, in the exact form rule 5 exists to prevent. The empty states say
the opposite instead — "open the app to check — this product does not send alerts yet" — which is
true today and is a sentence somebody will have to come back and delete when push works, which
is the right direction for that kind of debt to run.

### After the ten steps — the budget was paid down rather than raised

`first-load-css` finished the handover at 4.2kB against a 4kB limit. It is **3.5kB** now, and
that is 0.6kB *below* where it stood before any of this work started.

Nothing was deleted to get there and the limit was not touched. The ratio block, the roll, the
wall display, the offline strip and the child record's header all moved out of `globals.css` and
into `attendance/attendance.css` and `children/[id]/record.css` — each is used by exactly one
route, and `check:bundle` measures the root layout's stylesheet, so every screen in the product
was downloading the wall display's 88px numerals.

That is the handover's own rule — *a single distinctive screen gets a route-scoped sheet, as the
kiosk already does* — applied backwards to the CSS that predated it. The rule turned out to be
worth more than the steps that were written against it: steps 5 to 9 each added shared styles for
nothing because they followed it, and applying it retroactively recovered three times what those
steps would have cost.

The comments moved with the rules. They are the expensive part, and a rule that arrives in a new
file without the argument for it is a rule somebody deletes.

**`.healthcard*` was deleted rather than moved.** It styled the "Read this first" block that step
6 removed — the anaphylaxis conditions are in the record's header now, on every tab — so it had
no users left. An orphan this work created, and therefore this work's to remove.

**`.eyebrow` is dead and was left alone.** It has no users either, but it predates this work, and
the rule is to remove only the orphans a change creates. Named in `globals.css` so the next person
clearing dead CSS starts there.

The wall display's e2e test is what proves the move worked: it asserts computed font sizes at 88px
and 44px, so a route sheet that failed to load would fail that assertion rather than pass quietly
as a smaller screen.

### Two defects the handover did not ask about

**The overview told every owner the product does less than it does.** `/` rendered "Nothing holds
child data yet — enrolment, attendance and daily records are not built" on sign-in, unconditionally,
long after all three were built. Corrected to what is actually held, in AGENTS.md §1's wording.
The clause it carried about professional indemnity insurance is now item 35 in
[[unverified-claims]] rather than quietly deleted: the product asserts neither that cover exists
nor that it does not, and removing a caution is a decision rather than a tidy-up.

**A child's anaphylaxis response plan was in a `title` attribute** on `/children` —
where the EpiPen is kept, whether to ring 111 — which is meaning available to a mouse and to
nothing else. `AttendanceRow` had exactly this and lost it in Phase 6; the child record now prints
the plan as text. The roll was the last place the old pattern survived, which is how a rule
quietly becomes a preference. The flag still names the condition and its severity, which is what
decides whether somebody opens the record; the record is one tap away and prints the whole thing.

### Icons in the rail, drawn rather than installed — and the rail scrolls itself

Asked for after the ten steps, against a comparable admin console that has them.

**Twenty-four hand-authored inline SVGs, no package.** The handover forbids an icon
dependency and is right to here: this is a few kilobytes of path data against a library that
ships several hundred and updates on somebody else's schedule. Server-rendered into the HTML,
so nothing lands on the JavaScript budget and nothing on the CSS one — `first-load-css` went
3.5kB → 3.6kB, still comfortably inside 4kB.

Not text glyphs either, unlike the flags. `▲` and `✓` are text over there on purpose, because
they survive a copy-paste into an email; a *navigation* glyph drawn from a font renders as
colour emoji on Windows and as something else on macOS, at a size nobody chose. State needs to
survive being copied. A nav icon needs to look the same on every tablet in the centre.

Every one is `aria-hidden` and `focusable="false"`, and `icon` is a separate prop on `NavLink`
rather than something a caller folds into `children` — so an icon cannot be passed *instead of*
a label. An icon-only link would have no accessible name at all, and the type forbids the one
arrangement that breaks. The 116-test suite passing unchanged is the evidence: every
`getByRole('link', { name: 'Attendance', exact: true })` still matches.

Worth being honest about what icons buy. Attendance, Messages and Settings have shapes
everybody already knows; Compliance, Site safety and Enquiries do not. For those the glyph is
a position marker — useful for finding the same row twice, not for working out what it means
the first time — which is why the labels stayed at full size rather than shrinking now that
there is a picture beside them.

### The groups do collapse, and the reason they did not was wrong

**Correcting the section below rather than editing it.** It argued that collapsing would make
the rail a client component with storage on every screen, against a JavaScript budget already
6.9kB over. That was the load-bearing reason, and it was **false**: `<details>`/`<summary>`
collapses with no JavaScript at all — focusable, operable with Enter and Space, announced as
expanded or collapsed, working before React hydrates. This codebase already depends on exactly
that; it is why `HelpNote` is a `<details>` and why the kiosk draws its own keypad. The argument
was available in two files in the same directory and was not consulted.

The other two objections survive as design constraints rather than refusals, and shaped what
was built:

- **Default open, never default closed.** Attendance is opened dozens of times a day on a
  tablet at the door. Shipping the rail collapsed would put a tap in front of the most-used
  screen in the product for everybody, to tidy it for the few who want it tidy. Collapsing is
  opt-in; somebody who never touches it never pays for it.
- **It has to be remembered.** A disclosure that resets on every navigation is worse than none
  — you close Money, click Attendance, and Money is back. So a cookie, read on the server so
  the `<details>` arrives in the right state rather than flashing open and collapsing on every
  page load.

The cookie stores **what is closed**, not what is open, so the default with no cookie — a new
person, a cleared browser, a shared tablet — is every group open. A stored list of open groups
would default to a rail with nothing in it, and the failure mode of a preference must never be
"the navigation disappeared".

One client component, `NavGroupMemory`, mounted once beside the nav — `NavGroup` stays a server
component. It listens in the **capture** phase because `toggle` does not bubble, and re-derives
the whole list from the DOM on each toggle rather than tracking state, so what is stored cannot
drift from what is on screen.

`navGroups.ts` / `navGroups.server.ts` is split for the reason `locale.ts` /`locale.server.ts`
already was: a Client Component needs the cookie's *name*, and importing that from a module
which calls `cookies()` pulls a server-only API into the client bundle. The build refuses,
which is the good outcome — but it is the second time this exact split has been needed, so it
is written down twice now.

**The chevron is `aria-hidden`.** `<details>` already announces expanded or collapsed; a glyph
in the accessible name would say it twice. It rotates off the element's own `[open]` state in
CSS, so there is no second source of truth — the same reason the current nav item is styled off
`aria-current` rather than a class.

**`e2e` asserts the memory, not the collapsing.** Native `<details>` cannot really break; the
cookie link can, and if it does the groups spring open on every page load and the feature
becomes an irritation. Nothing else would notice — every other assertion opens a page fresh,
where the default is open and a broken cookie looks identical to a working one. Mutation-tested
by removing `NavGroupMemory`: fails on the right assertion, with the message that names the
cause.

### What the scrolling rail was for, and what was wrongly rejected with it

The question that came with the icon request was whether the groups should become dropdowns.
Measured first, at 1440×900 with an owner signed in:

| | before | after |
|---|---|---|
| rail height | **1536px** | 900px |
| page scroll | **636px** | 0 |
| `.side-foot` top | 1299px | inside the rail's own scroll |

So the problem behind the question was real: twenty-four links and six headings do not fit on a
laptop, Sign out was 400px below the fold, and reaching it scrolled the *page* — which on
`/attendance` scrolled the roll away too. Worth owning that grouping made this worse: six
headings added about 210px and moving three links to the footer gave back about 130.

The fix is `position: sticky` with the rail's own `overflow-y`, and it is still the right fix —
a rail that scrolls hides nothing, and it works whether or not anybody ever collapses a group.

What was wrong was rejecting the disclosure *as well*, on the grounds quoted in the section
above: that remembering the state would make the rail a client component with storage on every
screen. It does not. `<details>` is native and the memory is one cookie. The two changes are
complementary and both shipped — the rail scrolls, and the groups collapse for anybody who
wants them to.

`100dvh` rather than `100vh`, and the phone breakpoint resets `position`, `max-height` and
`overflow` explicitly — the rail is a bar there and the drawer is `fixed`, so none of this
applies and inheriting a stickiness nobody asked for is how a phone layout drifts.

### The captures, and how to make them again

`handover/screens/` holds the six the handover asks for, plus the child record and the incident
form. All at `deviceScaleFactor: 2`, because a screenshot placed beside a design document at 1×
is the blurry one.

**Five of them cannot come from the demo seed.** `scripts/seed-demo.ts` creates children,
enrolments, health, whānau and consents and **no attendance, no incidents and no staff** — so
there is no roll to photograph, nothing to put in an outbox and no draft to leave outstanding.
They come from the e2e audit tenant instead, which has a signed-in child, an anaphylaxis flag and
a draft incident, and which drops itself afterwards.

The harness lives in `e2e/.artifacts/` and is **gitignored**, so it is not in the repo and this
paragraph is the reproduction instructions:

- `shots.ts` — a standalone tsx script for the demo-seed captures (shell, staff). Signs in with
  an admin-generated magic link rather than a password, so nothing about a real account changes.
- `shot.spec.ts` + `capture.config.ts` — the audit-tenant captures. Its own Playwright config,
  because `playwright.config.ts` deliberately excludes `.artifacts/` after a harness there was
  collected as a spec and left a draft incident in the shared tenant.

**Two traps, both paid for once.** Under `next start`, `/auth/confirm` builds its redirect from
`new URL(request.url).origin`, which Next reports as `localhost` regardless of the host the
request arrived on — so a run pointed at `127.0.0.1` sets cookies on one host, is redirected to
another, and photographs the login page. And the capture output path was `process.cwd()`, which
is whatever directory the harness was invoked from: running it from `apps/web` (which its own
config requires) wrote five captures into `apps/web/handover/screens/`, reported success, and
moved nothing. It is anchored to this file's own location now. A path that depends on where you
were standing is not a path.

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

*Last updated: 2026-08-11 (all ten steps, plus icons and collapsible groups)*
