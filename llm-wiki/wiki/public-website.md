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
  horizontal overflow.** Their predecessor fails on every page at every width.
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
