'use client';

import { useActionState } from 'react';
import { ENQUIRY_LIMITS } from '@ece/core';
import { AGE_BANDS, AGE_BAND_LABELS } from '@ece/api/enquiries';
import { CENTRES, EITHER_CENTRE } from '@/lib/centres';
import { enquire, type EnquiryResult } from './actions';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
];

/**
 * The enrolment enquiry form.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT ASKS FOR NO CHILD'S NAME AND NO DATE OF BIRTH
 *
 * The page around this form has said since the site was built that when a form was
 * eventually added it would collect the guardian's details and a coarse age band and
 * nothing about the child. Two reasons, and both hold:
 *
 *   1. `docs/tenant-little-pearls.md` holds this deployment to **zero personal
 *      information** until professional indemnity insurance is in place. A public endpoint
 *      writing an identifiable under-five into the platform crosses that line, with the
 *      weakest lawful basis in the product — nobody has signed anything.
 *   2. The centre does not need a child's name to phone a guardian back.
 *
 * The centre's *current* form, on their Adobe Muse site, asks for the child's full name and
 * exact date of birth. Not carrying that forward is the point of this one.
 *
 * If a field for a child's name ever appears below, migration 0054, the RLS suite's two
 * catalogue assertions, and this comment all have to be argued with first.
 */
export function EnquiryForm() {
  const [result, formAction, pending] = useActionState<EnquiryResult | null, FormData>(
    enquire,
    null,
  );

  // Once accepted, the form goes away and the confirmation stays. A form still sitting
  // under "thank you" invites a second submit, and although the database absorbs that
  // quietly — a repeat while an enquiry is open is a no-op by design — the person cannot
  // see that it did, so they are left unsure whether they sent one or two.
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
        <label htmlFor="contactName">Your name</label>
        <input
          id="contactName"
          name="contactName"
          required
          maxLength={ENQUIRY_LIMITS.contactName}
          autoComplete="name"
        />
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={ENQUIRY_LIMITS.email}
          autoComplete="email"
        />
      </div>

      <div className="field">
        <label htmlFor="phone">Phone (optional)</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          maxLength={ENQUIRY_LIMITS.phone}
          autoComplete="tel"
        />
      </div>

      <div className="field">
        <label htmlFor="centre">Which centre</label>
        <select id="centre" name="centre" defaultValue={EITHER_CENTRE} required>
          {CENTRES.map((c) => (
            <option key={c.path} value={c.path}>
              {c.name}
            </option>
          ))}
          <option value={EITHER_CENTRE}>Either centre</option>
        </select>
      </div>

      {/*
        The age question, and the only thing this form asks about the child.

        A select rather than a date field, because a date field is a date of birth however
        it is labelled. "Not born yet" is a real answer: families join waitlists before the
        birth, which is exactly when a centre most wants to hear from them.
      */}
      <div className="field">
        <label htmlFor="ageBand">How old is your child?</label>
        <select id="ageBand" name="ageBand" defaultValue="">
          <option value="">Rather not say</option>
          {AGE_BANDS.map((band) => (
            <option key={band} value={band}>
              {AGE_BAND_LABELS[band]}
            </option>
          ))}
        </select>
        <p className="hint">
          We only need a rough idea so we know which room to talk to you about. We will not
          ask for your child&rsquo;s name or date of birth until you enrol.
        </p>
      </div>

      <div className="field">
        <label htmlFor="wantedFrom">When would you like to start? (optional)</label>
        <input id="wantedFrom" name="wantedFrom" type="date" />
      </div>

      <fieldset className="field-group">
        <legend>Which days, if you know (optional)</legend>
        <div className="choices">
          {DAYS.map((day) => (
            <label key={day.value} className="choice">
              <input type="checkbox" name="wantedDays" value={day.value} />
              <span>{day.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="message">Anything else? (optional)</label>
        <textarea id="message" name="message" rows={4} maxLength={ENQUIRY_LIMITS.message} />
      </div>

      {/*
        The honeypot, and `.trap` is `display: none` rather than visually-hidden on purpose:
        a visually-hidden field is still in the accessibility tree, so somebody on a screen
        reader might fill it in and have their enquiry silently discarded. A trap that
        punishes blind families is worse than no trap. See globals.css.
      */}
      <div className="trap" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send enquiry'}
      </button>
    </form>
  );
}
