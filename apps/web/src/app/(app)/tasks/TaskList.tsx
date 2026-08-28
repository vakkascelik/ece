'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  compareTaskUrgency,
  isTaskLive,
  type Task,
} from '@ece/core';
import { addTask, finishTask, reopenTask, setTaskState, type Result } from './actions';

export interface TaskRow {
  task: Task;
  roomName: string | null;
  createdLabel: string;
  resolvedLabel: string | null;
  /** Computed on the server against the centre's calendar day, never in the browser. */
  overdue: boolean;
}

interface Option {
  id: string;
  name: string;
}

/** A hazard offered as the origin of a follow-up task. Its own shape: the label is
 *  the hazard's description, which is a sentence rather than a name. */
interface HazardOption {
  id: string;
  description: string;
}

const PRIORITY_CLASS: Record<string, string> = {
  critical: 'flag-critical',
  high: 'flag-warn',
  medium: 'flag-quiet',
  low: 'flag-quiet',
};

/**
 * The queue, live work first and oldest-worst at the top.
 *
 * Finished tasks stay on the list. A queue that hides what was done cannot show a
 * reviewer that anything ever gets done, which is most of what this register is
 * evidence of — the same argument the hazard list makes.
 */
export function TaskList({
  rows,
  rooms,
  openHazards,
}: {
  rows: TaskRow[];
  rooms: Option[];
  openHazards: HazardOption[];
}) {
  const [adding, setAdding] = useState(false);
  const sorted = [...rows].sort((a, b) => compareTaskUrgency(a.task, b.task));

  return (
    <div className="card">
      {rows.length === 0 ? (
        <p className="empty">Nothing recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Priority</th>
              <th>Wanted by</th>
              <th>State</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.task.id} row={r} />
            ))}
          </tbody>
        </table>
      )}

      {!adding ? (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            File a task
          </button>
        </p>
      ) : (
        <AddForm rooms={rooms} openHazards={openHazards} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function Row({ row }: { row: TaskRow }) {
  const { task: t } = row;
  const [editing, setEditing] = useState<'finish' | null>(null);

  const [finishState, finishAction, finishing] = useActionState<Result | null, FormData>(
    finishTask,
    null,
  );
  const [stateResult, stateAction, changingState] = useActionState<Result | null, FormData>(
    setTaskState,
    null,
  );
  const [reopenResult, reopenAction, reopening] = useActionState<Result | null, FormData>(
    reopenTask,
    null,
  );

  useEffect(() => {
    if (finishState && 'ok' in finishState) setEditing(null);
  }, [finishState]);

  const error =
    (finishState && 'error' in finishState ? finishState.error : null) ??
    (stateResult && 'error' in stateResult ? stateResult.error : null) ??
    (reopenResult && 'error' in reopenResult ? reopenResult.error : null);

  const live = isTaskLive(t);

  return (
    <tr>
      <td>
        <strong>{t.title}</strong>
        <div className="sub" style={{ fontSize: '0.8125rem' }}>
          {TASK_CATEGORY_LABELS[t.category]}
          {row.roomName ? ` · ${row.roomName}` : ''}
          {` · filed ${row.createdLabel}`}
        </div>
        {t.detail && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {t.detail}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>
        {/*
          A word, never a colour alone. The state chips in this product do not meet
          WCAG 1.4.11 and do not need to — the text inside carries the meaning.
        */}
        <span className={`flag ${PRIORITY_CLASS[t.priority]}`}>{TASK_PRIORITY_LABELS[t.priority]}</span>
      </td>
      <td>
        {t.dueOn ? (
          row.overdue && live ? (
            <span className="flag flag-warn">{t.dueOn}</span>
          ) : (
            t.dueOn
          )
        ) : (
          <span className="empty">—</span>
        )}
      </td>
      <td>
        {live ? (
          <span className="flag flag-quiet">{TASK_STATUS_LABELS[t.status]}</span>
        ) : (
          <>
            <span className="flag flag-ok">
              {'✓'} {TASK_STATUS_LABELS[t.status]} {row.resolvedLabel}
            </span>
            {t.resolution && (
              <div className="sub" style={{ fontSize: '0.8125rem' }}>
                {t.resolution}
              </div>
            )}
          </>
        )}
      </td>
      <td>
        {live && editing === null && (
          <span className="inline">
            {t.status === 'pending' && (
              <form action={stateAction} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value="open" />
                <input type="hidden" name="priority" value={t.priority} />
                <button className="small secondary" type="submit" disabled={changingState}>
                  Start
                </button>
              </form>
            )}
            <button className="small" type="button" onClick={() => setEditing('finish')}>
              Resolve
            </button>
          </span>
        )}

        {!live && (
          <form action={reopenAction}>
            <input type="hidden" name="id" value={t.id} />
            <button className="small secondary" type="submit" disabled={reopening}>
              {reopening ? 'Reopening…' : 'Reopen'}
            </button>
          </form>
        )}

        {editing === 'finish' && (
          <form action={finishAction}>
            <input type="hidden" name="id" value={t.id} />
            <div className="field">
              <label htmlFor={`resolution-${t.id}`}>What was done</label>
              <input id={`resolution-${t.id}`} name="resolution" type="text" required />
              <p className="sub" style={{ fontSize: '0.8125rem' }}>
                Required. A date on its own is not a record of anything.
              </p>
            </div>
            <div className="field">
              <label htmlFor={`status-${t.id}`}>State</label>
              <select id={`status-${t.id}`} name="status" defaultValue="resolved">
                <option value="resolved">Resolved — done, not checked</option>
                <option value="closed">Closed — done and checked</option>
              </select>
            </div>
            <div className="inline">
              <button type="submit" disabled={finishing}>
                {finishing ? 'Saving…' : 'Save'}
              </button>
              <button className="secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </td>
    </tr>
  );
}

function AddForm({
  rooms,
  openHazards,
  onDone,
}: {
  rooms: Option[];
  openHazards: HazardOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addTask, null);

  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="title">What needs doing</label>
        <input id="title" name="title" type="text" required />
      </div>

      <div className="field">
        <label htmlFor="detail">More detail (optional)</label>
        <input id="detail" name="detail" type="text" />
      </div>

      <div className="field">
        <label htmlFor="category">Kind</label>
        <select id="category" name="category" required defaultValue="maintenance">
          {TASK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {TASK_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="priority">How urgent</label>
        <select id="priority" name="priority" required defaultValue="medium">
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      {rooms.length > 0 && (
        <div className="field">
          <label htmlFor="roomId">Where (optional)</label>
          <select id="roomId" name="roomId" defaultValue="">
            <option value="">Not recorded</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="dueOn">Wanted by (optional)</label>
        <input id="dueOn" name="dueOn" type="date" />
      </div>

      {openHazards.length > 0 && (
        <div className="field">
          <label htmlFor="hazardId">Following up a hazard (optional)</label>
          <select id="hazardId" name="hazardId" defaultValue="">
            <option value="">Not a hazard follow-up</option>
            {openHazards.map((h) => (
              <option key={h.id} value={h.id}>
                {h.description}
              </option>
            ))}
          </select>
          <p className="sub" style={{ fontSize: '0.8125rem' }}>
            Linking does not close the hazard. Finishing the job and deciding the risk is
            controlled are two different acts, and the register keeps them apart.
          </p>
        </div>
      )}

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'File task'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
