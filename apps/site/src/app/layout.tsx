import type { Metadata, Viewport } from 'next';
import { Literata } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CENTRES, CENTRE_FACTS, SOCIAL_LINKS } from '@/lib/centres';
import { PHOTOS } from '@/lib/photos';
import { siteOrigin } from '@/lib/site';
import { ART } from '@/lib/art';
import { Parallax } from './Parallax';
import { SiteNav } from './SiteNav';
import { SocialIcon } from './SocialIcon';
import { Pearl } from './Pearl';
import { Waves } from './Waves';
import './globals.css';

/**
 * The one typeface, self-hosted.
 *
 * WHY A TYPEFACE AT ALL, having deliberately not had one
 *
 * The site shipped on the system stack, and the reasoning still holds for what it was about: a
 * webfont from a CDN is a third-party request on a page read by parents, and `font-src` here is
 * `'self' data:` precisely to forbid that. What the reasoning got wrong is that it treated "no
 * webfont" and "no third-party request" as the same decision. They are not. `next/font` downloads
 * the files at build time and serves them from this origin, so the CSP is untouched and no
 * request leaves the container.
 *
 * The cost of not having one was the whole character of the site. A centre whose rooms are timber,
 * woven baskets and daylight had a website set in Segoe UI.
 *
 * WHY LITERATA, AND WHY NOT FRAUNCES — a real defect, caught by looking
 *
 * The first choice was Fraunces, for a good reason: it has a `SOFT` axis that rounds the terminals,
 * which is the move their logo already makes. It was set, it built, it looked warm, and it was
 * wrong.
 *
 * **Fraunces misplaces every macron.** Rendered at 56px and inspected, it puts the bar to the right
 * of the vowel it belongs to: `Whānau` came out as `Whaῆau` with the macron over the n, and — the
 * one that settles it — `Māori` came out as `Maōri`, which is a different word. Seven faces were
 * rendered side by side against the system stack to confirm it was Fraunces and not the pipeline:
 * Literata, Newsreader, Source Serif 4, Lora and Bitter are all correct; Petrona floats the `Ō` bar
 * high; only Fraunces shifts them.
 *
 * That is the worst shape a bug can have. It does not fall back to a visibly different font, it
 * does not throw, and it does not fail a build — it renders a plausible word that is the wrong
 * word, on a site whose stated values include a commitment to te reo Māori. It would have shipped.
 *
 * Literata was designed for long-form reading, is warm without being cute, and places its marks
 * where they belong. Headings only; body copy stays on the system stack, so there is one file to
 * download and the text a parent is actually reading paints instantly.
 *
 * `latin-ext` IS NOT OPTIONAL — every macron here lives in Latin Extended-A, and without the subset
 * the browser silently substitutes another face for exactly those characters. `display: 'swap'` so
 * text is readable while the font loads rather than invisible.
 */
const display = Literata({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-display',
});

/*
 * EVERY ROUTE ON THIS SITE IS DYNAMIC, AND IT IS A SECURITY FIX.
 *
 * Set on the root layout so it covers all ten routes at once, because the failure it fixes was
 * total rather than per-page.
 *
 * These pages were statically prerendered, and a prerendered page CANNOT carry a nonce: the
 * nonce is minted per request in `middleware.ts` and read back by the renderer, so with no
 * render there is nothing to stamp it onto. Measured from the build output, not inferred —
 * `careers.html` had 16 script tags and zero `nonce=` attributes.
 *
 * And it failed closed rather than open. `script-src` is `'self' 'nonce-...' 'strict-dynamic'`,
 * and CSP Level 3 requires a browser seeing `'strict-dynamic'` to **ignore** `'self'`. So every
 * script on every page was refused in production: the client router never started, so each
 * navigation was a full page load, and anyone who opened devtools on this childcare service's
 * own marketing site saw a wall of security errors. The careers form still delivered, because
 * React's progressive-enhancement markup survives in static HTML — which is exactly why nothing
 * caught it.
 *
 * WHY NOT KEEP STATIC AND WEAKEN THE POLICY instead — drop the nonce, allow `'unsafe-inline'`,
 * which is what most static Next sites do? Because the cost of dynamic rendering here is close
 * to zero and the benefit of the policy is not. There is no CDN in front of this: Railway serves
 * from the container, so "static" was only ever saving a React render of a page with no data
 * fetching, on a site with tiny traffic. It also keeps ONE CSP shape across this app and
 * `apps/web` rather than two that drift.
 *
 * `robots.ts` and `sitemap.ts` sit outside this layout and stay static. They contain no scripts,
 * so the nonce is irrelevant to them.
 */
export const dynamic = 'force-dynamic';

/**
 * THE VIEWPORT TAG IS THE SINGLE MOST IMPORTANT LINE IN THIS APP.
 *
 * Their current site has no `<meta name="viewport">` on any page, and no width-based media query
 * anywhere — Adobe Muse tagged every region `BP_infinity`, its single desktop breakpoint. A phone
 * renders that at ~980px and zooms out, which for an audience of parents looking up a childcare
 * centre on a phone is disqualifying on its own.
 *
 * `maximumScale` is deliberately absent. Capping zoom is a WCAG 1.4.4 failure and the people it
 * hurts are exactly the ones reading a fee or an address they need to be sure about.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const DESCRIPTION =
  'Little Pearls Educare Centre — not-for-profit, community established early learning in ' +
  'Ōwairaka / Mt Albert and Puketāpapa / Mt Roskill, Auckland. Children 3 months to 5 years, ' +
  'weekdays 7.30am to 6.00pm.';

/**
 * Metadata their site has none of: no description, no Open Graph, and a homepage `<title>` that
 * is literally the word "About" — no brand, no location. A parent searching "childcare Mt Albert"
 * sees that string.
 *
 * `metadataBase` comes from the environment because it differs between the Railway generated
 * domain and the real one, and a wrong absolute URL in an OG tag is worse than none.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  /*
    No `robots` field. Keeping the preview out of search results is a per-request decision about the
    host being served, so it is an `X-Robots-Tag` header in middleware. A build-time flag here could
    only guess, and did — see the note in middleware.ts.
  */
  title: {
    default: 'Little Pearls Educare Centre — early learning in Mt Albert and Mt Roskill',
    template: '%s | Little Pearls Educare Centre',
  },
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    locale: 'en_NZ',
    siteName: 'Little Pearls Educare Centre',
    title: 'Little Pearls Educare Centre',
    description: DESCRIPTION,
    /*
     * The entrance, and the choice of photograph is the point.
     *
     * This used to read "no Twitter card image until there is a photograph cleared for public use",
     * which was the right rule and is no longer a reason to have none: seven of the eleven
     * photographs on their old site show only the premises, and a picture of a building engages
     * nobody's consent.
     *
     * The centre confirmed the consents for the rest on 2026-08-07, so three of the four showing
     * children are now on the site too. The entrance stays as the share image regardless — a link
     * preview is seen by people who have not chosen to look, and a building is the right thing to
     * put in front of them. See `lib/photos.ts`.
     *
     * A shared link previews as the front door somebody would actually walk up to, which is more use
     * to a parent than a logo on a white square.
     */
    images: [
      {
        url: PHOTOS.entrance.src,
        width: 720,
        height: 720,
        alt: PHOTOS.entrance.alt,
      },
    ],
  },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ" className={display.variable}>
      <body>
        {/* WCAG 2.4.1 — the nav repeats on every page and is otherwise seven tab stops between a
            keyboard user and the content. */}
        <a className="skip" href="#main">
          Skip to content
        </a>

        {/*
          THE MENU BUTTON IS JAVASCRIPT, SO THIS IS THE VERSION WITHOUT IT: the row is forced open
          and the button is hidden, which is the layout the site had before the button existed.

          `style-src` on this site is `'self' 'unsafe-inline'` — Next inlines critical CSS as a
          `<style>` with no nonce plumbing — so an inline rule here costs the policy nothing.

          This covers scripting being switched OFF. It does not cover the bundle failing to run,
          because a browser considers scripting enabled right up until the script errors, and
          `<noscript>` never applies. That case is covered by the footer's copy of the same links —
          see the note on `.foot-nav` in globals.css. Two failures, two fallbacks, deliberately.
        */}
        {/*
          The third rule pins the shell to its own full row: with scripting off the toggle is gone,
          and the shell would otherwise keep its mobile size-to-the-button flex basis and squeeze
          seven links into a 44px column.
        */}
        <noscript>
          <style>
            {'.nav{display:flex !important}.nav-toggle{display:none !important}.nav-shell{flex:1 1 100% !important}'}
          </style>
        </noscript>

        <header className="masthead">
          <div className="wrap masthead-inner">
            <a className="brand" href="/">
              {/*
                Their own logo, off their own site. `alt=""` on purpose, and it is the one empty alt
                on this site: the words immediately beside it already say "Little Pearls Educare
                Centre", so a screen reader that also announced the image would read the name twice.
                An alt of "Little Pearls logo" is the classic version of that mistake.

                Explicit `width`/`height` so the header does not jump once the image arrives, and no
                `loading="lazy"` because it is the first thing on the page — lazy-loading something
                above the fold delays it for no benefit.
              */}
              <img className="brand-logo" src="/logo.png" alt="" width={316} height={303} />
              <span>
                <span className="brand-name">Little Pearls Educare Centre</span>
                <br />
                <span className="brand-tag">{CENTRE_FACTS.tagline}</span>
              </span>
            </a>
            {/*
              THERE IS NO SIGN-IN LINK IN THIS MASTHEAD ANY MORE, and the app is not mentioned
              anywhere on this site.

              The history is worth one paragraph because it went in three steps and each was a
              deliberate call by the owner. It began as a line of body text in the footer; it was
              promoted to a masthead button on the argument that it is the most-*frequent* link on
              the site — every other link here is for somebody deciding whether to enrol, a decision
              made once, and this one is for the families and kaiako who come back to it daily. Then
              the product name came off it, because the name is not trade-mark cleared and
              `doorway.nz` belongs to somebody else. Now the control itself is gone, on the
              instruction that the site should not refer to the app at all yet.

              WHAT IS NOT GONE IS THE WAY IN. `/portal` is still mounted on this hostname by
              `middleware.ts`, `SITE_APP_URL` still resolves, and `appUrl()` still works — see the
              note on it in `lib/site.ts`. Nothing was demolished; a link was taken off a page, and
              putting it back is one element.
            */}
            <SiteNav />
          </div>
        </header>

        {/*
          NO `.wrap` HERE ANY MORE. `<main>` is full-bleed and each page carries its own container,
          because an ocean band has to reach the window edges and the two ways of faking that from
          inside a centred column are both worse — see the `.main` note in globals.css, which
          records why `calc(50% - 50vw)` is banned in this file and why moving the band outside
          `<main>` would put every page's `<h1>` outside the main landmark.
        */}
        <main className="main" id="main">
          {children}
        </main>

        {/*
          THREE COLUMNS, restored on the owner's call after a pass had collapsed it to one line per
          centre. Their preference, and it is theirs to have.

          What is NOT restored is the `<h2>` on each column, and that part is not a style choice.
          Each centre's name was an `<h2>` here and an `<h2>` in the contact card on `/contact`, so a
          screen reader working that page's heading list met "Ōwairaka / Mt Albert" twice with
          different content under each — a heading outline that lists the same name twice at the same
          level is one somebody cannot navigate by. These are `<p class="foot-head">` now: visually
          identical, and correct, because a footer column label is a label and not a section of the
          document. `<footer>` is already the `contentinfo` landmark.

          The cost that came back with the columns is real and is worth naming: `/contact` carries
          both addresses in its body, so the page now states each of them twice. That is a repetition
          a reader can ignore, where two identical headings is one a screen-reader user cannot.
        */}
        <footer className="foot">
          {/*
            The waterline, mirrored — these paths fill upward, so the page appears to end *in* the
            sea rather than at a border. Two layers here against the hero's three: the footer band
            is shallower and a third would put foam through the invitation below it.
          */}
          <Waves variant="footer" />

          {/*
            THE INVITATION, and it is the one piece of the design that is a marketing decision
            rather than a visual one.

            Everything above it on any given page is describing the centre. This is the last thing
            on every page, it asks for the one action the site exists to produce, and it says the
            thing that actually lowers the barrier — that nobody has to send anything about their
            child to start a conversation. That sentence is lifted from `/enrolment`, where it was
            already doing the same job for the form.
          */}
          <div className="foot__cta">
            <div className="wrap foot__cta-grid">
              <div>
                <h2>Come and meet the people who will know your child</h2>
                <p>
                  Tell us a little and we will arrange a visit at whichever centre suits you. You do
                  not need to send us anything about your child yet.
                </p>
                <p style={{ margin: 0 }}>
                  <Link className="btn btn-invert" href="/enrolment">
                    Enquire about a place
                  </Link>
                </p>
              </div>
              {/*
                Three pearls holding generated nacre artwork — not photographs, and deliberately
                not: see `lib/art.ts` for the provenance and the boundary. These were empty, and
                the reasoning that kept them empty still holds for what it was about: a
                photograph at 56px is a child's face reduced to texture. Abstract texture *is*
                texture, so it may live here, and it makes the pearls read as nacre rather than
                as blank spheres. `aria-hidden` as before — they carry nothing a reader needs.
              */}
              <div className="pearl-cluster" data-parallax="cluster" aria-hidden="true">
                <Pearl size={74} photo={ART.shell} />
                <Pearl size={124} photo={ART.ocean} />
                <Pearl size={56} photo={ART.mist} />
              </div>
            </div>
          </div>

          <div className="foot__detail">
          <div className="wrap">
            <div className="foot-grid">
              {CENTRES.map((centre) => (
                <div key={centre.path}>
                  <p className="foot-head">{centre.name}</p>
                  <p>
                    {centre.street}
                    <br />
                    {centre.suburb} {centre.postcode}
                  </p>
                  <p>
                    <a href={`tel:${centre.phoneHref}`}>{centre.phone}</a>
                  </p>
                  <p>
                    <a href={`mailto:${centre.email}`}>{centre.email}</a>
                  </p>
                </div>
              ))}
              <div>
                <p className="foot-head">Hours</p>
                <p>{CENTRE_FACTS.hours}</p>
                <p>Children {CENTRE_FACTS.ages}</p>
                {/*
                  The "For families and kaiako" sign-in link is gone from here too — the app is not
                  referred to anywhere on this site. See the note in the masthead above for the
                  three steps that got here and for what is still mounted underneath.
                */}
              </div>

            </div>

            {/*
              THE BOTTOM LINE: the social accounts as icons, and the developer credit, on one row.

              THE "PAGES" COLUMN THAT WAS HERE IS GONE, asked for to shorten the footer, and the cost
              is worth writing down because it was added one commit ago for a reason. It was the
              fallback for the masthead nav being JavaScript-driven below 48rem: `<noscript>` covers
              scripting being switched off, and that column covered the bundle failing to *run*,
              which `<noscript>` cannot.

              What still stands between a phone visitor and a dead end if the bundle fails: the
              `<noscript>` rule, which handles the commoner case; the desktop nav, which is pure CSS
              and unaffected; and the body copy, which links out of every page — the homepage alone
              reaches philosophy, centres, rooms, enrolment and contact. So the residual gap is
              narrow: a phone, with scripting enabled, whose script then errors. Narrow is not
              nothing, and if it ever matters the cheapest fix is a single wrapped row of links here
              rather than the seven-high column that made the footer long.
            */}
            <div className="foot-bottom">
              {/*
                `<ul>` and not four `<a>`s: it is a list of four equivalent things, and a screen
                reader announcing "list, 4 items" is the difference between hearing the shape and
                hearing four links in a row. The bullets and indent come off in CSS.

                EACH LINK CARRIES ITS OWN NAME IN TEXT, visually hidden. An icon has no accessible
                name — `aria-label` on the link would work, but a hidden `<span>` also survives a
                translation tool and a stylesheet that fails to load, and this site has been bitten
                by "it only works when everything works" twice this week.

                No `target="_blank"`. Opening in a new tab is a decision made for the reader about
                their own browser, and WCAG 3.2.5 treats an unrequested new window as a change of
                context; anybody who wants one has a middle-click. `rel="noreferrer"` would be
                redundant against this site's `strict-origin-when-cross-origin` policy, which
                already sends the origin and nothing more.
              */}
              <ul className="foot-social">
                {SOCIAL_LINKS.map((social) => (
                  <li key={social.name}>
                    <a href={social.href}>
                      <SocialIcon name={social.name} />
                      <span className="visually-hidden">{social.name}</span>
                    </a>
                  </li>
                ))}
              </ul>

              {/*
                The developer credit, now sharing the row rather than sitting under a rule of its own.

                A file in `public/` rather than an inlined `<svg>`. This is a drawn mark belonging to
                someone else, whose own guidelines say it may not be recoloured — keeping it as the
                byte-identical asset makes that hard to violate by accident, where an inlined path is
                one `fill` away from it. `img-src` is `'self' data:`, so a committed file is also the
                only shape the policy allows. That is the opposite call from the social glyphs beside
                it, and deliberately: those are drawn here from primitives and tinted with
                `currentColor`, which is exactly what this one may not be.

                It is their `favicon.svg` — the solid tile — and not `salix-mark-green.svg`, which is
                their default. See the note in globals.css: the default is a line drawing that
                disappears at this size.

                `alt=""` for the same reason as the logo in the masthead: the words in the link
                already say Salix, so a screen reader announcing the image too would say it twice.
              */}
              <p className="foot-credit">
                <a href="https://www.salixtech.co.nz">
                  <img className="salix-mark" src="/salix-mark.svg" alt="" width={512} height={512} />
                  Developed by Salix
                </a>
              </p>
            </div>

          </div>
          </div>
        </footer>

        {/*
          The scroll parallax, last in the body and rendering nothing — it attaches one listener to
          elements the server components above already marked `data-parallax`. Under
          `prefers-reduced-motion: reduce` it attaches nothing at all.

          One of the two client components in this app, with `SiteNav`. The rule that kept it to one
          for a long time still holds and is why there are still only two: a marketing site that
          ships React to do nothing is a slower marketing site. Both of these do something, and
          `SiteNav` is built so that it keeps working when this one does not — see the note there.
        */}
        <Parallax />
      </body>
    </html>
  );
}
