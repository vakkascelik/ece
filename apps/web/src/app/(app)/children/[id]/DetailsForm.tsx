'use client';

import { useActionState } from 'react';
import { GENDERS, type Child } from '@ece/core';
import { saveChild, type Result } from '../actions';

export function DetailsForm({ child, readOnly }: { child: Child; readOnly: boolean }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(saveChild, null);
  const error = state && 'error' in state ? state.error : null;
  const saved = state && 'ok' in state;

  if (readOnly) {
    return (
      <div className="card">
        <dl className="facts">
          <dt>Name</dt>
          <dd>
            {child.firstName} {child.lastName}
          </dd>
          {child.preferredName && (
            <>
              <dt>Known as</dt>
              <dd>{child.preferredName}</dd>
            </>
          )}
          <dt>Date of birth</dt>
          <dd>{child.dateOfBirth}</dd>
          <dt>NSN</dt>
          <dd>{child.moeNsn ?? <span className="empty">Not recorded</span>}</dd>
          <dt>Ethnicities</dt>
          <dd>
            {child.ethnicities.length > 0 ? (
              child.ethnicities.join(', ')
            ) : (
              <span className="empty">Not recorded</span>
            )}
          </dd>
          <dt>Iwi</dt>
          <dd>{child.iwi ?? <span className="empty">Not recorded</span>}</dd>
          <dt>First language</dt>
          <dd>{child.firstLanguage ?? <span className="empty">Not recorded</span>}</dd>
        </dl>
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <input type="hidden" name="childId" value={child.id} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" defaultValue={child.firstName} required />
          </div>
          <div>
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" defaultValue={child.lastName} required />
          </div>
          <div>
            <label htmlFor="preferredName">Known as</label>
            <input id="preferredName" name="preferredName" defaultValue={child.preferredName ?? ''} />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="moeNsn">NSN</label>
            <input className="narrow" id="moeNsn" name="moeNsn" defaultValue={child.moeNsn ?? ''} />
          </div>
          <div>
            <label htmlFor="gender">Gender</label>
            <select className="narrow" id="gender" name="gender" defaultValue={child.gender ?? ''}>
              <option value="">Not recorded</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g[0].toUpperCase() + g.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="iwi">Iwi</label>
            <input id="iwi" name="iwi" defaultValue={child.iwi ?? ''} />
          </div>
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label htmlFor="ethnicities">Ethnicities (up to three, comma separated)</label>
            <input id="ethnicities" name="ethnicities" defaultValue={child.ethnicities.join(', ')} />
          </div>
          <div>
            <label htmlFor="firstLanguage">First language</label>
            <input id="firstLanguage" name="firstLanguage" defaultValue={child.firstLanguage ?? ''} />
          </div>
        </div>

        {/*
          Date of birth is not editable here. It determines the ratio band and the
          funding entitlement, so a correction is a deliberate act rather than
          something done in passing while fixing a spelling — and it needs the
          audit trail to show it as its own change.
        */}
        <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
          Date of birth is {child.dateOfBirth}. It sets the ratio band and the funding
          entitlement, so correcting it is handled separately.
        </p>

        {error && <p className="error" role="alert">{error}</p>}
        {saved && <p style={{ color: 'var(--ok)', margin: 0 }}>Saved.</p>}

        <div>
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </div>
    </form>
  );
}
