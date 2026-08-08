'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Visitor } from '@ece/core';
import { signIn, signOut, type Result } from './actions';

export interface VisitorRow {
  visitor: Visitor;
  inLabel: string;
  outLabel: string | null;
}

/**
 * The book at the door.
 *
 * On-site visitors first, oldest arrival at the top — this list is read during an
 * evacuation, and the person who arrived three hours ago is the one nobody has
 * thought about since. The sign-in form sits open rather than behind a button,
 * because unlike every other register in this product the common visit to this page
 * IS a write: somebody is standing at the door.
 */
export function VisitorBook({ onSiteRows, todayRows }: { onSiteRows: VisitorRow[]; todayRows: VisitorRow[] }) {
  return (
    <>
      <SignInForm />

      <h2>In the building</h2>
      <div className="card">
        {onSiteRows.length === 0 ? (
          <p className="empty">Nobody is signed in.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>Why</th>
                <th>Arrived</th>
                <th style={{ width: '1%' }}>
                  <span className="visually-hidden">Sign out</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {onSiteRows.map((r) => (
                <OnSiteRow key={r.visitor.id} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Earlier today</h2>
      <div className="card">
        {todayRows.length === 0 ? (
          <p className="empty">Nobody else has visited today.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>Why</th>
                <th>Arrived</th>
                <th>Left</th>
              </tr>
            </thead>
            <tbody>
              {todayRows.map((r) => (
                <tr key={r.visitor.id}>
                  <td>
                    <strong>{r.visitor.fullName}</strong>
                    {r.visitor.organisation && (
                      <div className="sub" style={{ fontSize: '0.8125rem' }}>
                        {r.visitor.organisation}
                      </div>
                    )}
                  </td>
                  <td>{describe(r.visitor)}</td>
                  <td>{r.inLabel}</td>
                  <td>{r.outLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function describe(v: Visitor): string {
  // Purpose and who they came to see, joined for the row. Kept as two fields in the
  // schema because after an incident they answer different questions.
  const parts = [v.purpose, v.visiting ? `to see ${v.visiting}` : null].filter(Boolean);
  return parts.join(', ') || '—';
}

function OnSiteRow({ row }: { row: VisitorRow }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(signOut, null);

  return (
    <tr>
      <td>
        <strong>{row.visitor.fullName}</strong>
        {row.visitor.organisation && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {row.visitor.organisation}
          </div>
        )}
        {state && 'error' in state && (
          <div className="error" role="alert">
            {state.error}
          </div>
        )}
      </td>
      <td>{describe(row.visitor)}</td>
      <td>{row.inLabel}</td>
      <td>
        <form action={action}>
          <input type="hidden" name="id" value={row.visitor.id} />
          <button className="small" type="submit" disabled={pending}>
            {pending ? 'Signing out…' : 'Sign out'}
          </button>
        </form>
      </td>
    </tr>
  );
}

function SignInForm() {
  const [state, action, pending] = useActionState<Result | null, FormData>(signIn, null);
  // Cleared by remounting the fields on success: the next visitor should not have
  // to delete the previous one's name.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state && 'ok' in state) setFormKey((k) => k + 1);
  }, [state]);

  return (
    <form key={formKey} action={action} className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Sign a visitor in</h2>

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="fullName">Name</label>
        <input id="fullName" name="fullName" type="text" required autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="organisation">Organisation (optional)</label>
        <input id="organisation" name="organisation" type="text" autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="purpose">Why they are here (optional)</label>
        <input id="purpose" name="purpose" type="text" autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="visiting">Who they came to see (optional)</label>
        <input id="visiting" name="visiting" type="text" autoComplete="off" />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          After an incident, &ldquo;who were they with&rdquo; is the question that matters.
        </p>
      </div>

      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
