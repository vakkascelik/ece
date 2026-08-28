'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import type { ChecklistTemplate } from '@ece/core';
import { addTemplate, beginRun, type Result } from './actions';

export interface TemplateRow {
  template: ChecklistTemplate;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  draftVersionId: string | null;
  lastDoneLabel: string | null;
  daysSince: number | null;
  /**
   * `null` means the template states no interval — rendered differently from
   * `false`, which means "recently enough". The contract `drillStatuses` and
   * `checklistStatuses` both hold: a green tick against an unmeasured gap is how a
   * product talks a centre into a breach.
   */
  overdue: boolean | null;
}

export interface OpenRunRow {
  id: string;
  name: string;
  roomName: string | null;
  startedLabel: string;
}

interface Option {
  id: string;
  name: string;
}

export function ChecklistBoard({
  rows,
  openRuns,
  rooms,
  canManage,
}: {
  rows: TemplateRow[];
  openRuns: OpenRunRow[];
  rooms: Option[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <>
      {/*
        Half-finished forms first, because a run somebody started and walked away
        from is the thing most likely to be forgotten, and the only state where the
        record exists but says nothing yet.
      */}
      {openRuns.length > 0 && (
        <>
          <h2>Being filled in</h2>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Checklist</th>
                  <th>Started</th>
                  <th style={{ width: '1%' }}>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {openRuns.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      {r.roomName && (
                        <div className="sub" style={{ fontSize: '0.8125rem' }}>
                          {r.roomName}
                        </div>
                      )}
                    </td>
                    <td>{r.startedLabel}</td>
                    <td>
                      <Link className="button small" href={`/checklists/${r.id}`}>
                        Continue
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Checklists</h2>
      <div className="card">
        {rows.length === 0 ? (
          <p className="empty">
            No checklists yet.{' '}
            {canManage
              ? 'Build one below — it is a form with questions, and a run is one filling-in of it.'
              : 'A manager sets these up.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Checklist</th>
                <th>Last done</th>
                <th>State</th>
                <th style={{ width: '1%' }}>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.template.id} row={r} rooms={rooms} canManage={canManage} />
              ))}
            </tbody>
          </table>
        )}

        {canManage &&
          (!adding ? (
            <p style={{ margin: '0.75rem 0 0' }}>
              <button className="secondary small" type="button" onClick={() => setAdding(true)}>
                Build a checklist
              </button>
            </p>
          ) : (
            <AddForm onDone={() => setAdding(false)} />
          ))}
      </div>
    </>
  );
}

function Row({
  row,
  rooms,
  canManage,
}: {
  row: TemplateRow;
  rooms: Option[];
  canManage: boolean;
}) {
  const { template: t } = row;
  const [starting, setStarting] = useState(false);
  const [state, action, pending] = useActionState<Result | null, FormData>(beginRun, null);

  useEffect(() => {
    if (state && 'ok' in state) setStarting(false);
  }, [state]);

  return (
    <tr>
      <td>
        <strong>{t.name}</strong>
        <div className="sub" style={{ fontSize: '0.8125rem' }}>
          {t.folder ? `${t.folder} · ` : ''}
          {t.recurDays ? `every ${t.recurDays === 1 ? 'day' : `${t.recurDays} days`}` : 'no set interval'}
          {row.publishedVersion !== null ? ` · version ${row.publishedVersion}` : ''}
        </div>
        {state && 'error' in state && (
          <div className="error" role="alert">
            {state.error}
          </div>
        )}
      </td>
      <td>
        {row.lastDoneLabel ?? <span className="empty">Never</span>}
        {row.daysSince !== null && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {row.daysSince === 0 ? 'today' : `${row.daysSince} days ago`}
          </div>
        )}
      </td>
      <td>
        {/*
          Three states, not two. `null` is not a pass — it says the centre has not
          stated how often this is meant to happen, and a tick there would be the
          product inventing a rule.
        */}
        {row.overdue === true ? (
          <span className="flag flag-warn">Due</span>
        ) : row.overdue === false ? (
          <span className="flag flag-ok">{'✓'} Up to date</span>
        ) : (
          <span className="flag flag-quiet">No interval set</span>
        )}
        {row.publishedVersionId === null && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            Not published yet — it cannot be filled in.
          </div>
        )}
      </td>
      <td>
        <span className="inline">
          {row.publishedVersionId !== null && !starting && (
            <button className="small" type="button" onClick={() => setStarting(true)}>
              Start
            </button>
          )}
          {canManage && (
            <Link
              className="button small secondary"
              href={`/checklists/templates/${row.draftVersionId ?? row.publishedVersionId}`}
            >
              {row.draftVersionId ? 'Finish draft' : 'Questions'}
            </Link>
          )}
        </span>

        {starting && row.publishedVersionId && (
          <form action={action} style={{ marginTop: '0.5rem' }}>
            <input type="hidden" name="versionId" value={row.publishedVersionId} />
            {rooms.length > 0 && (
              <div className="field">
                <label htmlFor={`room-${t.id}`}>Which room (optional)</label>
                <select id={`room-${t.id}`} name="roomId" defaultValue="">
                  <option value="">Not recorded</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="inline">
              <button type="submit" disabled={pending}>
                {pending ? 'Starting…' : 'Start'}
              </button>
              <button className="secondary" type="button" onClick={() => setStarting(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </td>
    </tr>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addTemplate, null);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="name">What is it called</label>
        <input id="name" name="name" type="text" required />
      </div>

      <div className="field">
        <label htmlFor="folder">Group (optional)</label>
        <input id="folder" name="folder" type="text" placeholder="Daily, Monthly, Kitchen…" />
      </div>

      <div className="field">
        <label htmlFor="recurDays">How often, in days (optional)</label>
        <input id="recurDays" name="recurDays" type="number" min={1} max={730} />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Leave blank if there is no set interval. The screen then shows how long it has been
          and does not call it late — this product does not invent a frequency, because a
          number here would read to your team as the rule.
        </p>
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create and add questions'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
