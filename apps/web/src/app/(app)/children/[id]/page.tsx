import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getChild,
  listAttendanceToday,
  listConsentHistory,
  listConsents,
  listCustodyArrangements,
  listEnrolments,
  listGuardiansOfChild,
  listHealthConditions,
  listMedications,
} from '@ece/api';
import {
  can,
  compareBySeverity,
  displayName,
  formatAge,
  hasCriticalCondition,
  initials,
  isUnderTwo,
  missingConsents,
  todayInZone,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { ArchivePanel } from './ArchivePanel';
import { ConsentPanel } from './ConsentPanel';
import { CustodyPanel } from './CustodyPanel';
import { DetailsForm } from './DetailsForm';
import { EnrolmentPanel } from './EnrolmentPanel';
import { HealthPanel } from './HealthPanel';
import { WhanauPanel } from './WhanauPanel';

/**
 * One child's record.
 *
 * Three quite different readers land here — a manager maintaining it, an educator
 * reading it, and a parent checking their own child — and each sees a different
 * amount. The gating below is presentation: RLS decides what the queries return,
 * and a parent who reached another family's URL gets `notFound()` because
 * `getChild` returns null, not because this page checked.
 */
export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const db = await serverDb();

  const child = await getChild(db, id);
  // Indistinguishable from "does not exist", on purpose. Confirming that a child
  // exists at a centre you cannot see is itself a disclosure.
  if (!child) notFound();

  // The date at the centre, resolved once on the server and passed down. A client
  // component computing it gets the browser's timezone, which is the manager's and
  // not necessarily the centre's; computing it on the server without a zone gets
  // UTC, which is yesterday all New Zealand morning.
  const today = todayInZone(ctx.centre.timezone);
  const canManage = can(ctx.role, 'manageChildren');
  const canViewCustody = can(ctx.role, 'viewCustody');

  const [conditions, medications, whanau, enrolments, consents, history, custody, attendance] =
    await Promise.all([
      listHealthConditions(db, id),
      listMedications(db, id),
      listGuardiansOfChild(db, id),
      listEnrolments(db, id),
      listConsents(db, id),
      listConsentHistory(db, id),
      canViewCustody ? listCustodyArrangements(db, id) : Promise.resolve([]),
      // For the header's "signed in" chip. Derived from the events like everywhere else —
      // there is no stored "present" flag to read, deliberately.
      listAttendanceToday(db, ctx.centre.id),
    ]);

  const state = attendance.find((s) => s.childId === id);
  const signedInAt = state?.kind === 'in' ? state.at : null;

  const sorted = [...conditions].sort(compareBySeverity);
  const critical = hasCriticalCondition(conditions);
  const gaps = missingConsents(consents);

  // A parent recording consent can only attribute it to themselves, and the policy
  // enforces that. This resolves which guardian record is theirs so the form can
  // send it; if they are not linked as a guardian, the panel says so rather than
  // failing on submit.
  const ownGuardianId = whanau.find((g) => g.guardian.userId === ctx.userId)?.guardian.id ?? null;

  const enrolledOn = enrolments.length > 0 ? enrolments[0].startDate : null;

  return (
    <div className="record">
      <p style={{ fontSize: 'var(--text-sm)', margin: '0 0 12px' }}>
        <Link href="/children">Back</Link>
      </p>

      <div className="record-head">
        {/* aria-hidden: the name is the next thing in the reading order. */}
        <span className="record-initials" aria-hidden="true">
          {initials(child)}
        </span>
        <div className="record-who">
          <h1>{displayName(child)}</h1>
          <p className="record-meta">
            {formatAge(child.dateOfBirth, today)} · born {child.dateOfBirth}
            {enrolledOn && ` · enrolled ${enrolledOn}`}
            {child.archivedAt ? ' · left the centre' : ''}
          </p>
        </div>

        {/*
          Whether this child is in the building, on the record itself. The board puts it
          here and it is the right call: the question "is this child here" arrives at the
          same moment as "what is this child allergic to", and the answer was previously
          only on /attendance.
        */}
        <span className={`flag ${signedInAt ? 'flag-ok' : 'flag-quiet'} record-status`}>
          {signedInAt
            ? `✓ Signed in ${new Date(signedInAt).toLocaleTimeString('en-NZ', {
                hour: 'numeric',
                minute: '2-digit',
              })}`
            : '◇ Not signed in today'}
        </span>
      </div>

      <div className="inline" style={{ marginBottom: '1.5rem' }}>
        {isUnderTwo(child.dateOfBirth, today) && <span className="flag flag-quiet">under 2</span>}
        {gaps.length > 0 && ctx.role !== 'parent' && (
          <span className="flag flag-warn">◌ {gaps.length} consent unanswered</span>
        )}
        {enrolments.length === 0 && <span className="flag flag-warn">◌ No enrolment on file</span>}
      </div>

      {/*
        HEALTH IS FIRST, AND THAT IS THE POINT OF THIS SCREEN.
        The design pack puts it above the identity metadata "because it is the only block
        read under time pressure". Everything else here — names, dates, NSN — is read by
        somebody sitting down. This block is read by somebody holding a child who has
        eaten something. So the order is Health, Consent, Whānau, Enrolment, Custody, and
        the editable identity form goes last.
      */}
      {critical && (
        <div className="section">
          <h2>Read this first</h2>
          {sorted
            .filter((c) => c.severity === 'anaphylaxis' || c.severity === 'severe')
            .map((c) => (
              <div key={c.id} className="healthcard healthcard-critical">
                <span aria-hidden="true">▲</span>
                <div>
                  <div className="healthcard-title">
                    {c.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe'}: {c.name}
                  </div>
                  {c.responsePlan && <div className="healthcard-detail">{c.responsePlan}</div>}
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="section">
        <h2>Health</h2>
        <HealthPanel
          childId={child.id}
          conditions={sorted}
          medications={medications}
          guardians={whanau.map((g) => ({ id: g.guardian.id, name: g.guardian.fullName }))}
          canEdit={can(ctx.role, 'recordHealth')}
          today={today}
        />
      </div>

      {/* Consent second, per the pack — it gates whether a photo may exist at all. */}
      <div className="section">
        <h2>Consent</h2>
        <ConsentPanel
          childId={child.id}
          consents={consents}
          history={history}
          guardians={whanau.map((g) => ({ id: g.guardian.id, name: g.guardian.fullName }))}
          canRecord={can(ctx.role, 'recordConsent')}
          isParent={ctx.role === 'parent'}
          ownGuardianId={ownGuardianId}
        />
      </div>

      <div className="section">
        <h2>Whānau</h2>
        <WhanauPanel childId={child.id} whanau={whanau} canEdit={canManage} isParent={ctx.role === 'parent'} />
      </div>

      <div className="section">
        <h2>Enrolment</h2>
        <EnrolmentPanel
          childId={child.id}
          enrolments={enrolments}
          canEdit={can(ctx.role, 'manageEnrolment')}
          today={today}
        />
      </div>

      {/*
        Custody is owner/manager only. Not rendered at all for anyone else — an
        empty "Custody" heading tells an educator that a court order exists, which
        is most of what the restriction is protecting.
      */}
      {canViewCustody && (
        <div className="section">
          <h2>Custody and court orders</h2>
          <CustodyPanel childId={child.id} arrangements={custody} />
        </div>
      )}

      {/*
        Identity metadata last. It is the block a manager edits sitting down, and the pack
        is explicit that it belongs below health — the header above already carries the
        name, age and enrolment date that anybody reading in a hurry needs.
      */}
      <div className="section">
        <h2>Details</h2>
        <DetailsForm child={child} readOnly={!canManage} />
      </div>

      {canManage && !child.archivedAt && (
        <div className="section">
          <h2>Leaving</h2>
          <ArchivePanel childId={child.id} name={child.preferredName || child.firstName} />
        </div>
      )}
    </div>
  );
}
