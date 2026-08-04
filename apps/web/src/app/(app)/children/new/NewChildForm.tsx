'use client';

import { useActionState } from 'react';
import { GENDERS } from '@ece/core';
import { enrolChild, type Result } from '../actions';

/**
 * A client component because the action reports errors, and a form `action` must
 * return void — so `useActionState` is the only way to render "another child
 * already has that NSN" instead of a Next error page.
 *
 * Only name and date of birth are required. Everything else can be filled in
 * later, because an enrolment form arrives incomplete far more often than not and
 * a screen that refuses to save until every Ministry field is present gets worked
 * around with placeholder data.
 */
export function NewChildForm() {
  const [state, action, pending] = useActionState<Result | null, FormData>(enrolChild, null);
  const error = state && 'error' in state ? state.error : null;

  return (
    <form action={action} className="card">
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" required autoComplete="off" />
          </div>
          <div>
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" required autoComplete="off" />
          </div>
        </div>

        <div>
          <label htmlFor="preferredName">Preferred name</label>
          <input id="preferredName" name="preferredName" autoComplete="off" />
          <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
            What they are actually called, if it is not their first name.
          </p>
        </div>

        <div className="row">
          <div>
            <label htmlFor="dateOfBirth">Date of birth</label>
            <input className="narrow" id="dateOfBirth" name="dateOfBirth" type="date" required />
          </div>
          <div>
            <label htmlFor="gender">Gender</label>
            <select className="narrow" id="gender" name="gender" defaultValue="">
              <option value="">Not recorded</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g[0].toUpperCase() + g.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="moeNsn">NSN</label>
            <input className="narrow" id="moeNsn" name="moeNsn" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="iwi">Iwi</label>
            <input id="iwi" name="iwi" autoComplete="off" />
          </div>
        </div>

        <div>
          <label htmlFor="ethnicities">Ethnicities</label>
          <input id="ethnicities" name="ethnicities" autoComplete="off" placeholder="Māori, NZ European" />
          <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
            Comma separated, up to three — which is what the Ministry accepts.
          </p>
        </div>

        <div>
          <label htmlFor="firstLanguage">First language</label>
          <input id="firstLanguage" name="firstLanguage" autoComplete="off" />
        </div>

        {error && <p className="error">{error}</p>}

        <div>
          <button type="submit" disabled={pending}>
            {pending ? 'Enrolling…' : 'Enrol'}
          </button>
        </div>
      </div>
    </form>
  );
}
