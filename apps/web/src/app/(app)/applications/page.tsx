import type { JobApplication } from '@ece/api';
import { listApplications } from '@ece/api';
import { isOpenApplication } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { ApplicationRow } from './ApplicationRow';

/**
 * Applications for employment.
 *
 * Owner and manager only, enforced in Postgres by `job_applications_all` and asserted in
 * `rls_isolation.sql` — `requireCapability` here only decides whether this page renders at all, and
 * an educator who typed the URL is redirected before RLS is ever consulted.
 *
 * WHY OPEN AND CLOSED ARE SEPARATED RATHER THAN SORTED
 *
 * A single list ordered by date buries the two applications somebody has to act on under twenty
 * they have already dealt with. Closed ones stay on the page rather than behind a filter, because
 * the reason to keep them at all is to be able to answer "did anybody ever reply to me".
 */
export default async function ApplicationsPage() {
  const ctx = await requireCapability('manageRecruitment');
  const db = await serverDb();
  const applications = await listApplications(db, ctx.centre.id);

  const open = applications.filter((a) => isOpenApplication(a.status));
  const closed = applications.filter((a) => !isOpenApplication(a.status));

  /*
   * Formatted in the centre's timezone, not the server's.
   *
   * An application sent at 9pm in Auckland is stored as the following day in UTC, so a date
   * rendered without a zone tells a manager the person applied tomorrow. The same class of bug as
   * the attendance fixture that stamped an hour ago and landed on yesterday in the first hour of an
   * NZ day.
   */
  const received = (iso: string) =>
    new Date(iso).toLocaleDateString('en-NZ', { timeZone: ctx.centre.timezone });

  // One place, so the two lists cannot drift in what they pass.
  const rows = (list: JobApplication[]) =>
    list.map((a) => <ApplicationRow key={a.id} application={a} received={received(a.createdAt)} />);

  return (
    <>
      <h1>Applications</h1>
      <p className="sub">
        People who have applied to work at {ctx.centre.name}. Only owners and managers can see this.
      </p>

      {applications.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            No applications yet. The careers page on the website sends them here, and anything that
            arrives by email can be added to this list so it is not lost in a mailbox.
          </p>
        </div>
      ) : (
        <>
          <h2>Open ({open.length})</h2>
          {open.length === 0 ? (
            <p className="sub">Nothing waiting.</p>
          ) : (
            <ul className="stack">{rows(open)}</ul>
          )}

          {closed.length > 0 && (
            <>
              <h2>Closed ({closed.length})</h2>
              <ul className="stack">{rows(closed)}</ul>
            </>
          )}
        </>
      )}
    </>
  );
}
