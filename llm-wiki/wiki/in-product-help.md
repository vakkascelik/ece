# In-product help

*The `?` beside a heading, the `/help` page behind it, and the three things that decided the
shape.*

## Overview

Added 2026-08-10. Code: `apps/web/src/app/(app)/HelpNote.tsx`,
`apps/web/src/app/(app)/help/` (`page.tsx`, `tabs.ts`, `TabHelp.tsx`),
`apps/web/src/lib/__tests__/helpCoverage.test.ts`, and the `.help` block in `globals.css`.

Two surfaces, one source. A question mark sits beside every screen's heading and beside the
eight sections of the child record; `/help` is the documentation page listing every screen the
reader's role can open. Both render the same sentences out of `help/tabs.ts`.

## Key Points

- **`<details>`, not a tooltip.** A `title` attribute is meaning available only to a mouse, and
  this codebase already deleted one that was carrying a child's anaphylaxis response plan.
- **No JavaScript, on purpose.** `/help` builds at **186 B** — the floor. Help that is dead
  until React hydrates is broken exactly when a new person is looking for it.
- **Every entry carries what it will not tell you.** That third field is why the page is worth
  having in a compliance product.
- **One array, two readers**, because two copies of the same paragraph diverge and nothing
  renders them side by side.
- **A test derives the tab list from `layout.tsx`** rather than restating it, so a route added
  without documentation fails a check instead of silently going undocumented.

## Details

### `<details>` rather than a tooltip, and the precedent for it

`AttendanceRow` once carried a child's medical response plan in a `title` attribute. It was
removed rather than restyled, with the reasoning recorded in the file: a `title` is invisible
to a keyboard, to a touch screen, and to most screen readers. A help affordance built on the
same attribute would repeat that mistake in the one place whose entire job is explaining
things.

Native `<details>` is focusable, operable with Enter and Space, and announced as expanded or
collapsed, with no ARIA to get wrong. The precedent was already here: `RatioBanner`'s *"Which
rule is this?"* is the same shape.

**The accessible name is not "?".** The glyph is `aria-hidden` and the real name is a question
— *"What is Attendance?"*. Twenty controls all named "?" is a screen-reader user's list of
twenty identical buttons, which is the defect `aria-label` already fixes on the roll's twenty
"Sign in" buttons.

The target is `--target-min` (44px). WCAG 2.2 adds 2.5.8 Target Size at AA and the audit gates
on `wcag22aa`, so a 16px question mark would fail the suite — correctly.

### No JavaScript, and why that is not just tidiness

`/help` is 186 B of client bundle. Nothing here is a client component.

That is worth more than the kilobytes. On 2026-08-09 a tap on the attendance roll that landed
before React hydrated did **nothing, silently** — the trace showed the click with no request
behind it, and it cost a long diagnosis (see [[offline-outbox]]). A help control that is inert
for the first moment of a page is broken precisely when somebody unfamiliar is poking at the
screen, which is the whole population it exists for.

A panel in flow rather than an overlay, for the related reason: an absolutely positioned popup
covers what is underneath and then has to be dismissed, and on a tablet at the door that is a
trap.

### The third field is the point

Every entry has `what`, `how`, and `limit` — what it will not tell you. `limit` is copied from
the behaviour it describes rather than composed:

| Screen | What it will not tell you |
|---|---|
| Attendance, Roster | The ratio figures have not been checked against the regulations by anybody |
| Funding | Nothing is submitted to the Ministry; a person still enters the figures |
| Accounts | Balances come from payments recorded, not from an invoice's status |
| Compliance | A record nobody entered cannot expire; the binder does not claim compliance |
| Sleep checks | With no interval stated it passes no judgement on whether a gap was too long |
| Emergency broadcast | It does not yet send a push notification, an email or a text |

A manager who believes the ratio block has confirmed they are legally covered is worse off than
one who never opened the screen. Documentation that dropped those sentences while summarising
would be the one place a reader is told the comfortable version — so the caveat travels with
the description rather than living only on the screen.

### One array, because two copies diverge invisibly

The same sentences appear beside a heading and on `/help`. Written twice they would drift, and
nothing renders them side by side, so the first person to notice would be a user reading two
different answers to one question.

This repo has been here. The design tokens were a hand-maintained copy in two files that had
**already** diverged before `tokens:check` existed — the background colour and the muted grey
differed, and the tests asserted one set while the screens rendered the other. One source and a
check was the fix, and it is the same fix here.

### The list is checked against the navigation, not against another list

`TABS` is a hand-maintained list that must be edited whenever an unrelated file grows a route —
the exact defect shape [[conventions]] collects under *"the same shape, four times in one day"*.
It would fail the same way: add a `<NavLink>`, forget the entry, and `/help` omits the screen
while `TabHelp` renders nothing. No error. The page goes on looking complete, which is worse
than looking broken.

So `helpCoverage.test.ts` parses `layout.tsx` — the file where a route actually becomes
reachable — and asserts both directions: every nav route has an entry, and no entry describes a
route that is not in the nav. Same technique as `bounded-queries.test.ts` scanning source and
the audit-trigger assertion reading `pg_class`.

**Mutation-tested.** Removing the `/settings` entry fails *"has an entry for every screen in the
navigation"* and prints the route. A first assertion checks the regex finds more than ten links,
because if `layout.tsx` were restructured and the parse returned nothing, every other assertion
in the file would pass vacuously — which is the failure this file exists to prevent.

Stated rather than implied: it is a regex over JSX, not a parse. A route added by some other
mechanism will not be seen. It catches the ordinary case, which is somebody typing one more
`<NavLink>` beside twenty others.

### Buttons that were left alone, and why

The brief included question marks beside buttons. Three of the most consequential turned out
not to want one:

- **`BroadcastForm`'s Send** already says, in visible copy above a required tick, that today
  this means an entry on a Notifications page and *"does not yet send a push notification or an
  email"*.
- **The sleep register's Record a check** opens a form whose `<legend>` asks *"Did you observe
  them breathing?"*.
- **`PageActions`** already has a `hint` prop that exists for exactly this.

In each case the explanation is always visible. Putting it behind a `?` would have moved
information from "read this" to "open this if curious" — a downgrade dressed as a feature. The
section headings of the child record were the real gap and got the eight notes instead.

### What has not been done

- **No parent-facing walkthrough.** `/help` is reachable by a parent and filters to the four
  screens they have, which is honest but thin — it documents the product rather than answering
  "how do I tell the centre my child is sick".
- **English only.** The product uses te reo Māori terms (*whānau*, *pānui*, *tamariki*) and the
  help text explains in English around them. A translated help surface is a different piece of
  work.
- **Not audited for reading level.** The sentences are plain but nobody has measured them.

## See Also

- [[design-system]] — the tokens these styles come from, and the divergence that motivated one
  source
- [[conventions]] — the hand-maintained-list defect this page's test is built against
- [[offline-outbox]] — the hydration failure that argued for no JavaScript
- [[unverified-claims]] — the caveats the `limit` field repeats

## The `?` moved into `PageHeader`, 2026-08-11

Every screen used to write its own `<div className="has-help"><h1>…</h1><TabHelp href="…" /></div>`.
`PageHeader` owns that now and takes a `helpHref` — see [[console-handover]].

**`helpHref` is not a link, and it must never become one.** The name comes from the design
handover's prop list and its mockup draws a `?` beside the title, which reads exactly like an
anchor to `/help`. It is the route key `TabHelp` looks a doc up by, and what renders is the
`<details>` disclosure this page argues for: server-rendered, no JavaScript, operable before
React hydrates.

Turning it into an anchor would undo everything above and break the audit that clicks
`summary.help-mark` and expects `.help-body` — so the trap is named in `PageHeader`'s own
docblock as well as here, because the prop name invites the mistake and the person making it
will be reading the component rather than this page.

*Last updated: 2026-08-11 (the `?` is a `PageHeader` prop now)*
