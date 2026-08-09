'use client';

/**
 * Download and print, on the screens that produce a document.
 *
 * WHY PRINT IS A BUTTON AND NOT A SENTENCE
 *
 * The binder has said *"use your browser's print dialogue and choose Save as PDF"* since
 * Phase 3. That is accurate and it is an instruction, and an instruction is a thing a
 * manager has to already know they want. `window.print()` is one line and turns the
 * product's only PDF route into something people can find.
 *
 * The sentence stays underneath, because the button opens a dialogue in which "Save as
 * PDF" is a destination somebody still has to choose.
 *
 * WHY THE CSV IS AN ORDINARY LINK
 *
 * It is a GET that returns a file. A link can be middle-clicked, bookmarked, and — the
 * one that matters — it works with JavaScript disabled and on the slow connection where
 * a fetch-and-blob dance silently does nothing. `download` is deliberately absent: the
 * server already sends `Content-Disposition: attachment`, and letting the attribute
 * override the server's filename is how the centre's name falls off it.
 *
 * `.page-actions .btn` is the existing class for exactly this, and its comment in
 * `globals.css` makes the same argument — *"a button that navigates loses middle-click,
 * open-in-new-tab and the status bar preview"*. Reused rather than reinvented; the first
 * draft of this component invented a `button-link` class that did not exist, which is the
 * same mistake the kiosk made with `.button` and fails silently both times.
 *
 * Neither control is printed. A page that prints its own "Print" button is a page
 * somebody has to explain.
 */
export function PageActions({
  csvHref,
  csvLabel = 'Download CSV',
  printLabel = 'Print or save as PDF',
  hint,
  children,
}: {
  csvHref?: string;
  csvLabel?: string;
  printLabel?: string;
  hint?: string;
  /**
   * An extra control for the same row — currently only the Xero export on `/billing`.
   *
   * `children` rather than a second `csvHref2` prop, because the next page that wants a
   * second download will want a different label and a different href, and a numbered
   * prop pair is how a component acquires four of them. One page uses this; if a third
   * ever does, the shape is already right.
   */
  children?: React.ReactNode;
}) {
  return (
    <div className="no-print" style={{ margin: '0 0 1rem' }}>
      <div className="page-actions">
        {csvHref && (
          <a className="btn" href={csvHref}>
            {csvLabel}
          </a>
        )}
        {children}
        <button type="button" className="secondary" onClick={() => window.print()}>
          {printLabel}
        </button>
      </div>
      {hint && (
        <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
