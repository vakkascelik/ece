'use client';

import { useActionState, useEffect, useState } from 'react';
import type { CustodyArrangement } from '@ece/api';
import { addCustody, supersedeCustody, type Result } from '../actions';

/**
 * Court orders and collection restrictions.
 *
 * Owner and manager only, and the component is not rendered at all for anyone
 * else — an empty "Custody" heading would tell an educator that an order exists,
 * which is most of what the restriction protects.
 *
 * Never visible to a guardian, including the guardian it concerns. A custody
 * arrangement is a record ABOUT the guardians, and "the father is not to collect,
 * order in place" is something the centre needs and the other parent must not read
 * here. That is why it is a separate table rather than a column on the whānau
 * record: a policy cannot hide some columns of a row from one role.
 */
export function CustodyPanel({
  childId,
  arrangements,
}: {
  childId: string;
  arrangements: CustodyArrangement[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      <p className="sub" style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem' }}>
        Not visible to educators, and never to whānau — including the person it concerns.
        Anything an educator needs to act on belongs on the collection list instead.
      </p>

      {arrangements.length === 0 ? (
        <p className="empty">Nothing recorded.</p>
      ) : (
        <div className="stack">
          {arrangements.map((a) => (
            <Arrangement key={a.id} childId={childId} arrangement={a} />
          ))}
        </div>
      )}

      {!adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Record an arrangement
          </button>
        </p>
      )}
      {adding && <CustodyForm childId={childId} onDone={() => setAdding(false)} />}
    </div>
  );
}

function Arrangement({
  childId,
  arrangement,
}: {
  childId: string;
  arrangement: CustodyArrangement;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(supersedeCustody, null);
  const error = state && 'error' in state ? state.error : null;

  return (
    <div style={{ borderLeft: '3px solid var(--line)', paddingLeft: '0.75rem' }}>
      <p style={{ margin: '0 0 0.25rem' }}>{arrangement.detail}</p>
      <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
        {arrangement.courtOrderReference && <>Order {arrangement.courtOrderReference} · </>}
        recorded {new Date(arrangement.at).toLocaleDateString('en-NZ')}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <form action={action} style={{ marginTop: '0.4rem' }}>
        <input type="hidden" name="arrangementId" value={arrangement.id} />
        <input type="hidden" name="childId" value={childId} />
        {/*
          Superseded, not edited or deleted — the arrangement in force on a given
          date has to stay answerable, and that question gets asked in front of a
          lawyer. The grant only permits writing `superseded_at`.
        */}
        <button className="secondary small" type="submit" disabled={pending}>
          No longer in force
        </button>
      </form>
    </div>
  );
}

function CustodyForm({ childId, onDone }: { childId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addCustody, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <input type="hidden" name="childId" value={childId} />
      <div className="stack">
        <div>
          <label htmlFor="detail">The arrangement</label>
          <textarea
            id="detail"
            name="detail"
            rows={3}
            required
            placeholder="Parenting order in place. Only Mum may collect. Do not discuss with either party."
          />
        </div>
        <div>
          <label htmlFor="courtOrderReference">Order reference</label>
          <input className="narrow" id="courtOrderReference" name="courtOrderReference" />
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
