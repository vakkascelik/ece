import { getRequestConfig } from 'next-intl/server';
import { getLocale } from '@/lib/locale.server';

/**
 * next-intl's request config, resolving the locale from a cookie rather than a URL
 * segment — see `@/lib/locale` for why. `messages/<locale>.json` is loaded per request,
 * which is what lets a fresh cookie value take effect on the very next render with no
 * server restart.
 */
export default getRequestConfig(async () => {
  const locale = await getLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
