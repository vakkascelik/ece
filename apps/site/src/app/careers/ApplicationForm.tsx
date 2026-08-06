'use client';

import { useActionState } from 'react';
import { APPLICATION_LIMITS } from '@ece/core';
import { CENTRES, EITHER_CENTRE } from '@/lib/centres';
import { apply, type ApplyResult } from './actions';

/**
 * The application form.
 *
 * A client component only because it reports a result. `useActionState` needs the boundary; the
 * rest of the page stays a server component and the route stays statically generated — the action
 * is a POST endpoint, not a reason to render this page per request.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASK
 *
 * No date of birth, no address, no "do you have a criminal record". A childcare service does need
 * a safety check before somebody starts, and none of it belongs on an unauthenticated public form
 * — a criminal-record question answered into a web form is a disclosure to whoever can read the
 * table, before anybody has decided to interview. `staff_records` holds vetting after an offer,
 * from documents the centre has sighted.
 *
 * No CV upload either, which is the honest gap: see the note at the foot of
 * `supabase/migrations/0024_recruitment.sql`.
 */
export function ApplicationForm() {
  const [result, formAction, pending] = useActionState<ApplyResult | null, FormData>(apply, null);

  /*
   * Once it has been accepted, the form goes away and the confirmation stays.
   *
   * A form still sitting there under "thank you" invites a second submit, and while the database
   * would absorb that quietly — a repeat while the application is open is a no-op by design — the
   * person cannot see that it did, so they are left unsure whether they applied once or twice.
   */
  if (result?.ok) {
    return (
      <div className="form-result" data-ok="true" role="status">
        <p>{result.message}</p>
      </div>
    );
  }

  return (
    <form className="form" action={formAction}>
      {result && !result.ok && (
        <div className="form-result" data-ok="false" role="status">
          <p>{result.message}</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="applicantName">Your name</label>
        <input
          id="applicantName"
          name="applicantName"
          required
          autoComplete="name"
          maxLength={APPLICATION_LIMITS.name}
        />
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={APPLICATION_LIMITS.email}
        />
      </div>

      <div className="field">
        <label htmlFor="phone">Phone (optional)</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={APPLICATION_LIMITS.phone}
        />
      </div>

      <div className="field">
        <label htmlFor="centre">Which centre</label>
        <select id="centre" name="centre" defaultValue={EITHER_CENTRE} required>
          <option value={EITHER_CENTRE}>Either centre</option>
          {CENTRES.map((centre) => (
            <option key={centre.path} value={centre.path}>
              {centre.name}
            </option>
          ))}
        </select>
        <span className="hint">
          Choosing “either” sends your application to both, so each centre manager sees it.
        </span>
      </div>

      <div className="field">
        <label htmlFor="positionSought">What sort of role (optional)</label>
        <input
          id="positionSought"
          name="positionSought"
          maxLength={APPLICATION_LIMITS.position}
          /* Their own careers page names this one, so it is theirs rather than a taxonomy this
             site invented and then displayed as though it came from the centre. */
          placeholder="e.g. qualified early childhood teacher, reliever"
        />
      </div>

      {/*
       * Three radios and no checkbox. "Yes", "no" and "not answered" are different facts, and an
       * unticked box would record "does not hold one" for somebody who skipped the question — the
       * same argument that kept consent three-state in the platform.
       *
       * "Rather not say" is pre-selected, and that is safe here precisely because it maps to null.
       * The default is therefore "not answered", which is what leaving a question alone means. It
       * would not be safe to pre-select either of the other two.
       */}
      <fieldset className="field-group">
        <legend>Do you hold a current New Zealand practising certificate?</legend>
        <div className="choices">
          <label className="choice">
            <input type="radio" name="certificate" value="yes" /> Yes
          </label>
          <label className="choice">
            <input type="radio" name="certificate" value="no" /> No
          </label>
          <label className="choice">
            <input type="radio" name="certificate" value="" defaultChecked /> Rather not say
          </label>
        </div>
        <span className="hint">
          We ask because it affects which roles are open. We will need to see the certificate
          itself before anyone starts, so nothing here is taken as proof.
        </span>
      </fieldset>

      <div className="field">
        <label htmlFor="availableFrom">Earliest start date (optional)</label>
        <input id="availableFrom" name="availableFrom" type="date" />
      </div>

      <div className="field">
        <label htmlFor="message">Anything you would like to tell us</label>
        <textarea id="message" name="message" maxLength={APPLICATION_LIMITS.message} />
        <span className="hint">
          Please also email your CV to career@littlepearls.org.nz — this form cannot take
          attachments yet.
        </span>
      </div>

      {/* The trap. Out of the accessibility tree and out of tab order — see `.trap` in globals.css
          for why it is not merely hidden from view. */}
      <div className="trap" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send application'}
      </button>
    </form>
  );
}
