'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ExcursionStatus } from '@ece/core';
import { countHeads, depart, markReturned, type Result } from './../actions';

export interface CountRow {
  id: number;
  label: string;
  counted: number;
  expected: number;
  note: string | null;
}

/**
 * The outing's state machine and its counts: depart, count, count again, return.
 *
 * The depart button is never disabled by the consent gaps. Disabling it would hide
 * the refusal — the person taps, nothing happens, and the reason lives in a tooltip
 * nobody reads. Tapping it with gaps outstanding produces the sentence from the
 * server naming what is missing, which is the same information at the moment it is
 * wanted.
 */
export function Runsheet({
  excursionId,
  status,
  unanswered,
  refused,
  childrenOnOuting,
  lastCount,
  countRows,
}: {
  excursionId: string;
  status: ExcursionStatus;
  unanswered: number;
  refused: number;
  childrenOnOuting: number;
  lastCount: { label: string; counted: number; expected: number; short: boolean } | null;
  countRows: CountRow[];
}) {
  const [departState, departAction, departing] = useActionState<Result | null, FormData>(
    depart,
    null,
  );
  const [returnState, returnAction, returning] = useActionState<Result | null, FormData>(
    markReturned,
    null,
  );

  const error =
    (departState && 'error' in departState ? departState.error : null) ??
    (returnState && 'error' in returnState ? returnState.error : null);

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {status === 'planned' && (
        <>
          <p className="inline" style={{ marginTop: 0 }}>
            {unanswered === 0 && refused === 0 && childrenOnOuting > 0 ? (
              <span className="flag flag-ok">
                {'✓'} Every child on the list has consent for this outing
              </span>
            ) : (
              <>
                {unanswered > 0 && (
                  <span className="flag flag-warn">
                    {'●'} {unanswered} {unanswered === 1 ? 'family has' : 'families have'} not
                    answered
                  </span>
                )}
                {refused > 0 && (
                  <span className="flag flag-critical">
                    {refused} said no — {refused === 1 ? 'that child comes' : 'those children come'}{' '}
                    off the list
                  </span>
                )}
              </>
            )}
          </p>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <form action={departAction}>
            <input type="hidden" name="excursionId" value={excursionId} />
            <button type="submit" disabled={departing || childrenOnOuting === 0}>
              {departing ? 'Departing…' : 'Depart'}
            </button>
          </form>
        </>
      )}

      {status === 'departed' && (
        <>
          {lastCount && (
            <p style={{ marginTop: 0 }}>
              {lastCount.short ? (
                // Lower than expected is a child nobody can see — not a "mismatch",
                // which would also cover an extra adult in the count.
                <span className="flag flag-critical">
                  {'▲'} Last count SHORT: {lastCount.counted} of {lastCount.expected} at{' '}
                  {lastCount.label} — count again now
                </span>
              ) : (
                <span className="flag flag-ok">
                  {'✓'} Last count {lastCount.counted} of {lastCount.expected} at {lastCount.label}
                </span>
              )}
            </p>
          )}

          <CountForm excursionId={excursionId} expectedDefault={childrenOnOuting} />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <form action={returnAction} style={{ marginTop: '0.75rem' }}>
            <input type="hidden" name="excursionId" value={excursionId} />
            <button type="submit" disabled={returning}>
              {returning ? 'Recording…' : 'Back at the centre'}
            </button>
          </form>
        </>
      )}

      {status === 'returned' && (
        <p style={{ margin: 0 }}>
          <span className="flag flag-ok">{'✓'} Returned</span>
        </p>
      )}

      {countRows.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.9375rem', margin: '1rem 0 0.5rem' }}>Counts taken</h3>
          <ul className="plain" style={{ margin: 0 }}>
            {countRows.map((c) => (
              <li key={c.id} style={{ fontSize: '0.875rem' }}>
                {c.label}: {c.counted} of {c.expected}
                {c.counted < c.expected && <strong> — short</strong>}
                {c.note && <span className="sub"> · {c.note}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CountForm({
  excursionId,
  expectedDefault,
}: {
  excursionId: string;
  expectedDefault: number;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(countHeads, null);

  // Fresh key per submission — the second count of the day must not be swallowed as
  // a duplicate of the first. Same contract as every register write.
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(crypto.randomUUID()), []);
  useEffect(() => {
    if (state && 'ok' in state) setKey(crypto.randomUUID());
  }, [state]);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="excursionId" value={excursionId} />
      <input type="hidden" name="clientUuid" value={key ?? ''} />

      <label htmlFor="counted">Counted</label>
      <input
        id="counted"
        name="counted"
        type="number"
        min={0}
        inputMode="numeric"
        required
        style={{ width: '5rem' }}
      />

      <label htmlFor="expected">of</label>
      {/*
        Prefilled from the roster and editable: the person counting states what they
        are counting against, and the plan may have changed since departure — two
        children collected early by a parent is an expected of N-2, not a short count.
      */}
      <input
        id="expected"
        name="expected"
        type="number"
        min={0}
        inputMode="numeric"
        required
        defaultValue={expectedDefault}
        style={{ width: '5rem' }}
      />

      <label htmlFor="count-note" className="visually-hidden">
        Note
      </label>
      <input id="count-note" name="note" type="text" placeholder="Note (optional)" />

      <button className="small" type="submit" disabled={pending || key === null}>
        {pending ? 'Recording…' : 'Record count'}
      </button>

      {state && 'error' in state && (
        <span className="error" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
