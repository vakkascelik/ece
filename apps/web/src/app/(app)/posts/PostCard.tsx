'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Post } from '@ece/api';
import { archive, attach, publish, type Result } from './actions';

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
}) {
  const [attaching, setAttaching] = useState(false);
  const [pubState, pubAction, publishing] = useActionState<Result | null, FormData>(publish, null);
  const [archState, archAction, archiving] = useActionState<Result | null, FormData>(archive, null);

  const error =
    (pubState && 'error' in pubState ? pubState.error : null) ??
    (archState && 'error' in archState ? archState.error : null);

  const draft = post.publishedAt === null;

  return (
    <div className="card" style={draft ? { borderStyle: 'dashed' } : undefined}>
      <div className="section-head">
        <div style={{ flex: 1 }}>
          <div className="inline" style={{ marginBottom: '0.35rem' }}>
            <span className="flag flag-quiet">{kindLabel}</span>
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
        </div>
      )}

      {canManage && attaching && (
        <AttachForm postId={post.id} childOptions={childOptions} onDone={() => setAttaching(false)} />
      )}
    </div>
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
