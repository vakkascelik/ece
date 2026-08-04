import Link from 'next/link';
import { listChildren, readFundingPeriod } from '@ece/api';
import { displayName, exportDisclaimer, todayInZone, type FundingPeriod } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';

/**
 * RS7 preparation.
 *
 * **This is not a return and it cannot submit one.** Submitting a funding return requires being a
 * Ministry-approved student management system integrated with ELI; the Ministry is not accepting
 * integration applications, and approval requires supporting 50 services *before* applying. So this
 * produces figures a manager keys into ELI Web themselves.
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

  const [summary, children] = await Promise.all([
    readFundingPeriod(db, {
      centreId: ctx.centre.id,
      period,
      timeZone: ctx.centre.timezone,
      fromUtc: start.fromUtc,
      // The window is [from, to] inclusive, so it ends at the *end* of the last local day.
      toUtc: end.toUtc,
    }),
    listChildren(db, ctx.centre.id, { includeArchived: true }),
  ]);

  const nameOf = new Map(children.map((c) => [c.id, displayName(c)]));

  return (
    <div className="binder">
      <div className="no-print">
        <div className="section-head">
          <div>
            <h1>Funding preparation</h1>
            <p className="sub" style={{ marginBottom: '1rem' }}>
              {ctx.centre.name}
              {ctx.centre.moeServiceNumber ? ` · Ministry service number ${ctx.centre.moeServiceNumber}` : ''}
            </p>
          </div>
        </div>

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
      */}
      <div
        className="card"
        style={{
          background: summary.complete ? 'var(--warn-soft)' : 'var(--breach-soft)',
          borderColor: summary.complete ? 'var(--warn-border)' : 'var(--breach-border)',
        }}
      >
        <p style={{ marginTop: 0 }} role="status">
          <strong>{summary.complete ? 'Preparation figures' : 'Incomplete — do not use yet'}</strong>
        </p>
        <p style={{ marginBottom: 0 }}>{exportDisclaimer(summary)}</p>
      </div>

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
                    <td>{c.twentyHoursEce ? 'yes' : 'no'}</td>
                    <td>{c.attendedHours.toFixed(2)}</td>
                    <td>
                      <strong>{c.fundedHours.toFixed(2)}</strong>
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
                  <th colSpan={2} />
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
            Submission requires Ministry approval as an integrated student management system, which is
            not open to new applicants.
          </li>
          <li>
            <strong>Figures come from electronic sign-in records.</strong> A child who attended but
            was never signed in does not appear here at all.
          </li>
          <li>
            <strong>The caps have not been verified.</strong> {summary.capsBasis}
          </li>
          <li>
            <strong>Check these against your own records before keying them in.</strong> They are a
            starting point, not an authority.
          </li>
        </ul>
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
