import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getChild,
  listAttendanceToday,
  listConsents,
  listEnrolments,
  listHealthConditions,
  listImmunisation,
  listMedications,
} from '@ece/api';
import {
  compareBySeverity,
  displayName,
  formatAge,
  initials,
  isUnderTwo,
  missingConsents,
  todayInZone,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { Status } from '../../Status';
import { RecordTabs } from './RecordTabs';
import './record.css';

/**
 * The part of a child's record that does not change between tabs: who this is, what is
 * urgent about them, and where the rest of it lives.
 *
 * A layout rather than a component each page renders, so the header does not remount when a
 * tab changes — the flag row is the thing an educator is reading while they navigate, and a
 * header that flickers on every tab is a header they stop trusting.
 *
 * THE FLAGS ARE ABOVE THE REFERENCE TEXT, AND THAT IS THE SAFETY DECISION
 *
 * The record used to lead with a "Read this first" block above the identity metadata, because
 * — as the design pack put it — health is "the only block read under time pressure". Names,
 * dates and NSNs are read by somebody sitting down; an allergy is read by somebody holding a
 * child who has eaten something.
 *
 * Tabs could easily have destroyed that. Health on its own tab means the allergy is one tap
 * away from every other tab, which is worse than the scroll it replaced. So the flags moved
 * **into the header**: they are above the age and the enrolment date, and they are on every
 * tab, including the ones about paperwork. The property is stronger than it was, not
 * preserved — and `a11y.spec.ts` asserts it on more than one tab for that reason.
 *
 * The handover's mockup draws the meta line above the flags. Its prose says "flags directly
 * under the name", and the prose agrees with the safety argument, so the prose won.
 */
export default async function ChildRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireCtx();
  const db = await serverDb();

  const child = await getChild(db, id);
  // Indistinguishable from "does not exist", on purpose. Confirming that a child
  // exists at a centre you cannot see is itself a disclosure.
  if (!child) notFound();

  const today = todayInZone(ctx.centre.timezone);

  /*
    Only what the header needs, and it is deliberately more than the name.

    Every one of these reads answers "is something wrong with this child's record that
    somebody at the door should know". They are paid on every tab, which is the cost of the
    flags being on every tab, and it is the right trade: the alternative is a header that is
    honest on one tab and silent on the other four.
  */
  const [conditions, medications, consents, enrolments, immunisation, attendance] =
    await Promise.all([
      listHealthConditions(db, id),
      listMedications(db, id),
      listConsents(db, id),
      listEnrolments(db, id),
      listImmunisation(db, id),
      // For the "signed in" chip. Derived from the events like everywhere else — there is no
      // stored "present" flag to read, deliberately.
      listAttendanceToday(db, ctx.centre.id),
    ]);

  const sorted = [...conditions].sort(compareBySeverity);
  const critical = sorted.filter((c) => c.severity === 'anaphylaxis' || c.severity === 'severe');
  const gaps = missingConsents(consents);
  const state = attendance.find((s) => s.childId === id);
  const signedInAt = state?.kind === 'in' ? state.at : null;

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
        </div>

        {/*
          Whether this child is in the building, on the record itself. The question "is this
          child here" arrives at the same moment as "what is this child allergic to", and the
          answer was previously only on /attendance.
        */}
        <span className="record-status">
          <Status tone={signedInAt ? 'ok' : 'neutral'}>
            {signedInAt
              ? `Signed in ${new Date(signedInAt).toLocaleTimeString('en-NZ', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : 'Not signed in today'}
          </Status>
        </span>
      </div>

      {/*
        Directly under the name and above everything else about this child.

        Breach tone for a condition that can kill, warn for anything overdue or unanswered.
        Every one of these is the same record shown elsewhere, lifted — removing a condition
        under Health removes it here, because there is one source and this reads it.
      */}
      {(critical.length > 0 ||
        medications.length > 0 ||
        gaps.length > 0 ||
        enrolments.length === 0 ||
        immunisation.length === 0) && (
        <div className="record-flags">
          {critical.map((c) => (
            /*
              `role="note"` rather than a plain Status: this is an aside about the child that
              a screen reader should announce as one, and it is the same treatment the roll
              gives the same information.
            */
            <span className="flag flag-critical" role="note" key={c.id}>
              <span aria-hidden="true">▲</span>{' '}
              {c.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe'}: {c.name}
              {c.responsePlan ? ` — ${c.responsePlan}` : ''}
            </span>
          ))}
          {medications.length > 0 && (
            <Status tone="warn">
              {medications.length} medication{medications.length === 1 ? '' : 's'} authorised
            </Status>
          )}
          {/*
            Not shown to a parent. An unanswered consent is a job for the office to chase; a
            family reading "2 consent unanswered" about their own child on a screen with no
            control to answer it has been told off by a database.
          */}
          {gaps.length > 0 && ctx.role !== 'parent' && (
            <Status tone="warn" symbol="◌">
              {gaps.length} consent unanswered
            </Status>
          )}
          {enrolments.length === 0 && (
            <Status tone="warn" symbol="◌">
              No enrolment on file
            </Status>
          )}
          {immunisation.length === 0 && (
            <Status tone="warn" symbol="◌">
              No immunisation record
            </Status>
          )}
        </div>
      )}

      {/*
        Reference text. Age, date of birth and enrolment date are read by somebody sitting
        down — they are what this child *is*, not what is wrong, and they sit below the things
        that are.
      */}
      <p className="record-meta">
        {formatAge(child.dateOfBirth, today)} · born {child.dateOfBirth}
        {isUnderTwo(child.dateOfBirth, today) ? ' · under 2' : ''}
        {child.archivedAt ? ' · left the centre' : ''}
      </p>

      <RecordTabs childId={id} role={ctx.role} />

      {children}
    </div>
  );
}
