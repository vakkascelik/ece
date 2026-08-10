import type { JobApplication } from '@ece/api';
import { listApplications, listMembers } from '@ece/api';
import { isOpenApplication } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
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
  const [applications, members] = await Promise.all([
    listApplications(db, ctx.centre.id),
    listMembers(db, ctx.centre.id),
  ]);

  /*
   * Who last moved each application, shown on the row.
   *
   * These two columns were written and displayed nowhere, which is how they came to be wrong
   * without anybody noticing — a note-only save was re-stamping them, so the row recorded whoever
   * last fixed a typo as the person who declined the applicant. Fixed in the action; surfaced here
   * because a value nothing renders is a value nobody can see going wrong.
   *
   * Falls back to the raw id rather than hiding the fact: a member whose access was later revoked
   * is not in `listMembers`, and "moved by somebody no longer here" is still true and still worth
   * showing.
   */
  const emailOf = new Map(members.map((m) => [m.userId, m.email]));

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
  const movedBy = (a: JobApplication) => {
    if (!a.statusChangedAt) return null;
    const who = a.statusChangedBy ? (emailOf.get(a.statusChangedBy) ?? a.statusChangedBy) : null;
    const when = received(a.statusChangedAt);
    return who ? `${who} on ${when}` : when;
  };

  const rows = (list: JobApplication[]) =>
    list.map((a) => (
      <ApplicationRow
        key={a.id}
        application={a}
        received={received(a.createdAt)}
        movedBy={movedBy(a)}
      />
    ));

  return (
    <>
      <PageHeader
        title="Applications"
        helpHref="/applications"
        subtitle={
          <>
            People who have applied to work at {ctx.centre.name}. Only owners and managers can see
            this.
          </>
        }
      />

      {applications.length === 0 ? (
        <div className="card">
          {/*
            The second sentence used to say emailed applications "can be added to this list". They
            cannot: `recordApplication` exists in @ece/api and nothing calls it, because there is no
            form for it. A screen promising something the product does not do is worse than a screen
            that says what is missing — so it says what is missing, and CONTENT-GAPS.md records it.
          */}
          <p style={{ margin: 0 }}>
            No applications yet. The careers page on the website sends them here. Applications that
            arrive by email stay in the mailbox for now — there is no way to add one to this list
            yet.
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
