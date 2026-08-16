import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@ece/core';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';

/*
 * EVERY ROUTE IN THIS APP RENDERS PER REQUEST, AND THAT IS A SECURITY REQUIREMENT.
 *
 * Set here rather than per route because it has to be impossible to add a prerendered page to
 * this app by accident. Every route behind the session cookie was already dynamic; the three
 * that were not — `/login`, `/no-access` and the built-in `/_not-found` — were **silently
 * serving a page whose every script the browser refused.**
 *
 * The mechanism, because it is not obvious and it failed closed: `middleware.ts` mints a nonce
 * per request and `securityHeaders.ts` puts it in `script-src` alongside `'strict-dynamic'`. A
 * prerendered page has no render, so nothing stamps the nonce onto its script tags — measured,
 * not inferred: `login.html` in the build output had 16 script tags and zero `nonce=`
 * attributes. And CSP Level 3 requires a browser that sees `'strict-dynamic'` to **ignore**
 * `'self'`, so there was no fallback: every script was blocked on the first screen every user
 * meets. Sign-in still worked, because a React form degrades to a full-page POST — which is
 * exactly why the end-to-end suite stayed green. Its "no CSP violation" test visits
 * `/attendance`, which is dynamic and does get a nonce.
 *
 * WHY NOT WEAKEN THE POLICY instead — drop the nonce, allow `'unsafe-inline'`, which is what
 * most static Next deployments do? Because this app renders a named under-five's anaphylaxis
 * plan and their guardian's phone number. `'unsafe-inline'` is the single directive that makes
 * an injected script work, and the login screen is where a credential is typed. A server render
 * of a page nobody visits twice is not a price worth arguing about.
 *
 * Note that `export const dynamic` is NOT honoured in a client component, which is why this
 * cannot live in `login/page.tsx` — that file starts with `'use client'`, and putting it there
 * left the route prerendered while looking fixed.
 */
export const dynamic = 'force-dynamic';

/*
  The product is called Doorway. It said "ECE Platform" until 2026-08-11 — a working label from
  before the name existed, which meant the tab said one thing, the mobile app said "ECE", and
  the customer's public website said Doorway. Three names for one product, and the only one a
  person outside this repo had ever seen was the third.

  `title.template` so a screen names itself first and the product second: a manager with six
  tabs open is looking for the screen, not for which product it belongs to. The bare `default`
  is for routes that set no title of their own.

  The name is NOT trade-mark cleared, and the domain is not ours — this comment used to say
  `doorway.co.nz` was confirmed available on 2026-08-11; the registry says otherwise. See
  unverified-claims §19 before it goes on anything expensive to change.
*/
export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: 'Administration for New Zealand early learning services.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // `next-intl/server`'s own getLocale()/getMessages() — resolved through
  // `src/i18n/request.ts`, which is where the cookie is actually read (`@/lib/locale`).
  // This pair reads the config next-intl has already resolved for the request rather
  // than reading the cookie a second time.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale === 'mi' ? 'mi-NZ' : 'en-NZ'}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
