'use client';

import { useActionState, useEffect, useState } from 'react';
import { POST_KIND_LABELS, REO, type PostKind } from '@ece/core';
import { write, type Result } from './actions';

interface Strand {
  id: string;
  nameEn: string;
  nameReo: string;
}

/**
 * Writing a post.
 *
 * Saves as a draft, always. Publishing is a second, separate click on the card below, because an
 * educator writing up a learning moment should be able to read it back before forty families do —
 * and because publishing is what a notification hangs off.
 */
export function Compose({
  children_,
  strands,
}: {
  children_: { id: string; name: string }[];
  strands: Strand[];
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(write, null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PostKind>('learning_moment');
  const error = state && 'error' in state ? state.error : null;

  useEffect(() => {
    if (state && 'ok' in state) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <p>
        <button type="button" onClick={() => setOpen(true)}>
          Write something
        </button>
      </p>
    );
  }

  const isPanui = kind === 'panui';

  return (
    <form action={action} className="card">
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="kind">Kind</label>
            <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as PostKind)}>
              {(Object.keys(POST_KIND_LABELS) as PostKind[]).map((k) => (
                <option key={k} value={k}>
                  {POST_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '16rem' }}>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required autoComplete="off" />
          </div>
        </div>

        <div>
          <label htmlFor="body">What happened</label>
          <textarea id="body" name="body" rows={4} required />
        </div>

        {isPanui ? (
          <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
            A {REO.panui} goes to every {REO.whanau} at the centre, so it does not name children.
          </p>
        ) : (
          <div>
            <label>Which tamariki is this about</label>
            {children_.length === 0 ? (
              <p className="empty">Nobody is enrolled yet.</p>
            ) : (
              <div className="days">
                {children_.map((c) => (
                  <label key={c.id}>
                    <input type="checkbox" name="childIds" value={c.id} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
            {/*
              The audience is derived from this, so it is not optional. A learning moment naming
              nobody reaches nobody while looking published.
            */}
            <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
              Only their own {REO.whanau} will see it.
            </p>

            {strands.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <label>Te Whāriki strands this touches (optional)</label>
                <div className="days">
                  {strands.map((s) => (
                    <label key={s.id}>
                      <input type="checkbox" name="strandIds" value={s.id} />
                      {s.nameEn} · {s.nameReo}
                    </label>
                  ))}
                </div>
                <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
                  Only for the evidence binder&rsquo;s curriculum-coverage section — {REO.whanau}
                  never see this.
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save as draft'}
          </button>
          <button className="secondary" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <span className="sub" style={{ fontSize: '0.8125rem' }}>
            You can add photos and publish it after saving.
          </span>
        </div>
      </div>
    </form>
  );
}
