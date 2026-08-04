'use client';

import { useActionState } from 'react';
import type { MessageThread } from '@ece/api';
import { close, markRead, reply, type Result } from './actions';

interface View {
  id: number;
  body: string;
  at: string;
  readAt: string | null;
  mine: boolean;
}

export function Thread({
  thread,
  childName,
  messages,
  canClose,
}: {
  thread: MessageThread;
  childName: string | null;
  messages: View[];
  canClose: boolean;
}) {
  const [replyState, replyAction, replying] = useActionState<Result | null, FormData>(reply, null);
  const [readState, readAction, marking] = useActionState<Result | null, FormData>(markRead, null);
  const [closeState, closeAction, closing] = useActionState<Result | null, FormData>(close, null);

  const error =
    (replyState && 'error' in replyState ? replyState.error : null) ??
    (readState && 'error' in readState ? readState.error : null) ??
    (closeState && 'error' in closeState ? closeState.error : null);

  const unreadFromOther = messages.some((m) => !m.mine && !m.readAt);

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: '1.0625rem', margin: '0 0 0.15rem' }}>{thread.subject}</h2>
          <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
            {childName ? `About ${childName}` : 'With the centre'}
            {thread.closedAt ? ' · closed' : ''}
          </p>
        </div>
        <span className="inline">
          {unreadFromOther && (
            <form action={readAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <button className="secondary small" type="submit" disabled={marking}>
                Mark read
              </button>
            </form>
          )}
          {canClose && !thread.closedAt && (
            <form action={closeAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <button className="secondary small" type="submit" disabled={closing}>
                Close
              </button>
            </form>
          )}
        </span>
      </div>

      <div className="stack" style={{ margin: '0.75rem 0' }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.mine ? 'flex-end' : 'flex-start',
              maxWidth: '32rem',
              background: m.mine ? 'var(--accent-soft)' : 'var(--surface-sunken)',
              border: '1px solid var(--line)',
              borderRadius: '10px',
              padding: '0.6rem 0.8rem',
            }}
          >
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.body}</p>
            <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
              {new Date(m.at).toLocaleString('en-NZ')}
              {m.mine && m.readAt ? ' · read' : ''}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {thread.closedAt ? (
        <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
          This conversation is closed. Start a new one to carry on.
        </p>
      ) : (
        <form action={replyAction}>
          <input type="hidden" name="threadId" value={thread.id} />
          <div className="row">
            <div style={{ flex: 1, minWidth: '16rem' }}>
              <label htmlFor={`reply-${thread.id}`}>Reply</label>
              <textarea className="wide" id={`reply-${thread.id}`} name="body" rows={2} required />
            </div>
            <button type="submit" disabled={replying}>
              {replying ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
