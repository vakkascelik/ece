/**
 * Which languages exist, and the cookie that picks one — infrastructure for the te reo
 * Māori interface roadmap item, not the translated content itself. See
 * llm-wiki/wiki/i18n.md for the scope this was deliberately cut down to.
 *
 * Pure constants only. `getLocale()`, which reads the cookie, lives in `locale.server.ts`
 * instead of here: it imports `next/headers`, and a Client Component (`LocaleSwitcher.tsx`)
 * needs `LOCALES`/`LOCALE_LABELS` from this file — Next refuses to bundle ANY import from a
 * file that transitively pulls in a server-only API into client code, even an export the
 * client never touches. Found by the build failing, not by reasoning about it first.
 */

export const LOCALE_COOKIE = 'ece_locale';

export const LOCALES = ['en', 'mi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  mi: 'Te reo Māori (placeholder text only — see i18n.md)',
};
