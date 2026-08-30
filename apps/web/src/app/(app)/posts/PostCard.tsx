'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Post, PostComment } from '@ece/api';
import { COMMENT_MODE_LABELS } from '@ece/core';
import {
  archive,
  attach,
  comment,
  commentMode,
  moderate,
  pin,
  publish,
  type Result,
} from './actions';

interface MediaView {
  id: string;
  kind: string;
  audience: string;
  caption: string | null;
  /** Null when a URL could not be signed — which for a private bucket means "not for you". */
  url: string | null;
}

export function PostCard({
  post,
  kindLabel,
  childNames,
  media,
  canManage,
  canSteward,
  childOptions,
  comments,
  canModerate,
  viewerId,
}: {
  post: Post;
  kindLabel: string;
  childNames: string[];
  media: MediaView[];
  /** Staff: may attach media and see drafts. */
  canManage: boolean;
  /**
   * May publish or archive **this** post: its author, or an owner/manager of the centre.
   *
   * Separate from `canManage` because they were conflated, and the policy was not. Every staff
   * member was offered Publish on every draft while `posts_write_update` allowed only the author —
   * so an educator pressing Publish on a colleague's post got a bare 42501. 0028 widened the policy
   * to owners and managers; this stops the button being offered to the one case that is still
   * correctly refused, an educator acting on somebody else's post.
   */
  canSteward: boolean;
  childOptions: { id: string; name: string }[];
  /** 0076. Approved ones, plus the reader's own, plus the pending queue for staff. */
  comments: PostComment[];
  /** Staff at this centre: may approve or decline. */
  canModerate: boolean;
  /** To mark the reader's own comments. Names of other people are deliberately absent — see below. */
  viewerId: string | null;
}) {
  const [attaching, setAttaching] = useState(false);
  const [pubState, pubAction, publishing] = useActionState<Result | null, FormData>(publish, null);
  const [archState, archAction, archiving] = useActionState<Result | null, FormData>(archive, null);
  const [pinState, pinAction, pinning] = useActionState<Result | null, FormData>(pin, null);

  const error =
    (pubState && 'error' in pubState ? pubState.error : null) ??
    (archState && 'error' in archState ? archState.error : null) ??
    (pinState && 'error' in pinState ? pinState.error : null);

  const draft = post.publishedAt === null;

  return (
    <div className="card" style={draft ? { borderStyle: 'dashed' } : undefined}>
      <div className="section-head">
        <div style={{ flex: 1 }}>
          <div className="inline" style={{ marginBottom: '0.35rem' }}>
            <span className="flag flag-quiet">{kindLabel}</span>
            {post.pinnedAt && <span className="flag flag-quiet">Pinned</span>}
            {draft && <span className="flag flag-warn">{'◌'} Draft — not sent to whānau</span>}
            {!draft && (
              <span className="sub" style={{ fontSize: '0.8125rem' }}>
                {new Date(post.publishedAt!).toLocaleString('en-NZ')}
              </span>
            )}
          </div>
          <h2 style={{ fontSize: '1.0625rem', margin: '0 0 0.25rem' }}>{post.title}</h2>
          {childNames.length > 0 && (
            <p className="sub" style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem' }}>
              About {childNames.join(', ')}
            </p>
          )}
          <p style={{ margin: '0 0 0.5rem', whiteSpace: 'pre-wrap' }}>{post.body}</p>
        </div>
      </div>

      {media.length > 0 && (
        <div className="inline" style={{ marginBottom: '0.5rem', alignItems: 'flex-start' }}>
          {media.map((m) =>
            m.url ? (
              <figure key={m.id} style={{ margin: 0, maxWidth: '14rem' }}>
                {m.kind === 'photo' ? (
                  /*
                    A plain `img`, not `next/image`, and deliberately.
                    `next/image` proxies through the Next optimiser, which fetches and **caches**
                    the upstream URL. Caching a photograph of a child behind a short-lived signed
                    URL would outlive both the signature and the consent that permitted it — the
                    image would keep being served from the optimiser's cache after a family
                    withdrew consent, which is precisely what the restrictive policy prevents at
                    every other layer.
                  */
                  <img
                    src={m.url}
                    alt={m.caption ?? 'Photo from the centre'}
                    style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--line)' }}
                  />
                ) : (
                  <a href={m.url}>Open {m.kind}</a>
                )}
                {m.caption && (
                  <figcaption className="sub" style={{ fontSize: '0.8125rem' }}>
                    {m.caption}
                  </figcaption>
                )}
                {m.audience === 'public' && (
                  <span className="flag flag-warn">{'●'} shared publicly</span>
                )}
              </figure>
            ) : (
              /*
                A row we can read but a file we cannot sign. Rare — normally the row is gone
                too — and worth showing rather than rendering a broken image.
              */
              <span key={m.id} className="flag flag-quiet">
                {'◌'} a file that is not available
              </span>
            ),
          )}
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {canManage && (
        <div className="inline">
          {draft && canSteward && (
            <form action={pubAction}>
              <input type="hidden" name="postId" value={post.id} />
              <button className="small" type="submit" disabled={publishing}>
                {publishing ? 'Publishing…' : 'Publish to whānau'}
              </button>
            </form>
          )}
          <button className="secondary small" type="button" onClick={() => setAttaching((v) => !v)}>
            Add a photo
          </button>
          {/* Archive is an UPDATE too, so the same permission decides it. Offering it to an
              educator on a colleague's post produced a bare 42501 from the policy. */}
          {canSteward && (
            <form action={archAction}>
              <input type="hidden" name="postId" value={post.id} />
              <button className="secondary small" type="submit" disabled={archiving}>
                Archive
              </button>
            </form>
          )}
          {/* Only for a published post: pinning a draft would put nothing at the top of a
              feed nobody outside the staffroom can see. */}
          {canSteward && !draft && (
            <form action={pinAction}>
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="pinned" value={post.pinnedAt ? 'false' : 'true'} />
              <button className="secondary small" type="submit" disabled={pinning}>
                {post.pinnedAt ? 'Unpin' : 'Pin to top'}
              </button>
            </form>
          )}
        </div>
      )}

      {canManage && attaching && (
        <AttachForm postId={post.id} childOptions={childOptions} onDone={() => setAttaching(false)} />
      )}

      {!draft && (
        <Comments
          post={post}
          comments={comments}
          canModerate={canModerate}
          viewerId={viewerId}
        />
      )}
    </div>
  );
}

/**
 * The comment thread. 0076.
 *
 * WHY NOBODY'S NAME IS ON ANYBODY ELSE'S COMMENT
 *
 * Educa shows them. This does not, yet, and the omission is deliberate rather than
 * unfinished. A pānui at Little Pearls reaches 275 guardians; rendering each commenter's
 * name to all the others would publish a slice of the family roster to every family, and
 * nothing else in this product shows one parent another parent's name. Resolving names
 * would also need a read a parent does not have. "You" is shown on the reader's own
 * comments, which is the part that can be answered without deciding that question.
 *
 * It IS a gap against the incumbent and it is written down as one — see the wiki. The
 * decision belongs to the centre, not to whoever wrote this component.
 */
function Comments({
  post,
  comments,
  canModerate,
  viewerId,
}: {
  post: Post;
  comments: PostComment[];
  canModerate: boolean;
  viewerId: string | null;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(comment, null);
  const [modeState, modeAction, savingMode] = useActionState<Result | null, FormData>(
    commentMode,
    null,
  );
  const error =
    (state && 'error' in state ? state.error : null) ??
    (modeState && 'error' in modeState ? modeState.error : null);

  const visible = comments.filter((c) => c.declinedAt === null);
  const approved = visible.filter((c) => c.approvedAt !== null);
  const waiting = visible.filter((c) => c.approvedAt === null);

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
      <h3 style={{ fontSize: '0.8125rem', margin: '0 0 0.5rem', color: 'var(--muted)' }}>
        {approved.length === 0 ? 'Comments' : `Comments (${approved.length})`}
      </h3>

      <ul className="stack" style={{ marginBottom: waiting.length || approved.length ? '0.75rem' : 0 }}>
        {approved.map((c) => (
          <li key={c.id}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.body}</p>
            <span className="sub" style={{ fontSize: '0.75rem' }}>
              {c.authorId && c.authorId === viewerId ? 'You · ' : ''}
              {new Date(c.createdAt).toLocaleString('en-NZ')}
            </span>
          </li>
        ))}
        {waiting.map((c) => (
          <li key={c.id}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.body}</p>
            <div className="inline" style={{ marginTop: '0.25rem' }}>
              {/*
                A parent seeing this on their own comment is the point: the alternative is
                typing something that silently never appears.
              */}
              <span className="flag flag-warn">{'◌'} Waiting for a kaiako</span>
              {canModerate && (
                <>
                  <ModerateButton commentId={c.id} decision="approve" label="Approve" />
                  <ModerateButton commentId={c.id} decision="decline" label="Decline" />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {post.commentMode === 'disabled' ? (
        <p className="empty">Comments are turned off for this post.</p>
      ) : (
        <form action={action} className="inline" style={{ alignItems: 'flex-start' }}>
          <input type="hidden" name="postId" value={post.id} />
          <label className="visually-hidden" htmlFor={`comment-${post.id}`}>
            Add a comment
          </label>
          <input
            className="wide"
            id={`comment-${post.id}`}
            name="body"
            placeholder="Say something to the centre…"
          />
          <button className="small" type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}

      {post.commentMode === 'approved_first' && (
        <p className="sub" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
          A kaiako reads each comment before it appears.
        </p>
      )}

      {canModerate && (
        <form action={modeAction} className="inline" style={{ marginTop: '0.5rem' }}>
          <input type="hidden" name="postId" value={post.id} />
          <label className="visually-hidden" htmlFor={`mode-${post.id}`}>
            Comment setting
          </label>
          <select id={`mode-${post.id}`} name="mode" defaultValue={post.commentMode}>
            {Object.entries(COMMENT_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="secondary small" type="submit" disabled={savingMode}>
            {savingMode ? 'Saving…' : 'Save setting'}
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ModerateButton({
  commentId,
  decision,
  label,
}: {
  commentId: string;
  decision: 'approve' | 'decline';
  label: string;
}) {
  const [, action, pending] = useActionState<Result | null, FormData>(moderate, null);
  return (
    <form action={action}>
      <input type="hidden" name="commentId" value={commentId} />
      <input type="hidden" name="decision" value={decision} />
      <button
        className={decision === 'approve' ? 'small' : 'secondary small'}
        type="submit"
        disabled={pending}
      >
        {pending ? '…' : label}
      </button>
    </form>
  );
}

/**
 * Attaching a photo.
 *
 * Naming the children is required, because that is what the consent check needs — untagged media
 * would bypass the gate entirely. If a named child has no photo consent the upload is rolled back
 * and the database's own message is shown, which already names them and says what to do.
 */
function AttachForm({
  postId,
  childOptions,
  onDone,
}: {
  postId: string;
  childOptions: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(attach, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form
      action={action}
      style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}
    >
      <input type="hidden" name="postId" value={postId} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor={`file-${postId}`}>Photo</label>
            <input id={`file-${postId}`} name="file" type="file" accept="image/*,video/mp4,application/pdf" required />
          </div>
          <div>
            <label htmlFor={`audience-${postId}`}>Where it will be used</label>
            <select id={`audience-${postId}`} name="audience" defaultValue="journal">
              <option value="journal">Their journal only</option>
              <option value="public">Shared publicly</option>
            </select>
          </div>
        </div>

        <div>
          <label>Who is in it</label>
          <div className="days">
            {childOptions.map((c) => (
              <label key={c.id}>
                <input type="checkbox" name="childIds" value={c.id} />
                {c.name}
              </label>
            ))}
          </div>
          <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
            {/*
              Not a tagging nicety. Consent is per child, so this is the list the gate checks —
              and "shared publicly" needs a different consent from the journal.
            */}
            Consent is checked for each of them. A child without the right consent will stop the
            upload, and nothing will be saved.
          </p>
        </div>

        <div>
          <label htmlFor={`caption-${postId}`}>Caption</label>
          <input className="wide" id={`caption-${postId}`} name="caption" />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Uploading…' : 'Add'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
