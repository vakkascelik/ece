import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

/**
 * The only place in this product that needs the next-intl **client** runtime.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `NextIntlClientProvider` is a client component, and it was in the root layout — so
 * `use-intl` plus the entire `@formatjs` ICU MessageFormat parser was in the first-load
 * bundle of every route, `/login` included. **11.7kB gzip on every page**, and the whole
 * of `check:bundle`'s 7.0kB failure, which had stood red and unattributed since
 * 2026-08-14.
 *
 * Exactly two components call `useTranslations`, `ChangePasswordForm` and
 * `LocaleSwitcher`, and both are in this directory. A route-group layout is the
 * narrowest scope that serves them: the parser is now in `/account`'s own chunk, paid
 * for by the one screen that uses it.
 *
 * `getMessages()` is called here rather than in the root for the same reason. It
 * serialises the whole message catalogue into the HTML, and doing that in the root
 * layout put every string on every page — a payload cost the bundle budget does not
 * even measure.
 *
 * WHAT TO DO WHEN THE INTERFACE IS ACTUALLY TRANSLATED
 *
 * Not "move this back to the root". When a second area of the product needs
 * translations, give that area its own provider, or lift this one to `(app)/layout.tsx`
 * so signed-in routes pay for it and the login page still does not. Lifting it all the
 * way to the root means every unauthenticated visitor downloads an ICU pluralisation
 * parser before they can type a password, and `first-load-js` will say so —
 * `check:bundle` is the thing that will notice, which is the point of having it.
 *
 * See llm-wiki/wiki/i18n.md, which records that this layer is infrastructure only and
 * that `messages/mi.json` holds no real te reo Māori.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
