import { getTranslations } from 'next-intl/server';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { getLocale } from '@/lib/locale.server';
import { ChangePasswordForm } from './ChangePasswordForm';
import { LocaleSwitcher } from './LocaleSwitcher';
import { PageHeader } from '../PageHeader';

/**
 * The user's own account, as opposed to /settings which is the centre's and
 * gated on manageCentre. Every role gets this page — a parent's password guards
 * their child's records exactly as much as a manager's does.
 *
 * The first page in this app pulled from `messages/<locale>.json` instead of a literal
 * string — the i18n infrastructure proof of concept. `getTranslations()` is this file's
 * half of the pair; `ChangePasswordForm.tsx` (a Client Component) shows the other half,
 * `useTranslations()`. See llm-wiki/wiki/i18n.md for what this does and does not cover.
 */
export default async function AccountPage() {
  await requireCtx();
  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();
  const t = await getTranslations('Account');
  const locale = await getLocale();

  return (
    <>
      <PageHeader title={t('title')} subtitle={auth.user?.email} />

      <h2 style={{ fontSize: '1.05rem' }}>{t('changePasswordHeading')}</h2>
      <ChangePasswordForm />

      <LocaleSwitcher current={locale} />
    </>
  );
}
