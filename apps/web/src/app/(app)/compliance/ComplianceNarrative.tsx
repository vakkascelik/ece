'use client';

import { useState, useTransition } from 'react';
import { generateComplianceNarrative, type NarrativeFigures } from './narrative';

/**
 * A button that turns the figures above it into two or three sentences.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT IS A BUTTON AND NOT SOMETHING THAT RUNS ON LOAD
 *
 * Three reasons, in order of weight.
 *
 * A generated sentence sitting on the compliance dashboard by default becomes part of
 * how the screen reads, and within a fortnight somebody is skimming the prose instead of
 * the table. The table is the product; the prose is a convenience for writing a report.
 * Making it an act keeps the relationship that way round.
 *
 * It costs money per render, and this page is the one a manager leaves open.
 *
 * And it is a cross-border disclosure of aggregate figures. Small, and covered by the
 * privacy statement — but a disclosure that happens because somebody pressed a button is
 * a different thing from one that happens because they opened a page.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT IS LABELLED A DRAFT, PERMANENTLY
 *
 * `unverified-claims` §28 is standing rather than closeable: nothing generated is ever
 * presented as a compliance fact. The label is not decoration and must not be removed to
 * tidy the layout — the whole arrangement rests on a reader knowing which sentences were
 * computed and which were written.
 *
 * `useTransition` rather than `useActionState` because this is not a form: there is
 * nothing to submit, the input is figures the server already rendered, and the result is
 * prose to read rather than state to keep.
 */
export function ComplianceNarrative({ figures }: { figures: NarrativeFigures }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    start(async () => {
      const result = await generateComplianceNarrative(figures);
      if (result.ok) {
        setText(result.text);
      } else {
        setText(null);
        setError(result.error);
      }
    });
  };

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Written summary</h2>
          <p className="sub" style={{ margin: '0.25rem 0 0' }}>
            Turns the figures on this page into a paragraph for a report. It sends counts
            and dates to an overseas service — never a name.
          </p>
        </div>
        <button className="small secondary" type="button" onClick={run} disabled={pending}>
          {pending ? 'Writing…' : text ? 'Write it again' : 'Write a summary'}
        </button>
      </div>

      {error && (
        <p className="error" role="alert" style={{ marginBottom: 0 }}>
          {error}
        </p>
      )}

      {text && (
        <>
          {/*
            The label comes BEFORE the prose, not after it. A caveat underneath is read
            second, if at all, and by then the sentences have already been taken as a
            finding.
          */}
          <p style={{ margin: '0 0 0.5rem' }}>
            <span className="flag flag-quiet">Draft — not a compliance finding</span>
          </p>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
          <p className="sub" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem' }}>
            Written by an automated service from the figures above. Read it before using
            it: the numbers are this system&rsquo;s, the sentences are not.
          </p>
        </>
      )}
    </div>
  );
}
