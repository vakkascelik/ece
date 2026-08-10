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

*Last updated: 2026-08-10 (step 1 of 10)*
