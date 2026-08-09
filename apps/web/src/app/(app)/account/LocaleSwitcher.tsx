'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/locale';
import { setLocale } from './actions';

/**
 * The infrastructure proof of concept, not a real language option yet.
 *
 * Selecting "Te reo Māori" here shows `[mi]`-prefixed placeholder strings, not a
 * translation — see llm-wiki/wiki/i18n.md. Shipping this switcher without that prefix
 * would present placeholder text as though it were real te reo, which is a worse failure
 * than not having the feature at all.
 */
export function LocaleSwitcher({ current }: { current: Locale }) {
  const t = useTranslations('LocaleSwitcher');
  const router = useRouter();

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <label htmlFor="locale">{t('label')}</label>
      <select
        id="locale"
        defaultValue={current}
        onChange={async (e) => {
          await setLocale(e.target.value);
          router.refresh();
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
