'use client';

import { useActionState, useState } from 'react';
import type { IncidentInvestigation } from '@ece/core';
import { saveInvestigation, type Result } from '../actions';

/**
 * The centre's follow-up, as one form.
 *
 * The first control is the decision — "did this need investigating?" — because the
 * row records a decision, not a form-opening (0074's header). Everything else is
 * optional and stays editable: unlike the report above it, an investigation is the
 * centre's own working document, the hazards/tasks convention rather than the
 * draft→final one.
 *
 * There is no "when must WorkSafe be advised" logic here, and none is coming
 * without a source. The two WorkSafe fields record what the centre did.
 */
export function InvestigationForm({
  incidentId,
  investigation,
  hazards,
}: {
  incidentId: string;
  investigation: IncidentInvestigation | null;
  hazards: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(saveInvestigation, null);
  const [required, setRequired] = useState<string>(
    investigation === null ? '' : investigation.required ? 'yes' : 'no',
  );
  const [worksafe, setWorksafe] = useState<string>(
    investigation === null || investigation.worksafeAdvised === null
      ? ''
      : investigation.worksafeAdvised
        ? 'yes'
        : 'no',
  );

  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Investigation</h2>
      {investigation === null && (
        <p className="sub">
          Nothing recorded yet. Saying “not required” is itself a record — it shows the question
          was considered, which is a different fact from nobody having looked.
        </p>
      )}

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state && 'ok' in state && <p className="flag flag-ok">Saved</p>}

      <input type="hidden" name="incidentId" value={incidentId} />
      {investigation && <input type="hidden" name="investigationId" value={investigation.id} />}

      <div className="field">
        <label htmlFor="inv-required">Was an investigation required?</label>
        <select
          id="inv-required"
          name="required"
          value={required}
          onChange={(e) => setRequired(e.target.value)}
          required
        >
          <option value="">Not decided yet</option>
          <option value="yes">Yes</option>
          <option value="no">No — and record that decision</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="inv-on">Date investigated</label>
        <input
          id="inv-on"
          name="investigatedOn"
          type="date"
          defaultValue={investigation?.investigatedOn ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="inv-worksafe">WorkSafe advised?</label>
        <select
          id="inv-worksafe"
          name="worksafeAdvised"
          value={worksafe}
          onChange={(e) => setWorksafe(e.target.value)}
        >
          <option value="">Not stated</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
          Whether WorkSafe needed to be advised is the centre&rsquo;s judgement — this product does
          not decide it.
        </p>
      </div>

      {worksafe === 'yes' && (
        <div className="field">
          <label htmlFor="inv-worksafe-on">Date WorkSafe advised</label>
          <input
            id="inv-worksafe-on"
            name="worksafeAdvisedOn"
            type="date"
            defaultValue={investigation?.worksafeAdvisedOn ?? ''}
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="inv-hazard">Hazard register entry this produced or updated</label>
        <select id="inv-hazard" name="hazardId" defaultValue={investigation?.hazardId ?? ''}>
          <option value="">None</option>
          {hazards.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label.length > 80 ? `${h.label.slice(0, 80)}…` : h.label}
            </option>
          ))}
        </select>
        <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
          Linking the entry is the record that the register was updated. Record the hazard itself
          on the Facilities page first if it is not listed.
        </p>
      </div>

      <div className="field">
        <label htmlFor="inv-medical">Medical follow-up (hospital, doctor — who took them, what came of it)</label>
        <textarea
          id="inv-medical"
          name="medicalFollowup"
          rows={2}
          defaultValue={investigation?.medicalFollowup ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="inv-agency">Any agency contacted (which, when)</label>
        <input
          id="inv-agency"
          name="agencyContacted"
          type="text"
          defaultValue={investigation?.agencyContacted ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="inv-outcome">Outcome</label>
        <textarea
          id="inv-outcome"
          name="outcome"
          rows={2}
          defaultValue={investigation?.outcome ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="inv-notes">Notes</label>
        <textarea id="inv-notes" name="notes" rows={3} defaultValue={investigation?.notes ?? ''} />
      </div>

      <button type="submit" disabled={pending || required === ''}>
        {pending ? 'Saving…' : investigation ? 'Save changes' : 'Record'}
      </button>
      {required === '' && (
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          Decide whether an investigation was required first — that decision is the record.
        </p>
      )}
    </form>
  );
}
