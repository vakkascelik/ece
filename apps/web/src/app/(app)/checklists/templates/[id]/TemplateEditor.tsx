'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  CHECKLIST_RESPONSES,
  CHECKLIST_RESPONSE_LABELS,
  type ChecklistItem,
  type ChecklistTemplate,
  type ChecklistVersion,
} from '@ece/core';
import {
  addItem,
  deleteItem,
  editTemplate,
  publishVersion,
  reviseTemplate,
  type Result,
} from '../../actions';

export function TemplateEditor({
  template,
  version,
  items,
  canRevise,
}: {
  template: ChecklistTemplate;
  version: ChecklistVersion;
  items: ChecklistItem[];
  canRevise: boolean;
}) {
  const draft = version.publishedAt === null;

  return (
    <>
      {!draft && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
            <span className="flag flag-ok">{'✓'} Published</span>{' '}
            <span className="sub">
              These questions cannot be changed. Every completed run points at this version, so
              editing it would rewrite what those people were actually asked.
            </span>
          </p>
          {canRevise && <ReviseForm templateId={template.id} fromVersionId={version.id} />}
        </div>
      )}

      <h2>Questions</h2>
      <div className="card">
        {items.length === 0 ? (
          <p className="empty">No questions yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: '1%' }}>#</th>
                <th>Question</th>
                <th>Answered with</th>
                <th>Required</th>
                {draft && (
                  <th style={{ width: '1%' }}>
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{item.prompt}</strong>
                    {item.guidance && (
                      <div className="sub" style={{ fontSize: '0.8125rem' }}>
                        {item.guidance}
                      </div>
                    )}
                  </td>
                  <td>{CHECKLIST_RESPONSE_LABELS[item.responseType]}</td>
                  <td>
                    {item.required ? (
                      <span className="flag flag-quiet">Required</span>
                    ) : (
                      <span className="empty">Optional</span>
                    )}
                  </td>
                  {draft && (
                    <td>
                      <RemoveItem id={item.id} versionId={version.id} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {draft && <AddItemForm versionId={version.id} nextSort={(items.length + 1) * 10} />}
      </div>

      {draft && (
        <>
          <h2>Publish</h2>
          <div className="card">
            <PublishForm versionId={version.id} itemCount={items.length} />
          </div>
        </>
      )}

      <h2>Settings</h2>
      <div className="card">
        <SettingsForm template={template} />
      </div>

      <p style={{ marginTop: '1rem' }}>
        <Link href="/checklists">Back to checklists</Link>
      </p>
    </>
  );
}

function AddItemForm({ versionId, nextSort }: { versionId: string; nextSort: number }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addItem, null);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }} key={nextSort}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="sort" value={nextSort} />

      <div className="field">
        <label htmlFor="prompt">Question</label>
        <input id="prompt" name="prompt" type="text" required placeholder="Is the gate latched?" />
      </div>

      <div className="field">
        <label htmlFor="guidance">Guidance (optional)</label>
        <input id="guidance" name="guidance" type="text" placeholder="Check the latch and the hinge" />
      </div>

      <div className="field">
        <label htmlFor="responseType">Answered with</label>
        <select id="responseType" name="responseType" defaultValue="yes_no">
          {CHECKLIST_RESPONSES.map((r) => (
            <option key={r} value={r}>
              {CHECKLIST_RESPONSE_LABELS[r]}
            </option>
          ))}
        </select>
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Yes / No / N/A when “not applicable” is a real answer — a sandpit check on the day the
          sandpit is being replaced is not a failure, and recording it as one teaches people to
          ignore the register.
        </p>
      </div>

      <div className="field">
        <label>
          <input type="checkbox" name="required" defaultChecked /> Required
        </label>
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          A run cannot be signed off while a required question is unanswered.
        </p>
      </div>

      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add question'}
      </button>
    </form>
  );
}

function RemoveItem({ id, versionId }: { id: string; versionId: string }) {
  const [, action, pending] = useActionState<Result | null, FormData>(deleteItem, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="versionId" value={versionId} />
      <button className="small secondary" type="submit" disabled={pending}>
        Remove
      </button>
    </form>
  );
}

function PublishForm({ versionId, itemCount }: { versionId: string; itemCount: number }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(publishVersion, null);

  return (
    <form action={action}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="versionId" value={versionId} />
      <p className="sub" style={{ marginTop: 0 }}>
        Publishing makes this the form your team fills in. After that the questions are fixed —
        changing them means a new version, so what people were asked stays readable as it was
        asked.
      </p>
      <button type="submit" disabled={pending || itemCount === 0}>
        {pending ? 'Publishing…' : 'Publish this version'}
      </button>
      {itemCount === 0 && (
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          Add at least one question first. A checklist with none is a button that records nothing.
        </p>
      )}
    </form>
  );
}

function ReviseForm({ templateId, fromVersionId }: { templateId: string; fromVersionId: string }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(reviseTemplate, null);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="fromVersionId" value={fromVersionId} />
      <button className="secondary small" type="submit" disabled={pending}>
        {pending ? 'Copying…' : 'Start a new version from this one'}
      </button>
    </form>
  );
}

function SettingsForm({ template }: { template: ChecklistTemplate }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(editTemplate, null);

  return (
    <form action={action}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state && 'ok' in state && (
        <p className="sub" role="status">
          Saved.
        </p>
      )}

      <input type="hidden" name="id" value={template.id} />

      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required defaultValue={template.name} />
      </div>

      <div className="field">
        <label htmlFor="folder">Group</label>
        <input id="folder" name="folder" type="text" defaultValue={template.folder ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="recurDays">How often, in days</label>
        <input
          id="recurDays"
          name="recurDays"
          type="number"
          min={1}
          max={730}
          defaultValue={template.recurDays ?? ''}
        />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Blank means no set interval, and the checklist then shows how long it has been without
          being called late.
        </p>
      </div>

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
