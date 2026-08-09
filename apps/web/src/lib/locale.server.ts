import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, type Locale } from './locale';

/**
 * The cookie-reading half of `locale.ts` — split out because it imports `next/headers`
 * and the pure constants are also needed from a Client Component. See `locale.ts`'s
 * header for why the split exists at all.
 *
 * A cookie, the same pattern `CENTRE_COOKIE` already uses for which centre is active
 * (`@/lib/auth`) — not next-intl's own `[locale]` URL-routing mode, which needs its own
 * middleware. This app's `middleware.ts` already does one security-critical job, minting
 * the CSP nonce every route depends on, and composing a second middleware alongside it is
 * a real way to break that silently.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const requested = store.get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(requested ?? '')
    ? (requested as Locale)
    : DEFAULT_LOCALE;
}
