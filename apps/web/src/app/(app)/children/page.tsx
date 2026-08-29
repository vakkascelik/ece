import Link from 'next/link';
import {
  listChildren,
  listConsentRequestsByChild,
  listConsentsByChild,
  listCurrentEnrolments,
  listHealthByChild,
} from '@ece/api';
import {
  can,
  compareBySeverity,
  displayName,
  formatAge,
  formatDays,
  hasCriticalCondition,
  isUnderTwo,
  missingConsents,
  unaskedConsents,
  todayInZone,
  type Child,
  type ConsentRequest,
  type ConsentState,
  type Enrolment,
  type HealthCondition,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { appPath } from '@/lib/origin';

/**
 * The roll.
 *
 * A parent reaches this page too and sees exactly one row, because the policy on
 * `children` keys on guardianship as well as centre. Nothing on this page filters
 * for that — see 0004_children.sql.
 *
 * The allergy flag is on the row rather than inside the record on purpose. An
 * educator scanning a list of forty needs to see "this one could stop breathing"
 * without opening anything, and a flag you have to click is a flag nobody reads.
 */
export default async function ChildrenPage() {
  const ctx = await requireCtx();
  const db = await serverDb();

  // Five queries for the whole page rather than four per child. A roll of forty
  // otherwise costs 160 round trips to render one table.
  const [children, healthByChild, consentsByChild, requestsByChild, enrolments] = await Promise.all([
    listChildren(db, ctx.centre.id),
    listHealthByChild(db, ctx.centre.id),
    listConsentsByChild(db, ctx.centre.id),
    listConsentRequestsByChild(db, ctx.centre.id),
    listCurrentEnrolments(db, ctx.centre.id, todayInZone(ctx.centre.timezone)),
  ]);

  const enrolmentByChild = new Map<string, Enrolment>();
  for (const e of enrolments) enrolmentByChild.set(e.childId, e);

  const isParent = ctx.role === 'parent';
  const underTwo = children.filter((c) => isUnderTwo(c.dateOfBirth)).length;

  return (
    <>
      <PageHeader
        title={isParent ? 'Your tamariki' : 'Children'}
        subtitle={
          isParent
            ? `Enrolled at ${ctx.centre.name}.`
            : `${children.length} enrolled at ${ctx.centre.name}` +
              (children.length > 0 ? ` — ${underTwo} under two.` : '.')
        }
        /* Enrol is the one filled button: it is what this screen exists to do. The export
           beside it is a link and stays secondary. */
        actions={
          can(ctx.role, 'manageChildren') ? (
            <div className="page-actions">
              {/* Owner and manager only, which is stricter than this page: an educator and a
                  parent both READ it, and the policy decides how many rows each gets. A file
                  is different — it leaves the product and sits in a downloads folder. */}
              <a className="btn" href={appPath('/children/export.csv')}>
                Download list
              </a>
              <Link href="/children/new">
                <button type="button">Enrol a child</button>
              </Link>
            </div>
          ) : undefined
        }
      />

      {children.length === 0 ? (
        <div className="card">
          <p className="empty">
            {isParent
              ? 'No children are linked to you at this centre yet. The centre adds that when they set up your account.'
              : 'Nobody is enrolled yet.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Age</th>
                <th>Days</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => (
                <ChildRow
                  key={child.id}
                  child={child}
                  enrolment={enrolmentByChild.get(child.id)}
                  health={healthByChild.get(child.id) ?? []}
                  consents={consentsByChild.get(child.id) ?? []}
                  requests={requestsByChild.get(child.id) ?? []}
                  showConsentGap={!isParent}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ChildRow({
  child,
  enrolment,
  health,
  consents,
  requests,
  showConsentGap,
}: {
  child: Child;
  enrolment: Enrolment | undefined;
  health: HealthCondition[];
  consents: ConsentState[];
  requests: ConsentRequest[];
  showConsentGap: boolean;
}) {
  const critical = hasCriticalCondition(health);
  const worst = [...health].sort(compareBySeverity)[0];
  const gaps = missingConsents(consents);
  /*
    The office's actual chase list, and narrower than `gaps` on purpose.

    `gaps` counts everything unanswered — the right number for "is this enrolment finished".
    `unasked` is what nobody has even been asked for, which is the only part the centre can
    fix without waiting on somebody else. A roll where every gap has been asked about is a
    centre that has done its job and is waiting; a roll where none have is a centre that has
    not started, and before 0073 those looked identical here.
  */
  const unasked = unaskedConsents(consents, requests);

  return (
    <tr>
      <td>
        <Link className="plain" href={`/children/${child.id}`}>
          <strong>{displayName(child)}</strong>
        </Link>
      </td>
      <td>
        {formatAge(child.dateOfBirth)}
        {isUnderTwo(child.dateOfBirth) && (
          <>
            {' '}
            <span className="flag flag-quiet">under 2</span>
          </>
        )}
      </td>
      <td>{enrolment ? formatDays(enrolment.days) : <span className="empty">Not enrolled</span>}</td>
      <td>
        <span className="inline">
          {/*
            NO `title`, AND THIS WAS THE LAST ONE.

            It carried the response plan — where the EpiPen is kept, whether to ring 111 —
            in a `title` attribute, which is meaning available to a mouse and to nothing
            else: not a keyboard, not a touch screen, and not most screen readers. This is
            the roll an educator scans on a tablet, so it was mouse-only meaning on the
            surface with no mouse.

            `AttendanceRow` had exactly this and it was removed there in Phase 6; the child
            record's header now prints the plan as text beside the condition. This row was
            the one place the old pattern survived, which is how a rule quietly becomes a
            preference.

            The plan is not printed here instead. A roll of forty rows cannot carry forty
            response plans and stay scannable, and the flag already names the condition and
            its severity — which is the part that decides whether somebody opens the record.
            The record is one tap away and prints the whole thing.
          */}
          {/* Symbol and word together — never colour alone. */}
          {critical ? (
            <span className="flag flag-critical">
              ▲ {worst?.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe'}: {worst?.name}
            </span>
          ) : health.length > 0 ? (
            <span className="flag flag-warn">● Health: {health.length}</span>
          ) : null}

          {showConsentGap && gaps.length > 0 && (
            <span className="flag flag-quiet">
              ◌ {gaps.length} consent unanswered
              {unasked.length === 0 ? ' · asked' : unasked.length < gaps.length ? ` · ${unasked.length} not asked` : ' · not asked'}
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}
