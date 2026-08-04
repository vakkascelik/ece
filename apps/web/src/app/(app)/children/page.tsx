import Link from 'next/link';
import { listChildren, listConsentsByChild, listCurrentEnrolments, listHealthByChild } from '@ece/api';
import {
  can,
  compareBySeverity,
  displayName,
  formatAge,
  formatDays,
  hasCriticalCondition,
  isUnderTwo,
  missingConsents,
  type Child,
  type Enrolment,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

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

  // Four queries for the whole page rather than three per child. A roll of forty
  // otherwise costs 120 round trips to render one table.
  const [children, healthByChild, consentsByChild, enrolments] = await Promise.all([
    listChildren(db, ctx.centre.id),
    listHealthByChild(db, ctx.centre.id),
    listConsentsByChild(db, ctx.centre.id),
    listCurrentEnrolments(db, ctx.centre.id),
  ]);

  const enrolmentByChild = new Map<string, Enrolment>();
  for (const e of enrolments) enrolmentByChild.set(e.childId, e);

  const isParent = ctx.role === 'parent';
  const underTwo = children.filter((c) => isUnderTwo(c.dateOfBirth)).length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>{isParent ? 'Your tamariki' : 'Children'}</h1>
          <p className="sub">
            {isParent
              ? `Enrolled at ${ctx.centre.name}.`
              : `${children.length} enrolled at ${ctx.centre.name}` +
                (children.length > 0 ? ` — ${underTwo} under two.` : '.')}
          </p>
        </div>
        {can(ctx.role, 'manageChildren') && (
          <Link href="/children/new">
            <button type="button">Enrol a child</button>
          </Link>
        )}
      </div>

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
  showConsentGap,
}: {
  child: Child;
  enrolment: Enrolment | undefined;
  health: Parameters<typeof compareBySeverity>[0][];
  consents: Parameters<typeof missingConsents>[0];
  showConsentGap: boolean;
}) {
  const critical = hasCriticalCondition(health);
  const worst = [...health].sort(compareBySeverity)[0];
  const gaps = missingConsents(consents);

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
          {/* Symbol and word together — never colour alone. */}
          {critical ? (
            <span className="flag flag-critical" title={worst?.responsePlan ?? undefined}>
              ▲ {worst?.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe'}: {worst?.name}
            </span>
          ) : health.length > 0 ? (
            <span className="flag flag-warn">● Health: {health.length}</span>
          ) : null}

          {showConsentGap && gaps.length > 0 && (
            <span className="flag flag-quiet">◌ {gaps.length} consent unanswered</span>
          )}
        </span>
      </td>
    </tr>
  );
}
