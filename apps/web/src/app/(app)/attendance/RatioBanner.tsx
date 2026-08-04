import type { RatioAssessment } from '@ece/core';

/**
 * The ratio, as the first thing on the page.
 *
 * Three states with three different jobs. `breach` says how many more adults are
 * needed — a flag reading "non-compliant" tells somebody nothing they can act on.
 * `at-limit` is the one the plan asked for: the warning has to arrive while the
 * parent is still at the door, not after the child is in the room.
 *
 * A server component. Nothing here is interactive, and the numbers are derived from
 * the events on every render.
 */
export function RatioBanner({ ratio }: { ratio: RatioAssessment }) {
  const tone = ratio.status === 'breach' ? 'critical' : ratio.status === 'at-limit' ? 'warn' : 'ok';
  const background =
    ratio.status === 'breach'
      ? 'var(--breach-soft)'
      : ratio.status === 'at-limit'
        ? 'var(--warn-soft)'
        : 'var(--ok-soft)';
  const border =
    ratio.status === 'breach'
      ? 'var(--breach-border)'
      : ratio.status === 'at-limit'
        ? 'var(--warn-border)'
        : 'var(--ok-border)';

  return (
    <div className="card" style={{ background, borderColor: border }}>
      {/*
        role=status, not role=alert. This is present on every render, so an assertive
        region would re-announce on each navigation; polite means a screen reader picks
        up a change when it happens without interrupting.
      */}
      <div role="status">
        <div className="inline" style={{ marginBottom: '0.5rem' }}>
          <span className={`flag flag-${tone}`}>
            {ratio.status === 'breach'
              ? `▲ Over ratio — ${ratio.shortfall} more ${ratio.shortfall === 1 ? 'adult' : 'adults'} needed`
              : ratio.status === 'at-limit'
                ? '● At the limit'
                : '✓ Within ratio'}
          </span>
          <span>
            <strong>
              {ratio.adultsPresent} {ratio.adultsPresent === 1 ? 'adult' : 'adults'}
            </strong>{' '}
            for <strong>{ratio.present}</strong> {ratio.present === 1 ? 'child' : 'children'}
            {' '}&mdash; {ratio.underTwo} under 2, {ratio.twoAndOver} aged 2 and over. Requires{' '}
            {ratio.adultsRequired}.
          </span>
        </div>

        {ratio.warning && <p style={{ margin: '0 0 0.5rem' }}>{ratio.warning}</p>}

        {ratio.status === 'ok' && ratio.present > 0 && (
          <p className="sub" style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem' }}>
            Room for {ratio.headroomUnderTwo} more under 2 and {ratio.headroomTwoAndOver} more
            aged 2 or over before another adult is needed.
          </p>
        )}
      </div>

      {/*
        The rule being applied, so a manager can point at it. Asked for by the plan, and
        it is the difference between a number and a compliance tool.
      */}
      {ratio.citations.length > 0 && (
        <details style={{ fontSize: '0.8125rem' }}>
          <summary className="sub" style={{ cursor: 'pointer' }}>
            Which rule is this?
          </summary>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {ratio.citations.map((c) => (
              <li key={c} className="sub">
                {c}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/*
        Shown until somebody has checked the bands against Schedule 2 and flipped
        RATIO_TABLES_VERIFIED. A compliance figure that might be wrong has to say so;
        the alternative is a manager relying on a number nobody has verified.
      */}
      {!ratio.verified && ratio.present > 0 && (
        <p
          className="flag flag-warn"
          style={{ marginTop: '0.5rem', whiteSpace: 'normal', display: 'block' }}
        >
          {'◌'} These ratio figures have not been checked against the regulations yet.
          Treat them as a prompt, not as confirmation you are compliant.
        </p>
      )}
    </div>
  );
}
