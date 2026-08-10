import Link from 'next/link';
import { listEnquiries } from '@ece/api';
import { summariseEnquiryFunnel, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageActions } from '../../PageActions';
import { PageHeader } from '../../PageHeader';

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  waitlisted: 'Waitlisted',
  enrolled: 'Enrolled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

/**
 * How enquiries become enrolments — every enquiry the centre has received, not a window.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS NOT A "WAITLIST CONVERSION RATE", AND THE PAGE SAYS SO
 *
 * `enrolment_applications.status` is current state, not history: an enquiry that reached
 * `waitlisted` and later became `enrolled` now says `enrolled`, and the fact it was ever
 * waitlisted is gone from the row. So the honest question this can answer is "of everyone
 * who enquired, how many became a placement" — not "of everyone on the waitlist,
 * specifically". See `summariseEnquiryFunnel` in `@ece/core` for the fuller argument.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ALL-TIME, NOT THE LAST THIRTY DAYS
 *
 * Occupancy and trends read a fixed window because attendance is a daily volume — the
 * occupancy report explains why a large one would silently truncate at PostgREST's
 * thousand-row ceiling. Enquiries are not that: a small service gets a handful a month,
 * and a family's enquiry can take months to resolve. Windowing this to thirty days would
 * mostly show "new" and "contacted" rows with no outcome yet, understating the rate for a
 * reason nothing on the page would explain — the exact trap the occupancy report's own
 * "average over open days" note exists to avoid, one level up.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OFFICE `waitlist` TABLE IS NOT ON THIS PAGE
 *
 * A second, older table (0018) holds phone enquiries taken by staff. Nothing in this
 * product has a screen that reads or writes it, so a report folding it in here would be
 * asserting a queue nobody can see or add to. Left out rather than shown as a silent zero.
 */
export default async function WaitlistConversionPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const enquiries = await listEnquiries(db, ctx.centre.id);
  const funnel = summariseEnquiryFunnel(enquiries);

  return (
    <div className="binder">
      <div className="no-print">
        <PageHeader
          title="Enquiry conversion"
          subtitle={
            <>
              {ctx.centre.name} · all enquiries received, as at {today}
            </>
          }
          actions={
            <PageActions hint="The printed version keeps the tables and drops the navigation." />
          }
        />
      </div>

      <div className="card">
        {funnel.total === 0 ? (
          <p style={{ margin: 0 }}>
            <em>No enquiries have been received through the website yet.</em>
          </p>
        ) : funnel.conversionRate === null ? (
          <p style={{ margin: 0 }}>
            {funnel.total} enquir{funnel.total === 1 ? 'y has' : 'ies have'} come in and none
            has reached an outcome yet — every one is still new, contacted or waitlisted.
          </p>
        ) : (
          <>
            <div role="status" className="inline">
              <span className="flag flag-ok">{funnel.conversionRate}% became a placement</span>
              <span className="flag flag-quiet">
                {funnel.resolved.enrolled} of {funnel.resolvedTotal} decided enquiries
              </span>
              {funnel.total - funnel.resolvedTotal > 0 && (
                <span className="flag flag-quiet">
                  {funnel.total - funnel.resolvedTotal} still open
                </span>
              )}
            </div>
            <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
              Of enquiries received, not of enquiries decided <em>this month</em> — see{' '}
              <Link href="/enquiries">the office queue</Link> for what is still open.
            </p>
          </>
        )}
      </div>

      <div className="section">
        <h2>Where every enquiry stands</h2>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['new', funnel.open.new],
                  ['contacted', funnel.open.contacted],
                  ['waitlisted', funnel.open.waitlisted],
                  ['enrolled', funnel.resolved.enrolled],
                  ['declined', funnel.resolved.declined],
                  ['withdrawn', funnel.resolved.withdrawn],
                ] as const
              ).map(([status, n]) => (
                <tr key={status}>
                  <td>{STATUS_LABELS[status]}</td>
                  <td>{n}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td>
                  <strong>{funnel.total}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
