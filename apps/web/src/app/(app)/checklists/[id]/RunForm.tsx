'use client';

import { useActionState, useState } from 'react';
import type { ChecklistAnswer, ChecklistItem, RunProgress } from '@ece/core';
import { saveAnswer, signRun, type Result } from '../actions';

/**
 * The form itself.
 *
 * One server action per item rather than one for the whole form, deliberately. A
 * playground check is done walking around with a phone, and a single submit at the
 * end means everything is lost if the browser is closed at the gate — which is where
 * this is used. Each answer is a row the moment it is given.
 */
export function RunForm({
  runId,
  items,
  answers,
  progress,
  note,
  signed,
}: {
  runId: string;
  items: ChecklistItem[];
  answers: ChecklistAnswer[];
  progress: RunProgress;
  note: string | null;
  signed: boolean;
}) {
  const byItem = new Map(answers.map((a) => [a.itemId, a]));

  return (
    <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="inline" style={{ margin: 0 }}>
          <span className="flag flag-quiet">
            {progress.answered} of {progress.total} answered
          </span>
          {progress.remaining > 0 && (
            <span className="flag flag-warn">{progress.remaining} still required</span>
          )}
          {progress.failures > 0 && (
            <span className="flag flag-critical">
              {'▲'} {progress.failures} {progress.failures === 1 ? 'finding' : 'findings'}
            </span>
          )}
        </p>
      </div>

      {items.length === 0 && <p className="empty">This checklist has no questions.</p>}

      {items.map((item) => (
        <Item key={item.id} runId={runId} item={item} answer={byItem.get(item.id) ?? null} locked={signed} />
      ))}

      {!signed && <SignOff runId={runId} progress={progress} />}

      {signed && note && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Note</h2>
          <p style={{ margin: 0 }}>{note}</p>
        </div>
      )}
    </>
  );
}

function Item({
  runId,
  item,
  answer,
  locked,
}: {
  runId: string;
  item: ChecklistItem;
  answer: ChecklistAnswer | null;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(saveAnswer, null);
  const [value, setValue] = useState(answer?.value ?? '');

  const choices =
    item.responseType === 'yes_no'
      ? ['yes', 'no']
      : item.responseType === 'yes_no_na'
        ? ['yes', 'no', 'na']
        : null;

  const LABELS: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A' };

  if (locked) {
    return (
      <div className="card" style={{ marginBottom: '0.75rem' }}>
        <strong>{item.prompt}</strong>
        <p style={{ margin: '0.35rem 0 0' }}>
          {answer ? (
            <span className={`flag ${answer.value === 'no' ? 'flag-critical' : 'flag-ok'}`}>
              {LABELS[answer.value] ?? answer.value}
            </span>
          ) : (
            <span className="empty">Not answered</span>
          )}
        </p>
        {answer?.note && (
          <p className="sub" style={{ margin: '0.35rem 0 0' }}>
            {answer.note}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="card" style={{ marginBottom: '0.75rem' }}>
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="itemId" value={item.id} />

      <strong>
        {item.prompt}
        {!item.required && <span className="sub"> (optional)</span>}
      </strong>
      {item.guidance && (
        <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
          {item.guidance}
        </p>
      )}

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field" style={{ marginTop: '0.5rem' }}>
        {choices ? (
          <span className="inline">
            {choices.map((c) => (
              <label key={c} style={{ marginRight: '0.75rem' }}>
                <input
                  type="radio"
                  name="value"
                  value={c}
                  checked={value === c}
                  onChange={() => setValue(c)}
                />{' '}
                {LABELS[c]}
              </label>
            ))}
          </span>
        ) : (
          <input
            name="value"
            type={item.responseType === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={item.prompt}
          />
        )}
      </div>

      {/*
        The note field appears for everything and is REQUIRED for a "no".

        `checklist_answers_no_needs_note` in 0068 enforces it, and it is the direct
        descendant of the constraint 0034 called the single most useful one in that
        file. Without it a run reads "gate latch: no" and the next person learns
        nothing — which destroys the only reason to keep the record.
      */}
      <div className="field">
        <label htmlFor={`note-${item.id}`}>
          {value === 'no' ? 'What was wrong' : 'Note (optional)'}
        </label>
        <input
          id={`note-${item.id}`}
          name="note"
          type="text"
          required={value === 'no'}
          defaultValue={answer?.note ?? ''}
        />
      </div>

      <button className="small" type="submit" disabled={pending || value === ''}>
        {pending ? 'Saving…' : answer ? 'Change answer' : 'Save'}
      </button>
    </form>
  );
}

function SignOff({ runId, progress }: { runId: string; progress: RunProgress }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(signRun, null);

  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Sign off</h2>

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <input type="hidden" name="runId" value={runId} />

      <div className="field">
        <label htmlFor="note">Anything else (optional)</label>
        <input id="note" name="note" type="text" />
      </div>

      {/*
        Disabled rather than hidden, with the reason next to it. The trigger in 0068
        is what makes the rule true; this only saves somebody the round trip. A
        checklist that could be signed with blank required lines would be the
        confidently-wrong artefact this whole product exists to avoid.
      */}
      <button type="submit" disabled={pending || !progress.canComplete}>
        {pending ? 'Signing…' : 'Sign this off'}
      </button>
      {!progress.canComplete && (
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          {progress.remaining} required {progress.remaining === 1 ? 'question is' : 'questions are'}{' '}
          still unanswered.
        </p>
      )}
      <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
        Once signed this cannot be edited. A correction is a new run.
      </p>
    </form>
  );
}
