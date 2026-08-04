'use client';

import { useActionState, useEffect, useState } from 'react';
import { EVIDENCE_KINDS, type Criterion, type Evidence } from '@ece/api';
import { fileEvidence, retireEvidence, type Result } from './actions';

const KIND_LABELS: Record<string, string> = {
  document: 'Document',
  photo: 'Photo',
  meeting_minutes: 'Meeting minutes',
  ratio_history: 'Ratio history',
  staff_record: 'Staff record',
  policy: 'Policy',
  note: 'Note',
};

/**
 * What the centre has, and where it is.
 *
 * `location` is a place, not a file — a filing cabinet, a shared drive, a URL. A centre's
 * evidence mostly already exists, and the useful first step is knowing what covers which
 * criterion rather than re-uploading three years of paper. Attaching real files needs the
 * consent-gated media pipeline that does not exist until Phase 4.
 */
export function EvidenceList({
  evidence,
  criteria,
}: {
  evidence: Evidence[];
  criteria: Criterion[];
}) {
  const [adding, setAdding] = useState(false);
  const byId = new Map(criteria.map((c) => [c.id, c]));

  return (
    <div className="card">
      {evidence.length === 0 ? (
        <p className="empty">Nothing filed yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>What</th>
              <th>Kind</th>
              <th>Criterion</th>
              <th>Where</th>
              <th>Covers</th>
              <th style={{ width: '1%' }} />
            </tr>
          </thead>
          <tbody>
            {evidence.map((e) => (
              <Row key={e.id} item={e} criterion={e.criterionId ? byId.get(e.criterionId) : undefined} />
            ))}
          </tbody>
        </table>
      )}

      {!adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            File evidence
          </button>
        </p>
      )}
      {adding && <Form criteria={criteria} onDone={() => setAdding(false)} />}
    </div>
  );
}

function Row({ item, criterion }: { item: Evidence; criterion: Criterion | undefined }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(retireEvidence, null);
  const error = state && 'error' in state ? state.error : null;

  return (
    <tr>
      <td>
        <strong>{item.title}</strong>
        {item.detail && <div className="sub" style={{ fontSize: '0.8125rem' }}>{item.detail}</div>}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>{KIND_LABELS[item.kind] ?? item.kind}</td>
      <td>
        {criterion ? (
          <>
            <strong>{criterion.code}</strong> {criterion.title}
          </>
        ) : item.criterionId ? (
          // The criterion belonged to a set that has since been replaced. The evidence
          // survives — `on delete set null` — because losing the document because the
          // numbering changed would be the opposite of the point.
          <span className="empty">criterion no longer in the current set</span>
        ) : (
          <span className="empty">not attached</span>
        )}
      </td>
      <td>{item.location ?? <span className="empty">not recorded</span>}</td>
      <td>
        {item.coversFrom || item.coversTo ? (
          `${item.coversFrom ?? '…'} to ${item.coversTo ?? 'now'}`
        ) : (
          <span className="empty">&mdash;</span>
        )}
      </td>
      <td>
        <form action={action}>
          <input type="hidden" name="evidenceId" value={item.id} />
          <button className="secondary small" type="submit" disabled={pending}>
            Retire
          </button>
        </form>
      </td>
    </tr>
  );
}

function Form({ criteria, onDone }: { criteria: Criterion[]; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(fileEvidence, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <div className="stack">
        <div className="row">
          <div style={{ flex: 1, minWidth: '16rem' }}>
            <label htmlFor="title">What is it</label>
            <input id="title" name="title" required placeholder="Emergency evacuation drill record" />
          </div>
          <div>
            <label htmlFor="ev-kind">Kind</label>
            <select id="ev-kind" name="kind" defaultValue="document">
              {EVIDENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="criterionId">Criterion</label>
          <select id="criterionId" name="criterionId" defaultValue="">
            <option value="">Not attached to one yet</option>
            {criteria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          {criteria.length === 0 && (
            <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
              No criteria are loaded, so this can only be filed unattached for now. It can be
              attached later once a set is imported.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="location">Where it is</label>
          <input className="wide" id="location" name="location" placeholder="Office filing cabinet, drawer 2" />
        </div>

        <div className="row">
          <div>
            <label htmlFor="coversFrom">Covers from</label>
            <input className="narrow" id="coversFrom" name="coversFrom" type="date" />
          </div>
          <div>
            <label htmlFor="coversTo">to</label>
            <input className="narrow" id="coversTo" name="coversTo" type="date" />
          </div>
          <div>
            <label htmlFor="ownerName">Whose job is it to keep current</label>
            <input id="ownerName" name="ownerName" />
          </div>
        </div>

        <div>
          <label htmlFor="detail">Detail</label>
          <textarea id="detail" name="detail" rows={2} />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Filing…' : 'File'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
