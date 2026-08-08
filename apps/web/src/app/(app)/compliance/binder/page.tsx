import Link from 'next/link';
import {
  currentCriteriaSet,
  listCriteria,
  listEvidence,
  listStaffRecords,
  readDayRatio,
} from '@ece/api';
import {
  assessAll,
  STAFF_RECORD_LABELS,
  summarise,
  summariseDay,
  todayInZone,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { dayWindow, lastSevenDays } from '@/lib/dayWindow';

/**
 * The evidence binder: one dated document to hand to a reviewer.
 *
 * WHY THIS IS A PRINT STYLESHEET AND NOT A PDF LIBRARY
 *
 * The plan says "one dated PDF". A print-optimised page produces exactly that — every
 * browser prints to PDF — and it costs no dependency, no headless Chrome in the
 * deployment, no font bundling, and no second rendering path that drifts from the screen.
 * `puppeteer` would add ~300MB to a container to re-render HTML the browser already has.
 *
 * What it gives up is server-side generation: nobody can email this on a schedule. When
 * that is wanted, this page is the thing to render — the layout will already be right.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY
 *
 * Anywhere it would be easy to write "compliant", it says what the data actually shows.
 * A binder is read by somebody deciding whether to believe the centre, and a document
 * that overstates its own evidence is worse than one that is honest about the gaps —
 * because the gaps are what the reviewer is going to find anyway.
 */
export default async function BinderPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);
  const generatedAt = new Date().toLocaleString('en-NZ', { timeZone: ctx.centre.timezone });

  const [staffRecords, evidence, criteriaSet] = await Promise.all([
    listStaffRecords(db, ctx.centre.id),
    listEvidence(db, ctx.centre.id),
    currentCriteriaSet(db),
  ]);
  const criteria = criteriaSet ? await listCriteria(db, criteriaSet.id) : [];

  const assessed = assessAll(staffRecords, today);
  const summary = summarise(assessed);

  const days = lastSevenDays(today);
  const replays = await Promise.all(
    days.map(async (date) => {
      const { fromUtc, toUtc } = dayWindow(date, ctx.centre.timezone);
      return readDayRatio(db, {
        centreId: ctx.centre.id,
        date,
        fromUtc,
        toUtc,
        // The centre's stated source. Required by readDayRatio so a switch cannot
        // silently reinterpret a binder — see 0040.
        adultSource: ctx.centre.ratioSource,
      });
    }),
  );

  const covered = new Set(
    evidence.map((e) => e.criterionId).filter((id): id is string => id !== null),
  );
  const gaps = criteria.filter((c) => !covered.has(c.id));
  const byId = new Map(criteria.map((c) => [c.id, c]));

  return (
    <div className="binder">
      {/* Not printed. */}
      <div className="no-print inline" style={{ marginBottom: '1.5rem' }}>
        <Link href="/compliance">Back to compliance</Link>
        <span className="sub">Use your browser&rsquo;s print dialogue and choose &ldquo;Save as PDF&rdquo;.</span>
      </div>

      <header>
        <h1>Licensing evidence</h1>
        <p className="sub">
          <strong>{ctx.centre.name}</strong>
          {ctx.centre.moeServiceNumber ? ` · Ministry service number ${ctx.centre.moeServiceNumber}` : ''}
        </p>
        <p className="sub">Generated {generatedAt}</p>
      </header>

      {/*
        Stated at the top rather than buried. A reviewer reading this needs to know what it
        is derived from before they read any of the numbers.
      */}
      <section>
        <h2>What this document is</h2>
        <p>
          A record assembled from what this service has entered into its management system.
          It reports what the data shows and does not assess compliance. Three limits are
          worth reading before the rest:
        </p>
        <ul>
          <li>
            Ratio history is derived from electronic sign-in events and recorded adult
            counts. A child who was present but never signed in does not appear, so
            &ldquo;no breach recorded&rdquo; is not a guarantee that ratios were kept.
          </li>
          {/*
            The sentence that had to stop being a constant.

            Until 0040 there was one source and this could safely be hardcoded. Now a
            centre may switch, and a binder covering both sides of that switch would
            otherwise assert a provenance it does not have — which is worse than
            asserting none. `DayReplay.adultSource` carries the answer per day, and
            `replayDay` requires its caller to state it precisely so this line cannot
            drift from the numbers above it.
          */}
          {ctx.centre.ratioSource === 'derived' ? (
            <li>
              The adult counts are derived from individual staff sign-in and sign-out. An
              adult who was present but never signed in does not appear, so the same caution
              applies to them as to the tamariki above.
            </li>
          ) : (
            <li>
              The adult counts are figures entered by staff, not derived from individual staff
              sign-in. Individual staff attendance is not used for the figures in this
              document.
            </li>
          )}
          {replays.some((r) => r.adultSource !== ctx.centre.ratioSource) && (
            <li>
              <strong>
                Some days in this period used a different source for the adult count from the
                one in force now.
              </strong>{' '}
              Those days are marked in the ratio history below.
            </li>
          )}
          <li>
            Where a certificate is listed as sighted, a named person has recorded that they
            saw the original document. Where it is not, only the details have been entered.
          </li>
        </ul>
      </section>

      <section>
        <h2>Staff records</h2>
        <p>
          {summary.total} active records. {summary.expired} expired, {summary.dueSoon} due for
          renewal, {summary.unsighted} where the original has not been recorded as sighted.
        </p>
        {assessed.length === 0 ? (
          <p>
            <em>No staff records have been entered.</em>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Record</th>
                <th>Reference</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Original sighted</th>
              </tr>
            </thead>
            <tbody>
              {assessed.map(({ record, expiry }) => (
                <tr key={record.id}>
                  <td>{record.personName}</td>
                  <td>{STAFF_RECORD_LABELS[record.kind]}</td>
                  <td>{record.reference ?? '—'}</td>
                  <td>{record.issuedOn ?? '—'}</td>
                  <td>{record.expiresOn ?? 'no expiry recorded'}</td>
                  <td>
                    {expiry.status === 'expired'
                      ? `Expired ${Math.abs(expiry.daysRemaining ?? 0)} days ago`
                      : expiry.status === 'due-soon'
                        ? `${expiry.daysRemaining} days remaining`
                        : expiry.status === 'current'
                          ? 'Current'
                          : 'No expiry recorded'}
                  </td>
                  <td>
                    {record.sightedAt
                      ? new Date(record.sightedAt).toLocaleDateString('en-NZ')
                      : 'Not recorded'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Ratio history — seven days to {today}</h2>
        {replays.every((r) => r.snapshots.length === 0) ? (
          <p>
            <em>No attendance was recorded in this period.</em>
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Events</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {replays.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.snapshots.length}</td>
                    <td>{summariseDay(day)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {replays.some((r) => r.breaches.length > 0) && (
              <>
                <h3>Periods over ratio</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Duration</th>
                      <th>Children</th>
                      <th>Adults</th>
                      <th>Short by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replays.flatMap((day) =>
                      day.breaches.map((b, i) => (
                        <tr key={`${day.date}-${i}`}>
                          <td>{day.date}</td>
                          <td>{time(b.from, ctx.centre.timezone)}</td>
                          <td>{b.to ? time(b.to, ctx.centre.timezone) : 'still open at last event'}</td>
                          <td>{b.minutes === null ? '—' : `${b.minutes} min`}</td>
                          <td>{b.childrenPresent}</td>
                          <td>{b.adultsPresent}</td>
                          <td>{b.worstShortfall}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </>
            )}

            {/*
              The ratio bands are unverified. A binder that presented these figures without
              saying so would be the product laundering an unchecked number into a document
              somebody signs.
            */}
            {replays.some((r) => r.snapshots.some((s) => !s.assessment.verified)) && (
              <p>
                <strong>Note:</strong> the adult-to-child ratio thresholds used to produce
                this history have not been verified against the current regulations by this
                service. The times and headcounts are recorded data; the compliance judgement
                drawn from them should be checked independently.
              </p>
            )}
          </>
        )}
      </section>

      <section>
        <h2>Licensing criteria</h2>
        {!criteriaSet || criteria.length === 0 ? (
          <p>
            <em>
              No licensing criteria set has been loaded into this system, so evidence is not
              indexed against criterion numbers. The items in the next section are listed as
              filed.
            </em>
          </p>
        ) : (
          <>
            <p>
              {criteria.length} criteria in <strong>{criteriaSet.name}</strong>
              {criteriaSet.effectiveFrom ? `, effective ${criteriaSet.effectiveFrom}` : ''}.{' '}
              {criteria.length - gaps.length} have evidence attached; {gaps.length} do not.
            </p>
            <p className="sub">Source: {criteriaSet.source}</p>
            {gaps.length > 0 && (
              <>
                <h3>Criteria with nothing filed against them</h3>
                <ul>
                  {gaps.map((c) => (
                    <li key={c.id}>
                      <strong>{c.code}</strong> — {c.title}
                      {c.supersedesCode ? ` (previously ${c.supersedesCode})` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section>
        <h2>Evidence on file</h2>
        {evidence.length === 0 ? (
          <p>
            <em>Nothing has been filed.</em>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Criterion</th>
                <th>What</th>
                <th>Kind</th>
                <th>Where it is held</th>
                <th>Covers</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => {
                const c = e.criterionId ? byId.get(e.criterionId) : undefined;
                return (
                  <tr key={e.id}>
                    <td>{c ? c.code : '—'}</td>
                    <td>
                      {e.title}
                      {e.detail ? <div className="sub">{e.detail}</div> : null}
                    </td>
                    <td>{e.kind.replace(/_/g, ' ')}</td>
                    <td>{e.location ?? 'not recorded'}</td>
                    <td>
                      {e.coversFrom || e.coversTo
                        ? `${e.coversFrom ?? '…'} to ${e.coversTo ?? 'now'}`
                        : '—'}
                    </td>
                    <td>{e.ownerName ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer>
        <p className="sub">
          {ctx.centre.name} · generated {generatedAt} · assembled from records entered by this
          service. Not an assessment of compliance.
        </p>
      </footer>
    </div>
  );
}

function time(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-NZ', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
}
