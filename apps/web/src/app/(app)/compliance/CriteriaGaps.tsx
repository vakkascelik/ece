import type { CriteriaSet, Criterion } from '@ece/api';

/**
 * Which criteria have evidence against them, and which do not.
 *
 * **The empty state is the important one.** This repo ships with no criteria, because
 * the licensing criteria are a published document that was renumbered in 2026 and
 * inventing plausible criterion numbers would let a centre assemble a binder against a
 * list that looks official and is not.
 *
 * So when nothing is loaded this says so, loudly, rather than rendering an empty table
 * — a gap list with no rows reads as a clean bill of health, which is the exact wrong
 * message.
 */
export function CriteriaGaps({
  set,
  criteria,
  evidence,
}: {
  set: CriteriaSet | null;
  criteria: Criterion[];
  evidence: { id: string; criterionId: string | null }[];
}) {
  if (!set || criteria.length === 0) {
    return (
      <div className="card" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)' }}>
        <p style={{ marginTop: 0 }}>
          <span className="flag flag-warn">{'◌'} No licensing criteria loaded</span>
        </p>
        <p style={{ marginBottom: '0.5rem' }}>
          This installation has no criteria set, so nothing can be checked against one. That
          is the shipped state, not a fault: the criteria are a published document and this
          product does not include a copy, because a plausible-looking invented criterion
          would be worse than none.
        </p>
        <p className="sub" style={{ marginBottom: 0, fontSize: '0.8125rem' }}>
          Load a set that somebody has checked against the real document:
          <br />
          <code>npm run import:criteria -- criteria.json --make-current</code>
          <br />
          The file records where the criteria came from, and each entry can carry the code
          it superseded — which is what keeps evidence filed under the old numbering
          findable.
        </p>
      </div>
    );
  }

  const covered = new Set(evidence.map((e) => e.criterionId).filter((id): id is string => id !== null));
  const byCategory = new Map<string, Criterion[]>();
  for (const c of criteria) {
    const list = byCategory.get(c.category);
    if (list) list.push(c);
    else byCategory.set(c.category, [c]);
  }

  const gaps = criteria.filter((c) => !covered.has(c.id));

  return (
    <>
      <div className="card">
        <div className="inline" role="status">
          {gaps.length === 0 ? (
            <span className="flag flag-ok">
              {'✓'} Every criterion has something filed against it
            </span>
          ) : (
            <span className="flag flag-warn">
              {'●'} {gaps.length} of {criteria.length} criteria have no evidence
            </span>
          )}
          <span className="sub">
            {set.name}
            {set.effectiveFrom ? ` · effective ${set.effectiveFrom}` : ''}
          </span>
        </div>
        <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
          Source: {set.source}
        </p>
        {/*
          Having something filed is not the same as being compliant. Saying so here stops
          the tick above being read as an assessment.
        */}
        <p className="sub" style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem' }}>
          This counts whether evidence is attached, not whether it is adequate. Only a
          reviewer decides the second.
        </p>
      </div>

      {[...byCategory.entries()].map(([category, items]) => {
        const missing = items.filter((c) => !covered.has(c.id));
        return (
          <div className="card" key={category}>
            <div className="section-head" style={{ marginBottom: '0.5rem' }}>
              <strong>{category}</strong>
              <span className="sub" style={{ fontSize: '0.8125rem' }}>
                {items.length - missing.length} of {items.length} covered
              </span>
            </div>
            {missing.length === 0 ? (
              <p className="empty" style={{ margin: 0 }}>
                All covered.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {missing.map((c) => (
                  <li key={c.id} style={{ marginBottom: '0.25rem' }}>
                    <strong>{c.code}</strong> {c.title}
                    {c.supersedesCode && (
                      <span className="sub" style={{ fontSize: '0.8125rem' }}>
                        {' '}
                        (was {c.supersedesCode} — evidence may be filed under that)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
