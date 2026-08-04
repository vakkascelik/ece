import type { BreachPeriod } from '@ece/core';

/**
 * Seven days of ratio, replayed from the events.
 *
 * The evidence a centre could not previously produce without going through paper sign-in
 * sheets by hand — and the payoff for building attendance before compliance.
 *
 * A server component: nothing here is interactive, and every figure is derived on each
 * render rather than stored. A cached compliance number that drifts from the events does
 * not report itself as broken, it reports itself as compliant.
 */
export function RatioHistory({
  days,
  unverified,
}: {
  days: {
    date: string;
    summary: string;
    breaches: BreachPeriod[];
    events: number;
    worstShortfall: number;
    minutesInBreach: number | null;
  }[];
  unverified: boolean;
}) {
  const withData = days.filter((d) => d.events > 0);

  return (
    <div className="card">
      {withData.length === 0 ? (
        <p className="empty">
          No attendance recorded in the last seven days, so there is no ratio history to show.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Events</th>
              <th>Breaches</th>
              <th>Over ratio</th>
              <th>Worst</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.events === 0 ? <span className="empty">none</span> : day.events}</td>
                <td>
                  {day.events === 0 ? (
                    <span className="empty">&mdash;</span>
                  ) : day.breaches.length === 0 ? (
                    <span className="flag flag-ok">{'✓'} none recorded</span>
                  ) : (
                    <span className="flag flag-critical">
                      {'▲'} {day.breaches.length}
                    </span>
                  )}
                </td>
                <td>
                  {day.breaches.length === 0 ? (
                    <span className="empty">&mdash;</span>
                  ) : day.minutesInBreach === null ? (
                    // Not zero, and not a guess. A breach still open at the last event of
                    // the day has no end time, and inventing one would understate it.
                    <span className="flag flag-warn">still open at the last event</span>
                  ) : (
                    `${day.minutesInBreach} min`
                  )}
                </td>
                <td>
                  {day.worstShortfall > 0 ? (
                    `${day.worstShortfall} adult${day.worstShortfall === 1 ? '' : 's'} short`
                  ) : (
                    <span className="empty">&mdash;</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        Said explicitly, because the difference matters in a document somebody signs.
        The events record who was signed in; a child who was present and never signed in
        is invisible here, so this cannot claim compliance — only that no breach was
        recorded.
      */}
      <p className="sub" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem' }}>
        Derived from sign-in events and recorded adult counts. &ldquo;None recorded&rdquo;
        means no breach appears in the data, which is not the same as a guarantee that
        ratios were kept — a child present but never signed in does not appear here.
      </p>

      {unverified && (
        <p className="flag flag-warn" style={{ marginTop: '0.5rem', whiteSpace: 'normal', display: 'block' }}>
          {'◌'} The ratio bands behind these figures have not been checked against the
          regulations. Confirm them before this history is relied on as evidence.
        </p>
      )}
    </div>
  );
}
