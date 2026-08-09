'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { changePassword, type ChangePasswordResult } from './actions';

/** The Client Component half of the i18n proof of concept — see page.tsx for the Server
    Component half. `useTranslations()`, not `getTranslations()`: the async server-side
    call cannot run inside a component that ships to the browser. */
export function ChangePasswordForm() {
  const t = useTranslations('ChangePasswordForm');
  const [state, action, busy] = useActionState(changePassword, null as ChangePasswordResult);

  return (
    <form action={action} className="card">
      <div style={{ marginBottom: '0.9rem' }}>
        <label htmlFor="current">{t('currentLabel')}</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div style={{ marginBottom: '0.9rem' }}>
        <label htmlFor="password">{t('newLabel')}</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <div style={{ marginBottom: '1.1rem' }}>
        <label htmlFor="confirm">{t('confirmLabel')}</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>

      {state?.error && <p className="error" style={{ marginTop: 0 }} role="alert">{state.error}</p>}
      {state?.ok && (
        <p className="sub" style={{ marginTop: 0 }} role="status">
          {t('success')}
        </p>
      )}

      <button type="submit" disabled={busy}>{busy ? t('submitting') : t('submit')}</button>
    </form>
  );
}
