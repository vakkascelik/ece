'use client';

import { useActionState } from 'react';
import { attachEvidencePhoto, removeEvidencePhoto, type Result } from './actions';

export interface DisplayPhoto {
  id: string;
  caption: string | null;
  /** Signed on the server. Null is a malfunction (bad path, storage down), never an access decision. */
  url: string | null;
}

/**
 * Photos on an incident or a checklist run. One component for both because the
 * behaviour is identical: staff-only, attach and remove only while the parent is
 * still working material, frozen with it afterwards.
 *
 * Plain `img` with a signed URL, never `next/image` — the optimiser caches the
 * upstream URL past its signature, the trap recorded in consent-gated-media.md.
 * These photos are not consent-gated, but a 15-minute bearer URL cached for a day
 * is still a hole.
 */
export function EvidencePhotos({
  photos,
  parent,
  locked,
  lockedReason,
}: {
  photos: DisplayPhoto[];
  parent: { kind: 'incident' | 'run'; id: string };
  locked: boolean;
  lockedReason: string;
}) {
  const [attachState, attachAction, attaching] = useActionState<Result | null, FormData>(
    attachEvidencePhoto,
    null,
  );

  const parentField =
    parent.kind === 'incident' ? (
      <input type="hidden" name="incidentId" value={parent.id} />
    ) : (
      <input type="hidden" name="runId" value={parent.id} />
    );

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Photos</h2>

      {photos.length === 0 && <p className="empty">No photos attached.</p>}

      {photos.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {photos.map((p) => (
            <Photo key={p.id} photo={p} parentField={parentField} locked={locked} />
          ))}
        </ul>
      )}

      {locked ? (
        <p className="sub" style={{ marginBottom: 0 }}>
          {lockedReason}
        </p>
      ) : (
        <form action={attachAction} style={{ marginTop: photos.length > 0 ? '0.75rem' : 0 }}>
          {parentField}
          {attachState && 'error' in attachState && (
            <p className="error" role="alert">
              {attachState.error}
            </p>
          )}
          <div className="field">
            <label htmlFor={`photo-${parent.id}`}>Add a photo</label>
            <input
              id={`photo-${parent.id}`}
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`caption-${parent.id}`}>Caption (optional)</label>
            <input id={`caption-${parent.id}`} name="caption" type="text" />
          </div>
          <button className="small" type="submit" disabled={attaching}>
            {attaching ? 'Uploading…' : 'Attach photo'}
          </button>
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            Staff-only documentation. Never shown to families, and separate from the photo
            consent that covers the journal and anything published.
          </p>
        </form>
      )}
    </div>
  );
}

function Photo({
  photo,
  parentField,
  locked,
}: {
  photo: DisplayPhoto;
  parentField: React.ReactNode;
  locked: boolean;
}) {
  const [state, action, removing] = useActionState<Result | null, FormData>(
    removeEvidencePhoto,
    null,
  );

  return (
    <li style={{ maxWidth: '14rem' }}>
      {photo.url ? (
        <img src={photo.url} alt={photo.caption ?? 'Evidence photo'} style={{ width: '100%', borderRadius: '4px' }} />
      ) : (
        // A null URL is storage misbehaving, not permission — the row would not be
        // here otherwise. Said plainly so it gets reported rather than shrugged at.
        <p className="error">This photo could not be loaded. That is a fault, not a setting.</p>
      )}
      {photo.caption && (
        <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
          {photo.caption}
        </p>
      )}
      {!locked && (
        <form action={action} style={{ marginTop: '0.25rem' }}>
          {parentField}
          <input type="hidden" name="photoId" value={photo.id} />
          {state && 'error' in state && (
            <p className="error" role="alert">
              {state.error}
            </p>
          )}
          <button className="small secondary" type="submit" disabled={removing}>
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </form>
      )}
    </li>
  );
}
