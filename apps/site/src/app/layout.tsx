import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { CENTRES, CENTRE_FACTS } from '@/lib/centres';
import { appUrl, siteOrigin } from '@/lib/site';
import { NavLink } from './NavLink';
import './globals.css';

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
  },
  // No Twitter card image until there is a photograph cleared for public use. An OG tag pointing
  // at a missing file renders as a broken preview, which is worse than a text-only one.
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
    <html lang="en-NZ">
      <body>
        {/* WCAG 2.4.1 — the nav repeats on every page and is otherwise seven tab stops between a
            keyboard user and the content. */}
        <a className="skip" href="#main">
          Skip to content
        </a>

        <header className="masthead">
          <div className="wrap masthead-inner">
            <a className="brand" href="/">
              <span>
                <span className="brand-name">Little Pearls Educare Centre</span>
                <br />
                <span className="brand-tag">{CENTRE_FACTS.tagline}</span>
              </span>
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

        <footer className="foot">
          <div className="wrap">
            <div className="foot-grid">
              {CENTRES.map((centre) => (
                <div key={centre.path}>
                  <h2>{centre.name}</h2>
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
                <h2>Hours</h2>
                <p>{CENTRE_FACTS.hours}</p>
                <p>Children {CENTRE_FACTS.ages}</p>
                <h2 style={{ marginTop: 'var(--space-4)' }}>For families and kaiako</h2>
                {/*
                  The only link between this site and the platform, and deliberately the whole of
                  it for now. There is no sign-up: an account comes from the centre inviting
                  somebody, which the app says on arrival.
                */}
                <p>
                  <a href={appUrl()}>
                    Sign in to the centre app
                  </a>
                </p>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
