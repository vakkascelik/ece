import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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

export const metadata: Metadata = {
  title: 'ECE Platform',
  description: 'Administration for New Zealand early learning services.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ">
      <body>{children}</body>
    </html>
  );
}
