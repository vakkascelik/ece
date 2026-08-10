import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getChild,
  listAdministrations,
  listAttendanceToday,
  listChildBookings,
  listConfirmations,
  listChildIncidents,
  listConsentHistory,
  listConsents,
  listCustodyArrangements,
  listEnrolments,
  guardianPinStatus,
  listGuardiansOfChild,
  listHealthConditions,
  listImmunisation,
  listMembers,
  listMedications,
} from '@ece/api';
import {
  can,
  compareBySeverity,
  dosesOnDate,
  displayName,
  formatAge,
  hasCriticalCondition,
  initials,
  isUnderTwo,
  missingConsents,
  shiftLocalDate,
  todayInZone,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { HelpNote } from '../../HelpNote';
import { BookingsPanel } from './BookingsPanel';
import { ConfirmPanel } from './ConfirmPanel';
import { ArchivePanel } from './ArchivePanel';
import { ConsentPanel } from './ConsentPanel';
import { CustodyPanel } from './CustodyPanel';
import { DetailsForm } from './DetailsForm';
import { EnrolmentPanel } from './EnrolmentPanel';
import { HealthPanel, type DosesToday } from './HealthPanel';
import type { WitnessOption } from './GiveMedicine';
import { ImmunisationPanel, type ImmunisationRow } from './ImmunisationPanel';
import { IncidentsPanel, type ChildIncident } from './IncidentsPanel';
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

  const [
    conditions,
    medications,
    whanau,
    enrolments,
    consents,
    history,
    custody,
    attendance,
    incidents,
    doses,
    members,
    immunisation,
    bookings,
    confirmations,
  ] = await Promise.all([
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
    // Unconditional. A parent's query comes back without drafts because the policy
    // withholds them, not because this call was narrowed — see 0030.
    listChildIncidents(db, id),
    listAdministrations(db, id),
    // Only for the witness selector, and only when the centre has asked for one.
    // A guardian has no business enumerating the staff list.
    ctx.centre.medicationRequiresWitness && can(ctx.role, 'recordDailyPractice')
      ? listMembers(db, ctx.centre.id)
      : Promise.resolve([]),
    // Unconditional: a family is entitled to see what the centre recorded about their
    // own child, and 0036's policy is what decides who that is.
    listImmunisation(db, id),
    // Four weeks forward, from the centre's today. A guardian reports an absence from
    // here; 0051 is what decides they may, and it refuses a past date regardless of
    // what this window happens to include.
    listChildBookings(db, id, today, shiftLocalDate(today, 28)),
    // Unconditional: a family is entitled to see when they last confirmed, and staff are
    // entitled to see it too — 0055's select policy is what decides who that is.
    listConfirmations(db, id, 1),
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

  /*
    Door-tablet PIN state, one call per guardian and only for the office.

    N calls rather than one, because 0044 exposes `guardian_pin_status` per guardian
    and a list version would be a second definer function returning more than any
    screen needs. A child has a handful of guardians, and this is the read that stops
    the office guessing why a parent cannot sign in at the door.

    Not fetched at all for a parent or an educator: the function refuses them anyway,
    so asking would be a round trip whose only possible answer is nothing.
  */
  const pinStatuses = canManage
    ? Object.fromEntries(
        await Promise.all(
          whanau.map(
            async (g) => [g.guardian.id, await guardianPinStatus(db, g.guardian.id)] as const,
          ),
        ),
      )
    : {};

  const enrolledOn = enrolments.length > 0 ? enrolments[0].startDate : null;

  /*
    Formatted here rather than in the panel, in the centre's zone, like every other time on
    this page. A client component formatting it would use the browser's zone — which for a
    manager checking from home on holiday is not the centre's, and for a date that a
    reviewer may read back is the wrong one.
  */
  const lastConfirmed =
    confirmations.length > 0
      ? new Intl.DateTimeFormat('en-NZ', {
          timeZone: ctx.centre.timezone,
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(new Date(confirmations[0].confirmedAt))
      : null;

  /*
    Formatted on the server in the centre's zone, like every other time in this
    product. A parent opening this from a phone in another country must see the time
    the incident happened at the centre, not the time it was on their own clock.
  */
  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  /*
    Doses given today, per authority.

    `liveAdministrations` drops rows that a later row corrects — transitively — so a
    corrected dose does not appear twice. `dosesOnDate` is handed a formatter rather
    than reaching for `Intl` itself, so the "today" it filters on is the centre's day
    and not the server's.
  */
  const toLocalDate = (instant: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: ctx.centre.timezone }).format(new Date(instant));
  const clock = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const dosesToday: DosesToday[] = medications.map((m) => ({
    authorityId: m.id,
    entries: dosesOnDate(doses, m.id, today, toLocalDate)
      .slice()
      .sort((a, b) => a.givenAt.localeCompare(b.givenAt))
      .map((d) => `${clock.format(new Date(d.givenAt))} · ${d.doseGiven}`),
  }));

  const witnesses: WitnessOption[] = members
    .filter((m) => m.role !== 'parent')
    .map((m) => ({ userId: m.userId, label: m.email ?? m.userId }));

  const immunisationRows: ImmunisationRow[] = immunisation.map((record) => ({
    record,
    recordedLabel: when.format(new Date(record.recordedAt)),
    sightedLabel: record.sightedAt ? when.format(new Date(record.sightedAt)) : null,
  }));

  const incidentRows: ChildIncident[] = incidents.map((incident) => ({
    incident,
    occurredLabel: when.format(new Date(incident.occurredAt)),
    notifiedLabel: incident.parentNotifiedAt ? when.format(new Date(incident.parentNotifiedAt)) : null,
    acknowledgedLabel: incident.acknowledgedAt ? when.format(new Date(incident.acknowledgedAt)) : null,
  }));

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
          <div className="has-help">
            <h2>Read this first</h2>
            <HelpNote label="Read this first">
              <p>
                This block appears only when a child has a condition recorded as
                anaphylaxis or severe. It repeats the response plan at the top of the
                record so it is not something anybody has to scroll for.
              </p>
              <p>
                It is not a separate list — it is the same conditions shown under Health,
                lifted up. Removing a condition there removes it here.
              </p>
            </HelpNote>
          </div>
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
        <div className="has-help">
          <h2>Health</h2>
          <HelpNote label="Health">
            <p>
              Allergies, conditions, medication and immunisations. Anything marked
              anaphylaxis or severe is also lifted to the top of this record.
            </p>
            <p>
              Educators can record a condition here, not only the office. Something a
              family mentions at the door at eight in the morning has to be writable by
              the person who was told, rather than waiting for somebody with an office
              login.
            </p>
          </HelpNote>
        </div>
        <HealthPanel
          childId={child.id}
          conditions={sorted}
          medications={medications}
          guardians={whanau.map((g) => ({ id: g.guardian.id, name: g.guardian.fullName }))}
          canEdit={can(ctx.role, 'recordHealth')}
          today={today}
          dosesToday={dosesToday}
          canGive={can(ctx.role, 'recordDailyPractice')}
          requiresWitness={ctx.centre.medicationRequiresWitness}
          witnesses={witnesses}
          currentUserId={ctx.userId}
        />
      </div>

      {/*
        Above consent for a family, because it is the only thing on this page they can
        ACT on — everything else is a record they read. A parent opening this screen at
        7am with a sick child should not have to scroll past the consent history.
      */}
      <div className="section">
        <div className="has-help">
          <h2>Booked days</h2>
          <HelpNote label="Booked days">
            <p>
              The days this child is expected. Bookings are what the roster is planned
              against and are separate from attendance, which is what actually happened.
            </p>
            <p>
              A parent sees this panel too and can tell the centre their child will not be
              in. That records an absence — it does not cancel the booking and it does not
              change what the family is charged.
            </p>
          </HelpNote>
        </div>
        <div className="card">
          <BookingsPanel bookings={bookings} isParent={ctx.role === 'parent'} />
        </div>
      </div>

      {/* Consent second, per the pack — it gates whether a photo may exist at all. */}
      <div className="section">
        <div className="has-help">
          <h2>Consent</h2>
          <HelpNote label="Consent">
            <p>
              What this family has agreed to — photographs, outings, and the rest. Each
              decision records who gave it and when, and changing one adds a new decision
              rather than overwriting the old one, so the history stays readable.
            </p>
            <p>
              This is not paperwork that sits beside the product. A photograph of a child
              cannot be attached to a post unless a consent decision has been recorded
              here first.
            </p>
          </HelpNote>
        </div>
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

      {/*
        Directly after Consent because both are things a family reads and one of the
        two things on this page a family writes. A parent's query returns no drafts —
        0030's policy sees to that, not this page.
      */}
      {/*
        After Health and before Consent: it is health information, and it belongs next
        to the allergies rather than filed with the office paperwork.
      */}
      <div className="section">
        <ImmunisationPanel
          childId={child.id}
          rows={immunisationRows}
          canRecord={can(ctx.role, 'recordHealth')}
          isParent={ctx.role === 'parent'}
        />
      </div>

      <div className="section">
        <IncidentsPanel
          childId={child.id}
          rows={incidentRows}
          isParent={ctx.role === 'parent'}
          ownGuardianId={ownGuardianId}
        />
      </div>

      <div className="section">
        <div className="has-help">
          <h2>Whānau</h2>
          <HelpNote label="Whānau">
            <p>
              Who this child belongs to, in the order you would ring them, and which of
              them may collect. A guardian with a login sees this child’s record; one
              without is a contact card.
            </p>
            <p>
              The confirmation date says when a parent or caregiver last said these
              details were right. It does not mean nothing has changed since — if a phone
              number was edited afterwards, that date does not move.
            </p>
          </HelpNote>
        </div>
        <WhanauPanel
          childId={child.id}
          whanau={whanau}
          canEdit={canManage}
          isParent={ctx.role === 'parent'}
          pinStatuses={pinStatuses}
        />
        {/*
          Inside the whānau section rather than beside it, because the thing being confirmed
          is what is directly above: the contacts, the phone numbers, who may collect. A
          confirmation control sitting in its own section would be confirming nothing in
          particular, which is how "confirmed" ends up meaning "clicked".
        */}
        <div className="card" style={{ marginTop: '1rem' }}>
          <ConfirmPanel
            childId={child.id}
            ownGuardianId={ownGuardianId}
            lastConfirmed={lastConfirmed}
            isParent={ctx.role === 'parent'}
          />
        </div>
      </div>

      <div className="section">
        <div className="has-help">
          <h2>Enrolment</h2>
          <HelpNote label="Enrolment">
            <p>
              Start and end dates, the days and the funded hours. These are the figures
              the funding screen works from, so an enrolment that is wrong here is a
              funding claim that is wrong there.
            </p>
            <p>
              A child who has left keeps their record until it is archived and, later,
              purged — leaving is an end date, not a deletion.
            </p>
          </HelpNote>
        </div>
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
          <div className="has-help">
            <h2>Custody and court orders</h2>
            <HelpNote label="Custody and court orders">
              <p>
                Owners and managers only. Educators and whānau do not see this section at
                all — not an empty one, not a locked one.
              </p>
              <p>
                That is deliberate. A heading reading “Custody” with nothing under it
                would tell an educator that a court order exists for this child, which is
                most of what the restriction is protecting.
              </p>
            </HelpNote>
          </div>
          <CustodyPanel childId={child.id} arrangements={custody} />
        </div>
      )}

      {/*
        Identity metadata last. It is the block a manager edits sitting down, and the pack
        is explicit that it belongs below health — the header above already carries the
        name, age and enrolment date that anybody reading in a hurry needs.
      */}
      <div className="section">
        <div className="has-help">
          <h2>Details</h2>
          <HelpNote label="Details">
            <p>
              Name, date of birth and the rest of the identity record. It sits at the
              bottom because the header above already carries the name, age and enrolment
              date that anybody reading in a hurry needs.
            </p>
            <p>
              The date of birth decides which ratio band this child counts in, so a
              correction here changes the figures on the attendance and roster screens.
            </p>
          </HelpNote>
        </div>
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
