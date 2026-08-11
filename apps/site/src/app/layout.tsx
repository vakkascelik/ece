import type { Metadata, Viewport } from 'next';
import { Literata } from 'next/font/google';
import type { ReactNode } from 'react';
import { MARK, PRODUCT_NAME } from '@ece/core';
import { CENTRES, CENTRE_FACTS, SOCIAL_LINKS } from '@/lib/centres';
import { PHOTOS } from '@/lib/photos';
import { appUrl, siteOrigin } from '@/lib/site';
import { NavLink } from './NavLink';
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

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/philosophy', label: 'Our philosophy' },
  { href: '/centres', label: 'Our centres' },
  { href: '/rooms', label: 'Rooms' },
  { href: '/enrolment', label: 'Enrolment' },
  { href: '/careers', label: 'Careers' },
  { href: '/contact', label: 'Contact' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ" className={display.variable}>
      <body>
        {/* WCAG 2.4.1 — the nav repeats on every page and is otherwise seven tab stops between a
            keyboard user and the content. */}
        <a className="skip" href="#main">
          Skip to content
        </a>

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
              The link out to the platform, promoted from a line of footer body text.

              Beside the brand and BEFORE the nav in source order, so the first row of the masthead
              is "who this is" and "the way in" — the two things a family or a kaiako already at the
              centre opens this site for. The nav takes the row below it at every width.

              Outside the `<nav>` on purpose: it leaves this site. A main navigation whose last item
              is a different application is a navigation that lies to anybody working it with a
              screen reader or a keyboard.

              The mark is inlined rather than fetched — one fewer request for three shapes, and
              `img-src` would otherwise be carrying a file that exists only for this. `aria-hidden`
              because the words beside it already say Doorway; `focusable="false"` because SVG
              otherwise picks up a tab stop in some engines.
            */}
            <a className="signin" href={appUrl()}>
              <svg
                className="doorway-mark"
                viewBox={`0 0 ${MARK.size} ${MARK.size}`}
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                focusable="false"
              >
                {/* Read from `@ece/core`, not typed here. This mark is also drawn in the
                    console's rail and generated into its favicon, and a logo maintained in
                    three files is a logo that ends up in three slightly different shapes —
                    the failure `tokens.ts` exists to prevent, applied to identity. */}
                <rect width={MARK.size} height={MARK.size} rx={MARK.box.radius} fill={MARK.box.fill} />
                <circle cx={MARK.head.cx} cy={MARK.head.cy} r={MARK.head.r} fill={MARK.head.fill} />
                <rect
                  x={MARK.shoulders.x}
                  y={MARK.shoulders.y}
                  width={MARK.shoulders.width}
                  height={MARK.shoulders.height}
                  rx={MARK.shoulders.radius}
                  fill={MARK.shoulders.fill}
                />
              </svg>
              Sign in to {PRODUCT_NAME}
            </a>

            <nav className="nav" aria-label="Main">
              {NAV.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="main" id="main">
          <div className="wrap">{children}</div>
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
                  Back in the footer as well as the masthead. Deliberate duplication: the masthead
                  link is the one that gets used, and somebody who has scrolled to the bottom
                  looking for it should not have to scroll back up.
                */}
                <p className="foot-head foot-head-spaced">For families and kaiako</p>
                <p>
                  <a href={appUrl()}>Sign in to {PRODUCT_NAME}</a>
                </p>
              </div>
              {/*
                Their social accounts, which the current site has and this one did not.

                A fourth grid column rather than a row of icons under the credit. `.foot-grid` is
                `auto-fit, minmax(16rem, 1fr)`, so a fourth item costs nothing and reflows to two-up
                and then one-up on its own — no media query, and no fixed column count to get wrong
                when a fifth thing arrives.

                `<ul>` and not four `<p>`s: it is a list of four equivalent things, and a screen
                reader announcing "list, 4 items" is the difference between hearing the shape and
                hearing four sentences. The bullets and indent come off in CSS.

                No `target="_blank"`. Opening in a new tab is a decision made for the reader about
                their own browser, and WCAG 3.2.5 treats an unrequested new window as a change of
                context; anybody who wants one has a middle-click. `rel="noreferrer"` would be
                redundant against this site's `strict-origin-when-cross-origin` policy, which
                already sends the origin and nothing more — so it is left off rather than added as
                cargo, and the policy is the single place that decision lives.
              */}
              <div>
                <p className="foot-head">Follow us</p>
                <ul className="foot-social">
                  {SOCIAL_LINKS.map((social) => (
                    <li key={social.name}>
                      <a href={social.href}>{social.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/*
              The developer credit.

              A file in `public/` rather than an inlined `<svg>`, which is the opposite of the call
              made for the Doorway mark two elements up, and deliberately. Doorway's is three
              primitives copied out of the handoff; this is a drawn mark belonging to someone else,
              whose own guidelines say it may not be recoloured — keeping it as the byte-identical
              asset makes that hard to violate by accident, where an inlined path is one `fill`
              away from it. `img-src` is `'self' data:`, so a committed file is also the only
              shape the policy allows.

              It is their `favicon.svg` — the solid tile — and not `salix-mark-green.svg`, which is
              their default. See the note in globals.css: the default is a line drawing that
              disappears at this size.

              `alt=""`, the second empty alt on this site and for the same reason as the first: the
              words in the link already say Salix, so a screen reader announcing the image too
              would say it twice.

              No `target="_blank"`. Deciding for somebody that they wanted a new window is not a
              courtesy, and a credit line is the least urgent link on the page.
            */}
            <p className="foot-credit">
              <a href="https://www.salixtech.co.nz">
                <img
                  className="salix-mark"
                  src="/salix-mark.svg"
                  alt=""
                  width={512}
                  height={512}
                />
                Developed by Salix
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
