'use client';

import { useActionState } from 'react';
import { IDENTITY_DOCUMENT_KIND_MAX } from '@ece/core';
import { recordIdentityDocument, removeIdentityDocument, type Result } from '../actions';

/**
 * One row, with its instant already turned into a date.
 *
 * **`sightedLabel` is formatted by the server in the centre's timezone, and that is not a style
 * choice.** The first draft of this panel rendered `sightedAt.slice(0, 10)` — the date part of the
 * stored UTC instant. In New Zealand that is *yesterday* for anything sighted before noon, because
 * 09:00 NZDT is 20:00 UTC the previous day. So a passport checked on Tuesday morning would have
 * been recorded on screen as Monday, on the record that exists to say when somebody looked.
 *
 * Caught by writing the end-to-end test rather than by reading the code, which is the argument for
 * the test. `llm-wiki/wiki/conventions.md` records that **every date bug in this repository has come
 * from computing a calendar day in the wrong zone**; this is one more, and the fix is the one
 * `ImmunisationPanel` already uses — the server formats, the client renders.
 */
export interface IdentityDocumentRow {
  id: string;
  kind: string | null;
  /** `null` means nothing was sighted. Non-null means somebody looked, on this date. */
  sightedLabel: string | null;
  /**
   * Who looked, where this caller may know. `null` alongside a non-null `sightedLabel` means
   * somebody did look and their name is not available here — a colleague who has since left, or a
   * guardian reading the record, who is not shown staff email addresses.
   */
  sightedBy: string | null;
  note: string | null;
}

/**
 * That somebody looked at a document proving who this child is — `child_identity_documents` (0097).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THERE IS NO DOCUMENT-NUMBER BOX, WHICH IS THE FIRST THING ANYBODY WILL ASK FOR
 *
 * `0097` argues it and this screen has to carry the argument, because the absence looks like an
 * oversight and is not one. A practising certificate number is a professional registration and
 * belongs on a staff record; **a child's passport number is not that**, and whether the NSI
 * interface transmits one at all is in a specification nobody here has read.
 *
 * The evidence `AST28` asks for is that an identification document *is present*. That question is
 * answered by a person, a date and a document type. Storing the number would add a highly sensitive
 * identifier to a database, on a guess about a wire format, to answer a question that does not need
 * it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "SIGHTED" MEANS YOU LOOKED, AND IT RECORDS YOU
 *
 * The checkbox stamps the signed-in person and the current time — it cannot name somebody else and
 * cannot be back-dated. Both are deliberate and both are argued in `recordIdentityDocument`:
 * letting a form nominate who did the looking turns a first-hand assertion into hearsay attributed
 * to a colleague, and a back-dated sighting is a different claim that `0097`'s CHECK cannot tell
 * apart from a real one.
 *
 * So if a colleague sighted the passport, **they** record it. That is a constraint on the workflow,
 * and the panel says so rather than letting somebody discover it from an audit row.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LIST, NOT A SLOT
 *
 * Re-checking a document next year is a new entry, not an edit of the old one. The history is the
 * evidence: "a birth certificate was sighted" is worth little without who and when, and an entry
 * that overwrote last year's check would destroy exactly the part an auditor reads.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DOCUMENT TYPE IS FREE TEXT AND THAT IS NOT LAZINESS
 *
 * `kind` is a `LookupCode` from the NSI specification — a 1-to-10 character code against a list the
 * Ministry has not published to us. `code_sets` reserves the domain and ships it **empty**, the same
 * treatment `0080`'s nine code sets get. A dropdown here would be an invented identity vocabulary on
 * a Crown interface, which is the one thing this product refuses to do; so the field is free text,
 * bounded at ten characters, with the reason on the screen.
 */
export function IdentityDocumentsPanel({
  childId,
  documents,
  canEdit,
}: {
  childId: string;
  documents: IdentityDocumentRow[];
  canEdit: boolean;
}) {
  const [addState, add, adding] = useActionState<Result | null, FormData>(
    recordIdentityDocument,
    null,
  );
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeIdentityDocument,
    null,
  );

  return (
    <section>
      <h2>Identity documents</h2>
      <p className="sub">
        That somebody here looked at a document proving who this child is. <strong>The document
        number is deliberately not stored</strong> — what the record needs is that a document was
        seen, by whom, and when.
      </p>

      {documents.length === 0 ? (
        <p>
          <em>Nothing recorded.</em> No identity document has been logged as sighted for this child.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Document type</th>
              <th>Sighted</th>
              <th>By</th>
              <th>Note</th>
              {canEdit && <th>Change</th>}
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>{d.kind ?? <span className="empty">not stated</span>}</td>
                <td>
                  {d.sightedLabel ?? (
                    /*
                      NOT a blank cell. "Recorded, and nobody has seen it" is a real and useful
                      state — a note that a birth certificate exists somewhere is not evidence that
                      anybody checked it — and an empty cell would read as missing data rather than
                      as the answer.
                    */
                    <span className="empty">not sighted</span>
                  )}
                </td>
                <td>
                  {d.sightedLabel === null ? (
                    <span className="empty">—</span>
                  ) : (
                    (d.sightedBy ?? <span className="empty">not shown</span>)
                  )}
                </td>
                <td>{d.note ?? <span className="empty">—</span>}</td>
                {canEdit && (
                  <td>
                    <form action={remove} className="inline">
                      <input type="hidden" name="childId" value={childId} />
                      <input type="hidden" name="documentId" value={d.id} />
                      <button type="submit" className="link" disabled={removing}>
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removeState && 'error' in removeState && (
        <p role="alert" className="error">
          {removeState.error}
        </p>
      )}

      {canEdit && (
        <form action={add} className="stack">
          <input type="hidden" name="childId" value={childId} />

          {/*
            "Document type", not "Type" — `DetailsForm` and `HealthPanel` both live on this record
            and Playwright's `getByLabel` matches on SUBSTRING, so a bare `Type` would resolve more
            than one element and break strict mode before any assertion ran. The same class of
            failure the off-floor form hit with `Who`, avoided this time by naming it rather than
            by discovering it.
          */}
          <label htmlFor="identity-kind">Document type</label>
          <input
            id="identity-kind"
            name="kind"
            maxLength={IDENTITY_DOCUMENT_KIND_MAX}
            placeholder="e.g. PASSPORT"
            autoComplete="off"
          />
          <p className="sub">
            A Ministry code, up to {IDENTITY_DOCUMENT_KIND_MAX} characters. There is no list to
            choose from: the Ministry has not published the codes for this field, so this product
            records what you type rather than offering an invented vocabulary. Leave it empty if the
            type was not stated.
          </p>

          <label htmlFor="identity-sighted">
            <input id="identity-sighted" type="checkbox" name="sighted" /> I have seen this document
          </label>
          <p className="sub">
            Ticking this records <strong>you</strong>, now. It cannot name somebody else and cannot
            be back-dated — if a colleague saw the document, they record it.
          </p>

          <label htmlFor="identity-note">Note</label>
          <input id="identity-note" name="note" autoComplete="off" />

          <div>
            <button type="submit" disabled={adding}>
              {adding ? 'Recording…' : 'Record document'}
            </button>
          </div>

          {addState && 'error' in addState && (
            <p role="alert" className="error">
              {addState.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
