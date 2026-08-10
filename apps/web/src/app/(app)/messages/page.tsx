import { listChildren, listMessages, listThreads } from '@ece/api';
import { can, displayName, REO } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { NewThread } from './NewThread';
import { Thread } from './Thread';
import { PageHeader } from '../PageHeader';

/**
 * Threads between kaiako and whānau.
 *
 * Staff are in every thread at their centre, because a message to a family is centre business —
 * the educator who wrote it may be on leave when the reply arrives. A parent is in the threads
 * about their own children, plus any they started about no child at all.
 *
 * Messages are append-only in the policies *and* the grants, so nothing here offers an edit. That
 * is the correct trade for a record of what a centre told a family about their child.
 */
export default async function MessagesPage() {
  const ctx = await requireCtx();
  const db = await serverDb();
  const isStaff = can(ctx.role, 'recordDailyPractice');

  const threads = await listThreads(db, ctx.centre.id);

  // A parent gets only their own children back, which is exactly the list they may start a thread
  // about — so the same call serves both readers.
  const children = await listChildren(db, ctx.centre.id);
  const nameOf = new Map(children.map((c) => [c.id, displayName(c)]));

  const withMessages = await Promise.all(
    threads.map(async (thread) => ({ thread, messages: await listMessages(db, thread.id) })),
  );

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={
          isStaff
            ? `Conversations with ${REO.whanau} at ${ctx.centre.name}.`
            : `With the kaiako at ${ctx.centre.name}.`
        }
      />

      <NewThread
        childOptions={children.map((c) => ({ id: c.id, name: displayName(c) }))}
        isStaff={isStaff}
      />

      {withMessages.length === 0 ? (
        <div className="card">
          <p className="empty">
            {isStaff
              ? 'No conversations yet.'
              : 'Nothing yet. You can start a conversation with the centre above.'}
          </p>
        </div>
      ) : (
        withMessages.map(({ thread, messages }) => (
          <Thread
            key={thread.id}
            thread={thread}
            childName={thread.childId ? (nameOf.get(thread.childId) ?? null) : null}
            messages={messages.map((m) => ({
              id: m.id,
              body: m.body,
              at: m.at,
              readAt: m.readAt,
              mine: m.authorId === ctx.userId,
            }))}
            canClose={isStaff}
          />
        ))
      )}
    </>
  );
}
