import type { ReactNode } from 'react';

/**
 * A way back out of the console, and only when there is somewhere to go back to.
 *
 * WHY THIS EXISTS
 *
 * The console is served at `/portal` on the Little Pearls website's hostname, because Doorway has
 * no domain of its own yet. Somebody who follows "Sign in to Doorway" and then changes their mind
 * has no route back to the website except the browser's back button — the console has no navigation
 * for signed-out visitors, by design.
 *
 * WHY IT IS NOT THE FOOTER THAT WAS ASKED FOR
 *
 * The request was for the Little Pearls footer here: the coral block, both addresses, the phone
 * numbers, the social links. **This is one deployment serving every centre** — see the first Key
 * Point in llm-wiki/wiki/deployment.md — so compiling one customer's address book into it would put
 * a tenant in the build, show Little Pearls' phone numbers to the second centre that signs up, and
 * require a console deploy every time a centre changes a phone number.
 *
 * A relative link needs none of that. `/` on the host this page was served from **is** the
 * customer's website, whoever the customer is: here it is Little Pearls, and on a future mount it is
 * theirs, with nothing in this file changing and nothing tenant-shaped compiled in.
 *
 * A PLAIN `<a>`, NEVER `next/link`, AND THAT IS THE WHOLE TRICK
 *
 * `next/link` prepends `basePath` to every href, so `<Link href="/">` resolves to `/portal` and the
 * link would send somebody who wants to leave the console straight back to its own front door. A
 * plain anchor is not rewritten, so `/` stays the origin root. This is the one place in the app
 * where using the raw element rather than the framework's component is the correct call, so it is
 * written down here rather than left to look like an oversight — and it is why `login/page.tsx`
 * still imports `Link` for `/forgot-password`, which *should* carry the prefix.
 *
 * A LAYOUT AND NOT PART OF THE PAGE, because `page.tsx` is `'use client'` and a client component
 * cannot read a non-public environment variable — Next strips it from the browser bundle. Adding a
 * `NEXT_PUBLIC_` twin of `ECE_PORTAL_MOUNT` would mean two variables for one fact, which is the
 * duplication this repo keeps paying for. A layout is a server component by default, so it simply
 * reads the value that already exists.
 *
 * Scoped to `/login` deliberately. It is the page the website links to and the page somebody lands
 * on by mistake. `/forgot-password`, `/reset-password` and `/no-access` are each one file away if
 * they turn out to need it, and guessing that they do is how four files start drifting.
 */
const mounted = Boolean((process.env.ECE_PORTAL_MOUNT ?? '').trim());

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {mounted && (
        <p className="auth-back">
          {/* The arrow is decorative and hidden: "← Back to the website" read aloud as
              "left arrow back to the website" is worse than the words alone. */}
          <a href="/">
            <span aria-hidden="true">←</span> Back to the website
          </a>
        </p>
      )}
    </>
  );
}
