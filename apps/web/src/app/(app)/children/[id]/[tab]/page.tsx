import { notFound } from 'next/navigation';
import {
  getChild,
  listAdministrations,
  listChildAddresses,
  listChildBookings,
  listChildIncidents,
  listConfirmations,
  listConsentHistory,
  listConsentRequests,
  listConsents,
  listCustodyArrangements,
  listBookingSchedule,
  listExemptionsForChild,
  listReconfirmationsForChild,
  listEnrolments,
  guardianPinStatus,
  listGuardiansOfChild,
  listHealthConditions,
  listIdentityDocuments,
  listImmunisation,
  listMembers,
  listMedications,
  listVerificationOverview,
} from '@ece/api';
import {
  can,
  compareBySeverity,
  dosesOnDate,
  isEnrolmentCurrent,
  lastCompletedWeek,
  shiftLocalDate,
  summariseVerification,
  todayInZone,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { HelpNote } from '../../../HelpNote';
import { AddressPanel } from '../AddressPanel';
import { IdentityDocumentsPanel } from '../IdentityDocumentsPanel';
import { ArchivePanel } from '../ArchivePanel';
import { BookingsPanel } from '../BookingsPanel';
import { ConfirmPanel } from '../ConfirmPanel';
import { ConsentPanel } from '../ConsentPanel';
import { CustodyPanel } from '../CustodyPanel';
import { DetailsForm } from '../DetailsForm';
import { BookingSchedulePanel } from '../BookingSchedulePanel';
import { ExemptionPanel } from '../ExemptionPanel';
import { ReconfirmationPanel } from '../ReconfirmationPanel';
import { EnrolmentPanel } from '../EnrolmentPanel';
import type { WitnessOption } from '../GiveMedicine';
import { HealthPanel, type DosesToday } from '../HealthPanel';
import { ImmunisationPanel, type ImmunisationRow } from '../ImmunisationPanel';
import { IncidentsPanel, type ChildIncident } from '../IncidentsPanel';
import { VerifyWeeksPanel, type VerifyWeekRow } from '../VerifyWeeksPanel';
import { WhanauPanel } from '../WhanauPanel';
import { TAB_SLUGS } from '../tabs';

/**
 * Whānau, Health, Attendance and Documents. The overview is the record's own route.
 *
 * ONE ROUTE FOR FOUR TABS, NOT FOUR ROUTES
 *
 * Because they are four groupings of the same record and every one of them needs the same
 * `getChild` guard, the same centre date and the same `notFound()` on a slug nobody defined.
 * Four files would be four copies of that preamble, and the day somebody adds a fifth tab is
 * the day one of the four copies is missed.
 *
 * Each branch fetches only what it renders. That is not a micro-optimisation: the single-page
 * version issued fourteen queries on every open, including the medication doses for a manager
 * who came to fix a spelling. A tab that is not open costs nothing now.
 *
 * An unknown slug is `notFound()`, not a redirect to the overview. `/children/x/finance`
 * should say it does not exist rather than quietly showing something else — a redirect there
 * would make a typo look like a working link.
 */
export default async function ChildTabPage({
  params,
}: {
  params: Promise<{ id: string; tab: string }>;
}) {
  const { id, tab } = await params;
  if (!TAB_SLUGS.includes(tab)) notFound();

  const ctx = await requireCtx();
  const db = await serverDb();

  const child = await getChild(db, id);
  // Indistinguishable from "does not exist", on purpose — see the layout.
  if (!child) notFound();

  const today = todayInZone(ctx.centre.timezone);
  const canManage = can(ctx.role, 'manageChildren');
  const isParent = ctx.role === 'parent';

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (tab === 'whanau') {
    const [whanau, confirmations, custody, addresses] = await Promise.all([
      listGuardiansOfChild(db, id),
      // Unconditional: a family is entitled to see when they last confirmed, and staff are
      // entitled to see it too — 0055's select policy is what decides who that is.
      listConfirmations(db, id, 1),
      // Owner/manager only, and the query is not even issued for anybody else. The panel is
      // also absent below; both halves matter, because a request that returns nothing still
      // tells a log that somebody asked.
      can(ctx.role, 'viewCustody') ? listCustodyArrangements(db, id) : Promise.resolve([]),
      // Unconditional as well, and for the reason 0086's select policy already settles: an
      // educator hands the child over at the door and may read where they go home to. What
      // they do not get is the form, which is `canManage` below.
      listChildAddresses(db, [id]),
    ]);

    const ownGuardianId = whanau.find((g) => g.guardian.userId === ctx.userId)?.guardian.id ?? null;

    /*
      Not fetched at all for a parent or an educator: the function refuses them anyway, so
      asking would be a round trip whose only possible answer is nothing.
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

    /*
      Formatted here rather than in the panel, in the centre's zone, like every other time on
      this record. A client component formatting it would use the browser's zone — which for a
      manager checking from home on holiday is not the centre's, and for a date a reviewer may
      read back is the wrong one.
    */
    const lastConfirmed =
      confirmations.length > 0
        ? new Intl.DateTimeFormat('en-NZ', {
            timeZone: ctx.centre.timezone,
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(new Date(confirmations[0]!.confirmedAt))
        : null;

    return (
      <>
        <div className="section">
          <div className="has-help">
            <h2>Whānau</h2>
            <HelpNote label="Whānau">
              <p>
                Who this child belongs to, in the order you would ring them, and which of them
                may collect. A guardian with a login sees this child’s record; one without is a
                contact card.
              </p>
              <p>
                The confirmation date says when a parent or caregiver last said these details
                were right. It does not mean nothing has changed since — if a phone number was
                edited afterwards, that date does not move.
              </p>
            </HelpNote>
          </div>
          <WhanauPanel
            childId={id}
            whanau={whanau}
            canEdit={canManage}
            isParent={isParent}
            pinStatuses={pinStatuses}
          />
          {/*
            Inside the whānau section rather than beside it, because the thing being confirmed
            is what is directly above: the contacts, the phone numbers, who may collect. A
            confirmation control in its own section would be confirming nothing in particular,
            which is how "confirmed" ends up meaning "clicked".
          */}
          <div className="card" style={{ marginTop: '1rem' }}>
            <ConfirmPanel
              childId={id}
              ownGuardianId={ownGuardianId}
              lastConfirmed={lastConfirmed}
              isParent={isParent}
            />
          </div>
        </div>

        {/*
          Its own section rather than a card inside the whanau one, because it is a different
          subject: those are people and this is a place. Directly beside them all the same, since
          the case 0086 exists for is only obvious next to them — a child living with a
          grandparent while the first contact is a parent somewhere else.

          `manageEnrolment` rather than the `canManage` used above, matching the capability the
          action actually requires. The two role lists are identical today, so this is not a live
          bug being fixed — it is a screen and a server action agreeing by name rather than by
          coincidence, which is what stops the next change to one list from drawing a form that
          can only fail.
        */}
        <div className="section">
          <div className="has-help">
            <h2>Where the child lives</h2>
            <HelpNote label="Where the child lives">
              <p>
                The child&rsquo;s own residential address, which the ECE Funding Handbook requires
                as part of the enrolment record. It is deliberately separate from the addresses on
                the contacts above: a child may live with a grandparent while the first person you
                ring is a parent somewhere else.
              </p>
              <p>
                Five fields rather than one box because the Ministry&rsquo;s enrolment record asks
                for the street and the town separately. Splitting one line into the two later would
                mean guessing which part is the suburb.
              </p>
              <p>
                A second household is for a child who lives in two places. Leave it empty
                otherwise &mdash; an empty one says the same thing as no answer, which is the
                honest record.
              </p>
            </HelpNote>
          </div>
          <AddressPanel
            childId={id}
            addresses={addresses}
            canEdit={can(ctx.role, 'manageEnrolment')}
          />
        </div>

        {/*
          Custody is owner/manager only. Not rendered at all for anyone else — an empty
          "Custody" heading tells an educator that a court order exists, which is most of what
          the restriction is protecting. That is also why it is on this tab rather than a tab
          of its own: a tab labelled "Custody" that only two roles can see announces itself by
          being missing.
        */}
        {can(ctx.role, 'viewCustody') && (
          <div className="section">
            <div className="has-help">
              <h2>Custody and court orders</h2>
              <HelpNote label="Custody and court orders">
                <p>
                  Owners and managers only. Educators and whānau do not see this section at all
                  — not an empty one, not a locked one.
                </p>
                <p>
                  That is deliberate. A heading reading “Custody” with nothing under it would
                  tell an educator that a court order exists for this child, which is most of
                  what the restriction is protecting.
                </p>
              </HelpNote>
            </div>
            <CustodyPanel childId={id} arrangements={custody} />
          </div>
        )}
      </>
    );
  }

  if (tab === 'health') {
    const [conditions, medications, doses, members, immunisation, whanau] = await Promise.all([
      listHealthConditions(db, id),
      listMedications(db, id),
      listAdministrations(db, id),
      // Only for the witness selector, and only when the centre has asked for one. A guardian
      // has no business enumerating the staff list.
      ctx.centre.medicationRequiresWitness && can(ctx.role, 'recordDailyPractice')
        ? listMembers(db, ctx.centre.id)
        : Promise.resolve([]),
      // Unconditional: a family is entitled to see what the centre recorded about their own
      // child, and 0036's policy is what decides who that is.
      listImmunisation(db, id),
      listGuardiansOfChild(db, id),
    ]);

    /*
      Doses given today, per authority.

      `liveAdministrations` drops rows that a later row corrects — transitively — so a
      corrected dose does not appear twice. `dosesOnDate` is handed a formatter rather than
      reaching for `Intl` itself, so the "today" it filters on is the centre's day and not the
      server's.
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

    return (
      <>
        {/*
          The "Read this first" block that used to sit at the top of the record is gone, and
          nothing was lost: it repeated the anaphylaxis and severe conditions, and those are
          now in the header on every tab rather than at the top of one. A second copy on this
          tab would be the same information three times on one screen.
        */}
        <div className="section">
          <div className="has-help">
            <h2>Health</h2>
            <HelpNote label="Health">
              <p>
                Allergies, conditions, medication and immunisations. Anything marked anaphylaxis
                or severe is also shown in the header of this record, on every tab.
              </p>
              <p>
                Educators can record a condition here, not only the office. Something a family
                mentions at the door at eight in the morning has to be writable by the person
                who was told, rather than waiting for somebody with an office login.
              </p>
            </HelpNote>
          </div>
          <HealthPanel
            childId={id}
            conditions={[...conditions].sort(compareBySeverity)}
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

        {/* Health information, so it belongs next to the allergies rather than filed with the
            office paperwork. */}
        <div className="section">
          <ImmunisationPanel
            childId={id}
            rows={immunisationRows}
            canRecord={can(ctx.role, 'recordHealth')}
            isParent={isParent}
          />
        </div>
      </>
    );
  }

  if (tab === 'attendance') {
    const [bookings, incidents, whanau, overview] = await Promise.all([
      listChildBookings(db, id, today, shiftLocalDate(today, 28)),
      // Unconditional. A parent's query comes back without drafts because the policy withholds
      // them, not because this call was narrowed — see 0030.
      listChildIncidents(db, id),
      // Now fetched for every role: the verify panel needs the caller's own signatory
      // flag, and staff read it to render the panel without buttons.
      listGuardiansOfChild(db, id),
      listVerificationOverview(db, {
        centreId: child.centreId,
        lastCompletedMonday: lastCompletedWeek(today).periodStart,
        weeksBack: 4,
      }),
    ]);

    const ownGuardianId =
      whanau.find((g) => g.guardian.userId === ctx.userId)?.guardian.id ?? null;

    /*
      §6-3 weeks, derived here against the centre's today — the overview is per centre and
      per ward for a parent (the invoker function's policies decide), so filter to this
      child. Newest first: the week most likely to need the signature is the last one.
    */
    const timeOf = new Intl.DateTimeFormat('en-NZ', {
      timeZone: ctx.centre.timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const dayOf = new Intl.DateTimeFormat('en-CA', {
      timeZone: ctx.centre.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const weekRows: VerifyWeekRow[] = overview
      .filter((w) => w.childId === id)
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
      .map((w) => {
        const s = summariseVerification(w, today);
        // `not-yet-due` cannot occur — the overview generates completed weeks only — but
        // the type says it can, and excluding it here beats a lying status label.
        if (s.status === 'not-yet-due') return null;

        const byDay = new Map<string, string[]>();
        for (const e of w.weekEvents) {
          const day = dayOf.format(new Date(e.at));
          byDay.set(day, [
            ...(byDay.get(day) ?? []),
            `${e.kind === 'in' ? 'in' : 'out'} ${timeOf.format(new Date(e.at))}`,
          ]);
        }
        const dayLines: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = shiftLocalDate(w.periodStart, i);
          const [yy, mm, dd] = date.split('-').map(Number);
          const label = new Intl.DateTimeFormat('en-NZ', {
            timeZone: 'UTC',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(new Date(Date.UTC(yy as number, (mm as number) - 1, dd as number)));
          const times = byDay.get(date);
          dayLines.push(`${label} — ${times ? times.join(', ') : 'nothing recorded'}`);
        }

        return {
          periodStart: w.periodStart,
          periodEnd: w.periodEnd,
          status: s.status,
          weekLabel: dayLines[0]!.split(' — ')[0]!.replace('Monday ', ''),
          dayLines,
        } satisfies VerifyWeekRow;
      })
      .filter((w): w is VerifyWeekRow => w !== null);

    const isSignatory =
      whanau.find((g) => g.guardian.userId === ctx.userId)?.isAuthorisedSignatory ?? false;

    const incidentRows: ChildIncident[] = incidents.map((incident) => ({
      incident,
      occurredLabel: when.format(new Date(incident.occurredAt)),
      notifiedLabel: incident.parentNotifiedAt
        ? when.format(new Date(incident.parentNotifiedAt))
        : null,
      acknowledgedLabel: incident.acknowledgedAt
        ? when.format(new Date(incident.acknowledgedAt))
        : null,
    }));

    return (
      <>
        <div className="section">
          <h2>Booked days</h2>
          <div className="card">
            <BookingsPanel bookings={bookings} isParent={isParent} />
          </div>
        </div>

        <div className="section">
          <h2>Weekly record</h2>
          <VerifyWeeksPanel
            childId={id}
            ownGuardianId={ownGuardianId}
            isSignatory={isSignatory}
            weeks={weekRows}
          />
        </div>

        <div className="section">
          <IncidentsPanel
            childId={id}
            rows={incidentRows}
            isParent={isParent}
            ownGuardianId={ownGuardianId}
          />
        </div>
      </>
    );
  }

  // Documents: the paperwork. Consent decisions, the enrolment, the identity record, and
  // leaving — the things a manager opens sitting down, which is why they are behind a tab
  // rather than above the fold.
  const canEnrol = can(ctx.role, 'manageEnrolment');
  const [
    consents,
    history,
    requests,
    whanau,
    enrolments,
    schedule,
    exemptions,
    reconfirmations,
    identityDocuments,
    docMembers,
  ] = await Promise.all([
    listConsents(db, id),
    listConsentHistory(db, id),
    listConsentRequests(db, id),
    listGuardiansOfChild(db, id),
    listEnrolments(db, id),
    listBookingSchedule(db, [id]),
    listExemptionsForChild(db, id),
    listReconfirmationsForChild(db, id),
    /*
      Unconditional, and 0097's select policy is what decides who sees it: `caller_may_see_child`,
      so a guardian reads their own child's sightings. That is right — "the centre has seen my
      child's birth certificate" is a fact about their own record.
    */
    listIdentityDocuments(db, [id]),
    /*
      Conditional, and this follows the health tab's precedent verbatim: **a guardian has no
      business enumerating the staff list.** The member list exists only to turn a `sighted_by`
      into a name, so it is loaded for somebody who may record a sighting and for nobody else. A
      guardian sees that a document was sighted and on what date, without a staff email attached.
    */
    canEnrol ? listMembers(db, ctx.centre.id) : Promise.resolve([]),
  ]);
  const ownGuardianId = whanau.find((g) => g.guardian.userId === ctx.userId)?.guardian.id ?? null;
  const currentEnrolment = enrolments.find((e) => isEnrolmentCurrent(e, today));

  /*
    The signatory pickers on the two panels below. §6-1 wants a dated signature from "at least
    one parent/guardian", and 0087 stores it as a `guardians` reference with a trigger
    requiring a CURRENT guardian of this child.

    `listGuardiansOfChild` already filters revoked links, which is the same condition the
    trigger applies — so this list offers exactly the people the database will accept, and a
    picker cannot present a choice that is then refused.
  */
  const signatories = whanau.map((g) => ({ id: g.guardian.id, name: g.guardian.fullName }));

  return (
    <>
      <div className="section">
        <div className="has-help">
          <h2>Consent</h2>
          <HelpNote label="Consent">
            <p>
              What this family has agreed to — photographs, outings, and the rest. Each decision
              records who gave it and when, and changing one adds a new decision rather than
              overwriting the old one, so the history stays readable.
            </p>
            <p>
              This is not paperwork that sits beside the product. A photograph of a child cannot
              be attached to a post unless a consent decision has been recorded here first.
            </p>
          </HelpNote>
        </div>
        <ConsentPanel
          childId={id}
          consents={consents}
          history={history}
          requests={requests}
          guardians={whanau.map((g) => ({ id: g.guardian.id, name: g.guardian.fullName }))}
          canRecord={can(ctx.role, 'recordConsent')}
          isParent={isParent}
          ownGuardianId={ownGuardianId}
        />
      </div>

      <div className="section">
        <div className="has-help">
          <h2>Enrolment</h2>
          <HelpNote label="Enrolment">
            <p>
              Start and end dates, the days and the funded hours. These are the figures the
              funding screen works from, so an enrolment that is wrong here is a funding claim
              that is wrong there.
            </p>
            <p>
              A child who has left keeps their record until it is archived and, later, purged —
              leaving is an end date, not a deletion.
            </p>
          </HelpNote>
        </div>
        <EnrolmentPanel
          guardians={signatories}
          childId={id}
          enrolments={enrolments}
          /*
            The agreement's own weekdays, so this panel cannot disagree with the funded figure —
            item 53. The schedule is already read for the panel below it.
          */
          schedule={schedule}
          canEdit={can(ctx.role, 'manageEnrolment')}
          today={today}
        />
      </div>

      <div className="section">
        <div className="has-help">
          <h2>Days and times</h2>
          <HelpNote label="Days and times">
            <p>
              The days and times this child is expected to attend &mdash; the enrolment agreement.
              The Ministry requires an enrolment record to state them, and to record any later
              change signed and dated by a parent or guardian.
            </p>
            <p>
              This is what the funding rules mean by the hours a child is <em>enrolled to attend</em>,
              as distinct from the hours they actually attended. Both matter: a permanently enrolled
              child can be claimed for some booked absences, and whether their attendance matches
              this agreement decides for how long.
            </p>
            <p>
              To change a day, end the current block and add the new one. Editing in place would
              lose what the agreement said last term, which is what an earlier funding claim was
              calculated from.
            </p>
          </HelpNote>
        </div>
        {/*
          The current enrolment's days, for the comparison note when no schedule exists yet.
          `find`, not `[0]`: enrolments are newest-first but a child who left and came back has
          two rows, and the open one is not necessarily the first.
        */}
        {/*
          §7-7's exemptions, beside the agreement they scope to. The funding calculation has read
          this table since 2026-09-04 and nothing could write it until 2026-09-05, so every
          absence window was three weeks — see AST50's mapping table, which is what found it.
        */}
        {/*
          §6-7's reconfirmations, beside the agreement they unlock a claim against. Same story as
          the exemptions above: read by the funding calculation since 2026-09-04, writable since
          2026-09-05.
        */}
        <ReconfirmationPanel
          childId={id}
          enrolmentId={currentEnrolment?.id ?? null}
          reconfirmations={reconfirmations}
          guardians={signatories}
          canEdit={can(ctx.role, 'manageCentre')}
        />
        <ExemptionPanel
          childId={id}
          enrolmentId={currentEnrolment?.id ?? null}
          exemptions={exemptions}
          canEdit={can(ctx.role, 'manageCentre')}
          today={today}
        />
        <BookingSchedulePanel
          guardians={signatories}
          childId={id}
          blocks={schedule}
          canEdit={can(ctx.role, 'manageEnrolment')}
          today={today}
          enrolmentDays={currentEnrolment?.days ?? []}
        />
      </div>

      <div className="section">
        <div className="has-help">
          <h2>Details</h2>
          <HelpNote label="Details">
            <p>
              Name, date of birth and the rest of the identity record. It sits here rather than
              in front of anybody, because the header above already carries the name and age
              that somebody reading in a hurry needs.
            </p>
            <p>
              The date of birth decides which ratio band this child counts in, so a correction
              here changes the figures on the attendance and roster screens.
            </p>
          </HelpNote>
        </div>
        <DetailsForm child={child} readOnly={!canManage} />
      </div>

      <div className="section">
        <IdentityDocumentsPanel
          childId={id}
          canEdit={canEnrol}
          /*
            Formatted here, in the CENTRE'S timezone, and that is the whole reason these rows are
            built rather than passed through. `sightedAt` is a UTC instant; slicing its date part
            renders yesterday for anything sighted before noon in New Zealand, on the record whose
            entire purpose is saying when somebody looked.

            The email rather than a name is what this product holds — `centre_members` has no
            display name. An id `docMembers` cannot resolve is a colleague who has since left:
            `0097` nulls `sighted_by` on user deletion, so "nobody sighted it" and "somebody did and
            we cannot name them" stay distinguishable, which is why `sightedLabel` rather than
            `sightedBy` decides which the panel shows.
          */
          documents={identityDocuments.map((d) => ({
            id: d.id,
            kind: d.kind,
            sightedLabel: d.sightedAt ? when.format(new Date(d.sightedAt)) : null,
            sightedBy:
              d.sightedBy === null
                ? null
                : (docMembers.find((m) => m.userId === d.sightedBy)?.email ?? null),
            note: d.note,
          }))}
        />
      </div>

      {canManage && !child.archivedAt && (
        <div className="section">
          <h2>Leaving</h2>
          <ArchivePanel childId={id} name={child.preferredName || child.firstName} />
        </div>
      )}
    </>
  );
}
