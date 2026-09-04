import Link from 'next/link';
import { listChildren, listFundingReceipts, readFundingPeriod } from '@ece/api';
import {
  DEFAULT_CAPS,
  displayName,
  exportDisclaimer,
  formatCents,
  placeCapExceedances,
  sixFourOverlaps,
  summariseVariance,
  todayInZone,
  type FundingPeriod,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { PageActions } from '../PageActions';
import { appPath } from '@/lib/origin';

/**
 * RS7 preparation.
 *
 * **This is not a return and it cannot submit one.** Submitting a funding return requires being a
 * Ministry-approved student management system integrated with ELI. So this produces figures a
 * manager keys into ELI Web themselves.
 *
 * (Corrected 2026-08-18: the "50 services" requirement is a capability, not a customer count. This
 * comment had it the other way round.)
 *
 * (Corrected 2026-09-03: this comment said the Ministry "is not accepting integration
 * applications — still under review as at 2026-08-18". **That is out of date and was the
 * opposite of the position.** Applications for the 2026 tranche are OPEN and close 5pm Friday
 * 30 October 2026 — one place, decided on a readiness assessment. See
 * `docs/eli-integration-2026-tranche.md`. The reason this screen still cannot submit is that we
 * are not an approved integrated SMS, not that nobody may apply.)
 *
 * Every label says "preparation". None say "return", "submit" or "file". That is not pedantry: a
 * screen that looks like it filed something is a screen after which nobody files anything.
 *
 * The completeness banner is the most important element on the page. A summary that looks final
 * while three children have missing sign-outs is a summary that gets typed into ELI Web.
 */
export default async function FundingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const params = await searchParams;
  const today = todayInZone(ctx.centre.timezone);

  // Defaults to the current calendar month. Deliberately *not* a guessed Ministry funding period —
  // those have published boundaries this product does not know, and putting a wrong date range on
  // an official-looking figure is worse than making the operator choose.
  const from = params.from ?? `${today.slice(0, 7)}-01`;
  const to = params.to ?? today;

  const period: FundingPeriod = { label: `${from} to ${to}`, from, to };
  const start = dayWindow(from, ctx.centre.timezone);
  const end = dayWindow(to, ctx.centre.timezone);

  const [summary, children, receipts] = await Promise.all([
    readFundingPeriod(db, {
      centreId: ctx.centre.id,
      period,
      timeZone: ctx.centre.timezone,
      fromUtc: start.fromUtc,
      // The window is [from, to] inclusive, so it ends at the *end* of the last local day.
      toUtc: end.toUtc,
    }),
    listChildren(db, ctx.centre.id, { includeArchived: true }),
    listFundingReceipts(db, ctx.centre.id),
  ]);

  const nameOf = new Map(children.map((c) => [c.id, displayName(c)]));
  const variance = summariseVariance(receipts);

  return (
    <div className="binder">
      <div className="no-print">
        <PageHeader
          title="Funding preparation"
          helpHref="/funding"
          subtitle={
            <>
              {ctx.centre.name}
              {ctx.centre.moeServiceNumber ? ` · Ministry service number ${ctx.centre.moeServiceNumber}` : ''}
            </>
          }
          /*
            The export is the action, and it stays secondary. It is a link, not a button —
            see PageActions — and the period form below it is where the work happens.
          */
          actions={
            <PageActions
              csvHref={appPath(`/funding/export.csv?from=${from}&to=${to}`)}
              hint="The spreadsheet covers the dates above, and names the unresolved days on each row — a file loses the banner it came with."
            />
          }
        />

        <form className="card" method="get">
          <div className="row">
            <div>
              <label htmlFor="from">Period from</label>
              <input className="narrow" id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div>
              <label htmlFor="to">to</label>
              <input className="narrow" id="to" name="to" type="date" defaultValue={to} />
            </div>
            <button type="submit">Recalculate</button>
          </div>
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            {/*
              Said plainly, because the alternative is a manager assuming the default range is the
              official one.
            */}
            Choose the dates that match the funding period you are keying in. This product does not
            know the Ministry&rsquo;s period boundaries and does not guess them.
          </p>
        </form>

      </div>

      {/*
        The disclaimer is generated from the summary, so it cannot say "complete" when it is not —
        and it is the same sentence any future emailed version would use.

        `summary.complete` ALONE NO LONGER DECIDES THIS, and that is the point of the change.
        A period beginning before the attendance record does contains no unresolved days — there
        are no days at all — so `complete` is true and the old banner turned green over a total
        that was simply too small. Both conditions have to hold before this reads as usable.
      */}
      {(() => {
        const covered = summary.periodPrecedesRecord !== true;
        const usable = summary.complete && covered;
        const headline = !covered
          ? 'Records do not cover this period — do not use'
          : !summary.complete
            ? 'Incomplete — do not use yet'
            : 'Preparation figures';
        return (
          <div
            className="card"
            style={{
              background: usable ? 'var(--warn-soft)' : 'var(--breach-soft)',
              borderColor: usable ? 'var(--warn-border)' : 'var(--breach-border)',
            }}
          >
            <p style={{ marginTop: 0 }} role="status">
              <strong>{headline}</strong>
            </p>
            <p style={{ marginBottom: 0 }}>{exportDisclaimer(summary)}</p>
            {/*
              The third state rendered as itself. `periodPrecedesRecord` is null when nobody
              supplied a record start, which is not the same as the record covering the period —
              the `overdue: null` contract. Quiet, because an unknown is not a breach, and said,
              because silence would read as coverage.
            */}
            {summary.periodPrecedesRecord === null && (
              <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
                Whether the attendance record covers this whole period was not checked.
              </p>
            )}
          </div>
        );
      })()}

      {/*
        THE LICENSED-PLACE CAP, reported and never applied.

        The funding cap is 6 funded child hours per licensed child-place per day, and this product
        computes it per CHILD — which is exact whenever a day's children do not outnumber the
        places, and over-states when they do. A sessional service where a morning child and an
        afternoon child share one place is the case: neither child exceeds six hours, and the place
        yields more than six.

        Nothing is reduced. Which child's hours would go is not stated by anything read so far, and
        RS7 needs the surviving hours split by age band and 20 Hours status — so a trim here would
        propagate an invented attribution into a Crown return. The day and the amount are named
        instead, which is the same treatment a broken attendance day gets.

        Null means the centre has not stated its licence, and that renders as a sentence rather than
        as reassurance — the `overdue: null` contract, and the same reason the occupancy report
        declines to compute a percentage without a denominator.
      */}
      {(() => {
        const exceedances = placeCapExceedances({
          children: summary.children,
          licensedPlaces: ctx.centre.licensedPlaces,
        });

        if (exceedances === null) {
          return summary.children.length === 0 ? null : (
            <p className="sub">
              Your licensed places are not recorded, so this could not check whether any day claims
              more hours than your licence allows. Add the figure in{' '}
              <Link href="/settings">Settings</Link> and it will.
            </p>
          );
        }
        if (exceedances.length === 0) return null;

        return (
          <div
            className="card"
            style={{
              background: 'var(--breach-soft)',
              borderColor: 'var(--breach-border)',
            }}
          >
            <p style={{ marginTop: 0 }} role="status">
              <strong>
                {exceedances.length === 1
                  ? 'One day claims more hours than your licence allows'
                  : `${exceedances.length} days claim more hours than your licence allows`}
              </strong>
            </p>
            <p>
              Funding is capped at {DEFAULT_CAPS.maxHoursPerDay} hours per licensed place per day,
              and you are licensed for {ctx.centre.licensedPlaces}. The figures below are{' '}
              <strong>not</strong> reduced — which hours to drop is your decision and not this
              system&rsquo;s, so the days are named instead.
            </p>
            <ul style={{ marginBottom: 0 }}>
              {exceedances.map((e) => (
                <li key={e.date}>
                  {e.date} — {e.claimedHours.toFixed(2)} claimed against {e.allowedHours.toFixed(2)}{' '}
                  allowed
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/*
        §6-4: "Funding must not be claimed for both an absent permanently enrolled child under an
        absence rule and for the conditional or casual child who fills the absent child's place."

        Separate from the licence block above, and it has to be — a day can breach §6-4 without
        exceeding the licence at all. One absent permanent child claimed, one conditional child
        attending, and eight places standing empty: two claims on one place, no aggregate
        exceedance, and the block above says nothing.

        UNLIKE THE LICENCE BLOCK, THE ATTRIBUTION HERE IS KNOWN. §7-7 says it outright — "another
        child may attend the absent child's place without claiming funding for that replacement
        child" — so the hours to drop are the replacement child's. What still stops this reducing
        the figure is the other half of the same problem: RS7 needs the survivors split by age band
        and 20 Hours status, and which casual child among several is not something the Handbook
        decides. So the wording tells the manager what to deduct, which is what a preparation
        export is for.
      */}
      {(() => {
        const overlaps = sixFourOverlaps({
          children: summary.children,
          licensedPlaces: ctx.centre.licensedPlaces,
        });
        if (overlaps.length === 0) return null;

        const total = overlaps.reduce((sum, o) => sum + o.overlapHours, 0);

        return (
          <div
            className="card"
            style={{
              background: 'var(--breach-soft)',
              borderColor: 'var(--breach-border)',
            }}
          >
            <p style={{ marginTop: 0 }} role="status">
              <strong>
                {overlaps.length === 1
                  ? 'One day claims one place twice'
                  : `${overlaps.length} days claim a place twice`}
              </strong>
            </p>
            <p>
              Section 6-4 of the Funding Handbook does not allow a claim for both an absent
              permanently enrolled child and the casual or conditional child who filled that
              child&rsquo;s place. On the days below this preparation claims both, so{' '}
              <strong>{total.toFixed(2)} hours</strong> should come off before you key the figures
              into ELI Web. Section 7-7 says which side goes: the replacement child&rsquo;s hours
              are the ones not claimed.
            </p>
            <ul style={{ marginBottom: 0 }}>
              {overlaps.map((o) => (
                <li key={o.date}>
                  {o.date} — {o.overlapHours.toFixed(2)} hours claimed twice (
                  {o.claimedAbsenceHours.toFixed(2)} absence, {o.replacementHours.toFixed(2)}{' '}
                  attended)
                  {o.basis === 'conditional-enrolment'
                    ? ' — a conditional enrolment, which the Glossary defines as above your licensed places'
                    : o.basis === 'capacity-unknown'
                      ? ' — your licensed places are not recorded, so this day could not be ruled out'
                      : ' — the day was at or over your licensed places'}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      <section>
        <h2>Funded hours — {period.label}</h2>
        {summary.children.length === 0 ? (
          <p>
            <em>No attendance was recorded in this period.</em>
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Child</th>
                  <th>20 Hours ECE</th>
                  <th>Attended</th>
                  <th>Funded</th>
                  <th>Capped on</th>
                  <th>Unresolved</th>
                </tr>
              </thead>
              <tbody>
                {summary.children.map((c) => (
                  <tr key={c.childId}>
                    <td>{nameOf.get(c.childId) ?? 'a former child'}</td>
                    <td>
                      {c.twentyHoursEce ? 'yes' : 'no'}
                      {/*
                        The flag sits in this cell rather than in a column of its own, because the
                        problem IS this cell: the entitlement runs from the third birthday to the
                        sixth, and a tick outside that band is a wrong attestation, not a wrong
                        attendance record. A symbol and a word, never colour alone (WCAG 1.4.1).
                      */}
                      {c.ineligibleDates.length > 0 && (
                        <>
                          {' '}
                          <span className="flag flag-warn">
                            {'▲'} outside the age band on {c.ineligibleDates.length} day
                            {c.ineligibleDates.length === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                    </td>
                    <td>{c.attendedHours.toFixed(2)}</td>
                    <td>
                      <strong>{c.fundedHours.toFixed(2)}</strong>
                      {/*
                        The split, in the cell rather than in two more columns. This table already
                        has six and the screen has a phone-width test; the two components belong
                        beside the total they add up to, not at the far right of a row somebody is
                        scrolling.

                        Only for an attested child with a Plus 10 remainder — for everyone else the
                        components are zero or identical to the total, and printing "20.00 + 0.00"
                        on every row is noise that hides the rows where it matters. The CSV carries
                        them unconditionally, because that is what gets keyed into ELI Web.
                      */}
                      {c.plusTenHours > 0 && (
                        <span className="sub" style={{ display: 'block' }}>
                          {c.twentyHoursHours.toFixed(2)} + {c.plusTenHours.toFixed(2)} Plus 10
                        </span>
                      )}
                      {/*
                        WHICH OF §9-2's SOURCES PRODUCED THIS NUMBER — added 2026-09-04.

                        Two of the four bases yield the same figure from the same events and differ
                        only in whether it is right, so a number without its basis is a number
                        somebody could key into ELI Web believing the wrong thing about it. This is
                        the sentence that stops that.

                        Nothing is shown for `attendance` on a casual or conditional child, because
                        there the figure is CORRECT and a note would be a warning about compliance.
                        Nothing is shown for `agreement` either — that is the Handbook's own basis
                        and needs no caveat. Only the two that under-claim say anything, which keeps
                        the column quiet on the rows where quiet is the truth.
                      */}
                      {c.hoursBasis === 'attendance-no-agreement' && (
                        <span className="sub" style={{ display: 'block' }}>
                          <span className="flag flag-warn">may be low</span> from attendance — no
                          days and times recorded
                        </span>
                      )}
                      {c.hoursBasis === 'attendance-type-not-stated' && (
                        <span className="sub" style={{ display: 'block' }}>
                          <span className="flag flag-warn">may be low</span> from attendance —
                          enrolment type not stated
                        </span>
                      )}
                      {c.absenceHours > 0 && (
                        <span className="sub" style={{ display: 'block' }}>
                          includes {c.absenceHours.toFixed(2)} claimable absent
                        </span>
                      )}
                    </td>
                    <td>
                      {c.cappedDates.length === 0 ? (
                        <span className="empty">&mdash;</span>
                      ) : (
                        `${c.cappedDates.length} day${c.cappedDates.length === 1 ? '' : 's'}`
                      )}
                    </td>
                    <td>
                      {c.unresolvedDates.length === 0 ? (
                        <span className="flag flag-ok">{'✓'} none</span>
                      ) : (
                        <span className="flag flag-critical">
                          {'▲'} {c.unresolvedDates.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>Total funded hours</th>
                  <th>{summary.totalFundedHours.toFixed(2)}</th>
                  {/* A spacer, so <td> — an empty <th> announces as a blank column name. */}
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>

            <p className="sub" style={{ fontSize: '0.8125rem' }}>
              Attended is what the sign-in record shows. Funded is that figure with the caps applied
              and any day whose record is incomplete removed — so funded is never more than attended,
              and hours are rounded <strong>down</strong>.
            </p>

            {/*
              Naming the days rather than a count. A manager fixing three missing sign-outs needs to
              know which three.
            */}
            {!summary.complete && (
              <>
                <h3>Days that could not be calculated</h3>
                <p>
                  Each of these has a sign-in with no matching sign-out, or a sign-out with no
                  sign-in. They are <strong>excluded</strong> from the totals above rather than
                  estimated, because a funding claim built on a guess is a false claim. Correct them
                  on the attendance screen and recalculate.
                </p>
                <ul>
                  {summary.children
                    .filter((c) => c.unresolvedDates.length > 0)
                    .map((c) => (
                      <li key={c.childId}>
                        <strong>{nameOf.get(c.childId) ?? 'a former child'}</strong> —{' '}
                        {c.unresolvedDates.join(', ')}
                        {c.unresolvedHours > 0 && (
                          <> ({c.unresolvedHours.toFixed(2)} hours recorded so far on those days)</>
                        )}
                      </li>
                    ))}
                </ul>
                <p className="no-print">
                  <Link href="/attendance">Go to attendance to fix the record</Link>
                </p>
              </>
            )}
          </>
        )}
      </section>

      <section>
        <h2>What this is, and what it is not</h2>
        <ul>
          <li>
            <strong>Nothing has been submitted.</strong> This system cannot submit a funding return.
            Submission requires Ministry approval as an integrated student management system, and we
            do not hold it.
          </li>
          <li>
            <strong>Figures come from electronic sign-in records.</strong> A child who attended but
            was never signed in does not appear here at all.
          </li>
          <li>
            <strong>The caps cover 20 Hours ECE only.</strong> {summary.capsBasis} A service may
            also claim subsidy funding up to 30 hours a week per child — the difference is
            &ldquo;Plus 10&rdquo;, and this system does not calculate it, so the total may be lower
            than what you are entitled to claim.
          </li>
          <li>
            <strong>Check these against your own records before keying them in.</strong> They are a
            starting point, not an authority.
          </li>
        </ul>
      </section>

      {/*
        Claimed against received, and it sits at the bottom of THIS page on purpose: the
        figures above are what this product calculated, and these are what the Ministry
        actually paid. Reading them apart is how an under-claim goes unnoticed for a year.

        Both numbers are entered by the centre. Nothing on this page multiplies the hours
        above by a rate, because no rate in this repo has been checked — see
        unverified-claims.
      */}
      <section>
        <h2>What was claimed, and what arrived</h2>
        {variance.rows.length === 0 ? (
          <p className="empty">
            No funding payments recorded yet. Add what you claimed and what the Ministry paid, and
            this will show the difference.
          </p>
        ) : (
          <>
            <p className="inline">
              {variance.shortfallCents > 0 && (
                <span className="flag flag-warn">
                  {'●'} {formatCents(variance.shortfallCents)} less than claimed
                </span>
              )}
              {variance.overpaidCents > 0 && (
                // Kept separate from the shortfall, never netted: an under-claim and an
                // overpayment are two different phone calls, and a single figure would
                // hide one behind the other.
                <span className="flag flag-quiet">
                  {formatCents(variance.overpaidCents)} more than claimed
                </span>
              )}
              {variance.shortfallCents === 0 && variance.overpaidCents === 0 && (
                <span className="flag flag-ok">{'✓'} Every stated claim was paid in full</span>
              )}
            </p>

            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Claimed</th>
                  <th>Received</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {variance.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.periodLabel}</strong>
                      <div className="sub" style={{ fontSize: '0.8125rem' }}>
                        {r.periodFrom} to {r.periodTo}
                      </div>
                    </td>
                    <td>
                      {r.claimedCents === null ? (
                        // Not zero. Zero would make this look like a total overpayment
                        // and bury the real ones.
                        <span className="empty">not stated</span>
                      ) : (
                        formatCents(r.claimedCents)
                      )}
                    </td>
                    <td>
                      {formatCents(r.receivedCents)}
                      {r.receivedOn && (
                        <div className="sub" style={{ fontSize: '0.8125rem' }}>{r.receivedOn}</div>
                      )}
                    </td>
                    <td>
                      {r.varianceCents === null ? (
                        <span className="empty">cannot compare</span>
                      ) : r.varianceCents > 0 ? (
                        <span className="flag flag-warn">
                          {'●'} {formatCents(r.varianceCents)} short
                        </span>
                      ) : r.varianceCents < 0 ? (
                        <span className="flag flag-quiet">
                          {formatCents(-r.varianceCents)} over
                        </span>
                      ) : (
                        <span className="flag flag-ok">{'✓'} matched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {variance.unstated > 0 && (
              <p className="sub">
                {variance.unstated} {variance.unstated === 1 ? 'period has' : 'periods have'} no
                stated claim, so {variance.unstated === 1 ? 'it cannot' : 'they cannot'} be compared.
                Add what you keyed into ELI Web to see the difference.
              </p>
            )}
          </>
        )}
      </section>

      <footer>
        <p className="sub">
          {ctx.centre.name} · prepared {new Date().toLocaleString('en-NZ', { timeZone: ctx.centre.timezone })}{' '}
          · preparation figures only, not a submitted return
        </p>
      </footer>
    </div>
  );
}
