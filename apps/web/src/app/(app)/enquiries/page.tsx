import { listEnquiries } from '@ece/api';
import { todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { EnquiryRow } from './EnquiryRow';

/**
 * Enrolment enquiries from the public form.
 *
 * Office only, the same guard as the waitlist and for the same reason: it is a list of
 * other families' names and contact details, and the order they arrived in.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THERE IS NO "PROMOTE TO CHILD" BUTTON, AND THERE SHOULD NOT BE ONE
 *
 * Marking an enquiry `enrolled` is a label on this row. Creating the child, the guardians
 * and the enrolment is done by hand on the other screens, after a conversation — 0052
 * refuses to automate the moment a stranger's claim becomes the centre's record about a
 * child, because that is a moment somebody should be accountable for. A button here would
 * make it a click.
 */
export default async function EnquiriesPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const enquiries = await listEnquiries(db, ctx.centre.id);
  const open = enquiries.filter((e) => ['new', 'contacted', 'waitlisted'].includes(e.status));

  return (
    <>
      <PageHeader
        title="Enquiries"
        helpHref="/enquiries"
        subtitle={
          <>
            {ctx.centre.name} · as at {today}
          </>
        }
      />

      <div className="card">
        <div role="status" className="inline">
          <span className={`flag ${open.length > 0 ? 'flag-warn' : 'flag-ok'}`}>
            {open.length > 0 ? '●' : '✓'} {open.length} open
          </span>
          <span className="flag flag-quiet">{enquiries.length} in total</span>
        </div>
        <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
          These come from the enrolment form on the public website. It asks for a coarse age
          band and never for a child&rsquo;s name or date of birth, so there is less here than
          you might expect — that is deliberate, and the details come when a family enrols.
        </p>
      </div>

      <div className="section">
        <h2>All enquiries — {enquiries.length}</h2>
        <div className="card">
          {enquiries.length === 0 ? (
            <p className="empty" style={{ margin: 0 }}>
              Nothing yet. Enquiries sent from the website appear here.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Child&rsquo;s age</th>
                  <th>Wanted</th>
                  <th>Status</th>
                  <th>
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {enquiries.map((e) => (
                  <EnquiryRow key={e.id} enquiry={e} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
