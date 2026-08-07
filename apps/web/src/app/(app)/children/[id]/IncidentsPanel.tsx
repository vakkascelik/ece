'use client';

import { useActionState } from 'react';
import { INCIDENT_KIND_LABELS, type Incident } from '@ece/core';
import { acknowledgeIncidentReport, type Result } from '../actions';

export interface ChildIncident {
  incident: Incident;
  occurredLabel: string;
  notifiedLabel: string | null;
  acknowledgedLabel: string | null;
}

/**
 * What happened to this child, and — for a family — the one thing on this page they
 * author themselves.
 *
 * WHY A PARENT SEES NO DRAFTS HERE
 *
 * Not because this component filters them out. `incidents_select` in 0030 returns a
 * draft only to staff, so a guardian's query never contains one. That distinction
 * matters: if this filtered, the filter would be the thing keeping a family out of a
 * half-written injury report, and it would be one careless edit from failing.
 *
 * A staff reader does see drafts, and they are labelled, because the same panel
 * serves both and a manager looking at a child record should see the report that is
 * still sitting unfinished.
 */
export function IncidentsPanel({
  childId,
  rows,
  isParent,
  ownGuardianId,
}: {
  childId: string;
  rows: ChildIncident[];
  isParent: boolean;
  ownGuardianId: string | null;
}) {
  return (
    <section className="card">
      <h2>Incidents</h2>

      {rows.length === 0 ? (
        <p className="empty">
          {isParent ? 'Nothing has been recorded for your child.' : 'Nothing recorded.'}
        </p>
      ) : (
        <ul className="plain">
          {rows.map((r) => (
            <Item
              key={r.incident.id}
              row={r}
              childId={childId}
              isParent={isParent}
              ownGuardianId={ownGuardianId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Item({
  row,
  childId,
  isParent,
  ownGuardianId,
}: {
  row: ChildIncident;
  childId: string;
  isParent: boolean;
  ownGuardianId: string | null;
}) {
  const { incident: i } = row;
  const [state, action, pending] = useActionState<Result | null, FormData>(
    acknowledgeIncidentReport,
    null,
  );

  /*
    Offered whenever the report is final and unacknowledged and the reader has a
    guardian record of their own — not gated on `isParent`. An educator whose own
    child attends the same centre is staff by every predicate in the schema and is
    still that child's parent, and 0030 decides by what changed rather than by who
    called precisely so they are not locked out of this.
  */
  const canAcknowledge = i.status === 'final' && !i.acknowledgedAt && ownGuardianId !== null;

  return (
    <li style={{ paddingBottom: '0.75rem' }}>
      <p style={{ margin: 0 }}>
        <strong>{INCIDENT_KIND_LABELS[i.kind]}</strong>{' '}
        <span className="sub">{row.occurredLabel}</span>
        {i.status === 'draft' && (
          <>
            {' '}
            <span className="flag flag-warn">{'●'} Draft</span>
          </>
        )}
      </p>

      <p style={{ margin: '0.25rem 0' }}>{i.description}</p>

      {i.firstAidGiven && (
        <p className="sub" style={{ margin: '0.25rem 0' }}>
          First aid: {i.firstAidGiven}
        </p>
      )}

      {row.acknowledgedLabel ? (
        <p className="sub" style={{ margin: '0.25rem 0' }}>
          <span className="flag flag-ok">{'✓'} Acknowledged {row.acknowledgedLabel}</span>
        </p>
      ) : row.notifiedLabel ? (
        <p className="sub" style={{ margin: '0.25rem 0' }}>
          Whānau told {row.notifiedLabel}
        </p>
      ) : null}

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      {canAcknowledge && (
        <form action={action}>
          <input type="hidden" name="incidentId" value={i.id} />
          <input type="hidden" name="childId" value={childId} />
          <input type="hidden" name="guardianId" value={ownGuardianId} />
          <button className="small secondary" type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'I have read this'}
          </button>
          {/*
            Wording chosen carefully. "Acknowledge" invites the reading that the
            family agrees with the account; "I have read this" is the claim actually
            being recorded, and it is the one a review asks about.
          */}
        </form>
      )}

      {isParent && i.status === 'final' && !i.acknowledgedAt && ownGuardianId === null && (
        <p className="sub" style={{ margin: '0.25rem 0' }}>
          You are not recorded as a guardian for this child, so this cannot be acknowledged under
          your name. Ask the centre to check your details.
        </p>
      )}
    </li>
  );
}
