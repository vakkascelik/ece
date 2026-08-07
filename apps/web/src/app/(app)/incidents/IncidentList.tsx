'use client';

import { useActionState } from 'react';
import { INCIDENT_KIND_LABELS, compareIncidentUrgency, type Incident } from '@ece/core';
import { finalise, markNotified, type Result } from './actions';

export interface IncidentRow {
  incident: Incident;
  childName: string;
  /** Wall clock in the centre's zone, formatted on the server. */
  occurredLabel: string;
  notifiedLabel: string | null;
  acknowledgedLabel: string | null;
}

/**
 * The register, most urgent first.
 *
 * Sorted by `compareIncidentUrgency` rather than by date: unfinished work above
 * finished, oldest first within the unfinished band. A plain newest-first list buries
 * a draft opened four hours ago beneath a report acknowledged a minute ago, which
 * hides the only row that needs somebody to do something.
 */
export function IncidentList({ rows }: { rows: IncidentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="empty">No incidents recorded in this period.</p>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => compareIncidentUrgency(a.incident, b.incident));

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Child</th>
            <th>What</th>
            <th>When</th>
            <th>Where it is up to</th>
            <th style={{ width: '1%' }}>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <Row key={r.incident.id} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: IncidentRow }) {
  const { incident: i } = row;
  const [finalState, finaliseAction, finalising] = useActionState<Result | null, FormData>(
    finalise,
    null,
  );
  const [notifyState, notifyAction, notifying] = useActionState<Result | null, FormData>(
    markNotified,
    null,
  );
  const error =
    (finalState && 'error' in finalState ? finalState.error : null) ??
    (notifyState && 'error' in notifyState ? notifyState.error : null);

  return (
    <tr>
      <td>
        <strong>{row.childName}</strong>
        {i.supersedes && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            Replaces an earlier report
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>
        {INCIDENT_KIND_LABELS[i.kind]}
        <div className="sub" style={{ fontSize: '0.8125rem' }}>
          {i.description.length > 90 ? `${i.description.slice(0, 90)}…` : i.description}
        </div>
      </td>
      <td>{row.occurredLabel}</td>
      <td>
        {/*
          Four states, and the draft one is worth spelling out on screen. A teacher
          who thinks they have told the family and has left the report in draft is
          the failure this column exists to make visible — the family cannot see a
          draft at all, and no policy will tell them so.
        */}
        {i.status === 'draft' && (
          <span className="flag flag-warn">{'●'} Draft — whānau cannot see this</span>
        )}
        {i.status === 'final' && !row.notifiedLabel && (
          <span className="flag flag-critical">{'▲'} Whānau not told yet</span>
        )}
        {row.notifiedLabel && !row.acknowledgedLabel && (
          <span className="flag flag-quiet">Told {row.notifiedLabel} — no reply yet</span>
        )}
        {row.acknowledgedLabel && (
          <span className="flag flag-ok">{'✓'} Acknowledged {row.acknowledgedLabel}</span>
        )}
      </td>
      <td>
        {i.status === 'draft' && (
          <form action={finaliseAction}>
            <input type="hidden" name="id" value={i.id} />
            <button className="small" type="submit" disabled={finalising}>
              {finalising ? 'Finalising…' : 'Finalise'}
            </button>
          </form>
        )}
        {i.status === 'final' && !row.notifiedLabel && (
          <form action={notifyAction}>
            <input type="hidden" name="id" value={i.id} />
            <button className="small secondary" type="submit" disabled={notifying}>
              {notifying ? 'Recording…' : 'Whānau told'}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}
