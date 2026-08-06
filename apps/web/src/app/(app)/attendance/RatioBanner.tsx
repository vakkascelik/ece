import type { RatioAssessment } from '@ece/core';

/**
 * The ratio, as the first thing on the page — screens 2 and 3 of the design pack.
 *
 * Three states with three different jobs. `breach` says how many more adults are
 * needed, because a flag reading "non-compliant" tells somebody nothing they can act
 * on. `at-limit` is the one the plan asked for: the warning has to arrive while the
 * parent is still at the door, not after the child is in the room.
 *
 * A server component. Nothing here is interactive and the numbers are derived from the
 * events on every render — there is no stored "present" flag and no cached ratio,
 * because a counter drifts on a missed sign-out and a drifting ratio reports itself as
 * compliant.
 *
 * ON THE TRACK, AND A DEVIATION FROM THE PACK
 *
 * The pack's sample block reads "88% of the adults recorded today" under an 88% fill,
 * against 4 kaiako where 4 are required — which is 100% of the adults, so the sentence
 * cannot be describing the bar it sits under. Rather than reproduce a caption that
 * misdescribes its own bar in a compliance product, the fill here is **occupancy
 * toward the limit**: how full the roll is against the most tamariki these adults can
 * cover if the next arrivals are aged 2 and over. The caption says exactly that.
 * Recorded in llm-wiki/wiki/design-system.md.
 */
export function RatioBanner({
  ratio,
  wall = false,
}: {
  ratio: RatioAssessment;
  /** Screen 13: the same block, sized to be read from three metres. */
  wall?: boolean;
}) {
  const state =
    ratio.status === 'breach' ? 'breach' : ratio.status === 'at-limit' ? 'limit' : 'ok';

  const pill =
    ratio.status === 'breach'
      ? `▲ Ratio breach — ${ratio.shortfall} more ${ratio.shortfall === 1 ? 'adult' : 'adults'} needed`
      : ratio.status === 'at-limit'
        ? '▲ At limit'
        : '✓ Within ratio';

  // Capacity if the next tamariki are aged 2 and over. In breach the roll is already
  // past what these adults cover, so the track is full and the overflow segment shows.
  const capacity = ratio.present + ratio.headroomTwoAndOver;
  const fill =
    ratio.status === 'breach' || capacity === 0
      ? 100
      : Math.min(100, Math.round((ratio.present / capacity) * 100));

  return (
    <div className={wall ? `ratio ratio-${state} ratio-wall` : `ratio ratio-${state}`}>
      {/*
        role=status, not role=alert. This is present on every render, so an assertive
        region would re-announce on each navigation; polite means a screen reader picks
        up a change when it happens without interrupting.
      */}
      <div role="status" aria-live="polite" className="ratio-head">
        <span className="ratio-pill">{pill}</span>
        <span className="ratio-counts">
          {ratio.adultsPresent} kaiako ·{' '}
          {ratio.present} {ratio.present === 1 ? 'tamaiti' : 'tamariki'}
        </span>
        <span className="ratio-detail">
          {ratio.underTwo} under 2 · {ratio.twoAndOver} aged 2 and over · requires{' '}
          {ratio.adultsRequired}
        </span>
      </div>

      {/*
        aria-hidden: the sentence below carries the same information in words, and a
        screen reader announcing a bar twice is noise. The pack's annotation asks for
        exactly this.
      */}
      {ratio.status === 'breach' ? (
        <div className="ratio-overflow-wrap" aria-hidden="true">
          <div className="ratio-track">
            <div className="ratio-fill" style={{ width: '100%' }} />
          </div>
          <div className="ratio-over" />
        </div>
      ) : (
        <div className="ratio-track" aria-hidden="true">
          <div className="ratio-fill" style={{ width: `${fill}%` }} />
        </div>
      )}

      {ratio.warning && <p className="ratio-note">{ratio.warning}</p>}

      {ratio.status !== 'breach' && ratio.present > 0 && (
        <p className="ratio-note">
          {fill}% of what {ratio.adultsPresent} kaiako can cover. Headroom for {ratio.headroomTwoAndOver} more{' '}
          {ratio.headroomTwoAndOver === 1 ? 'tamaiti' : 'tamariki'} aged 2 and over
          {ratio.headroomUnderTwo > 0 && `, or ${ratio.headroomUnderTwo} under 2`}.
        </p>
      )}

      {/*
        The rule being applied, so a manager can point at it. Asked for by the plan, and
        it is the difference between a number and a compliance tool.
      */}
      {ratio.citations.length > 0 && (
        <details style={{ fontSize: 'var(--text-sm)' }}>
          <summary style={{ cursor: 'pointer' }}>Which rule is this?</summary>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {ratio.citations.map((c) => (
              <li key={c}>{c}</li>
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
        <p className="flag flag-warn" style={{ whiteSpace: 'normal', display: 'block', margin: 0 }}>
          {'◌'} These ratio figures have not been checked against the regulations yet. Treat them
          as a prompt, not as confirmation you are compliant.
        </p>
      )}
    </div>
  );
}
