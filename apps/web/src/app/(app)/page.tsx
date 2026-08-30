import Link from 'next/link';
import {
  listAttendanceToday,
  listChildren,
  listConsentsByChild,
  listDrills,
  listHazards,
  listIncidents,
  listStaffRecords,
  readAdultsPresent,
} from '@ece/api';
import {
  CONSENT_DETAIL,
  assessAll,
  assessRatio,
  can,
  displayName,
  drillStatuses,
  missingConsents,
  splitByAgeBand,
  summarise,
  summariseHazards,
  summariseIncidents,
  todayInZone,
} from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { Launcher } from './Launcher';
import { PageHeader } from './PageHeader';
import { Status } from './Status';
import { RatioBanner } from './attendance/RatioBanner';
import './attendance/attendance.css';
import './overview.css';

/**
 * The first screen after signing in.
 *
 * WHAT IT USED TO BE, AND WHY THAT WAS WORSE THAN EMPTY
 *
 * A count of who has a login, and a card explaining that under-5 records are sensitive. Neither
 * is a thing anybody signs in to find out. The screen every person in this product lands on
 * answered no question they arrived with, which is a harder problem than it looks: a manager
 * opening the app at 9am wants to know whether the room is within ratio and what is unfinished,
 * and was being shown an inventory of accounts.
 *
 * IT COUNTS WHAT IS OUTSTANDING, NEVER WHAT HAPPENED
 *
 * The same rule the incident register and every list header follow. A centre with forty
 * resolved incidents is in the same state as one with none; a counter that only goes up is a
 * counter nobody reads. So every figure below is something somebody can still act on, and when
 * there is nothing to act on the screen says so in one line rather than listing zeroes.
 *
 * EVERY READ IS GATED BY THE CAPABILITY THAT OWNS ITS SCREEN
 *
 * Not for secrecy — the policies decide what comes back — but because an educator has no
 * business paying for a compliance query to render a card they will not be shown. The gating
 * here is the same `can()` the rail uses, and it is presentation: `requireCapability` on each
 * destination and RLS underneath it are what actually refuse.
 *
 * NOTHING HERE IS A NEW SOURCE OF TRUTH
 *
 * Every number is the same call the screen it links to makes — `summariseIncidents`,
 * `summariseHazards`, `assessAll`, `assessRatio`. A dashboard that computes its own version of a
 * figure is a dashboard that eventually disagrees with the page it links to, and the one people
 * believe is whichever they saw last.
 */
export default async function OverviewPage() {
  const ctx = await requireCtx();
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const daily = can(ctx.role, 'recordDailyPractice');
  const office = can(ctx.role, 'manageCentre');

  /*
    A parent's own screen, and the one thing this page has ever had to say to them.

    The child record's header carries `showConsentGap={!isParent}`, and its comment gives the
    reason: "a family reading '2 consent unanswered' about their own child on a screen with no
    control to answer it has been told off by a database."

    That condition is the whole rule, and it is met here rather than reversed. This section
    names the actual questions in the family's own words and links to the control that answers
    them. The staff shorthand — a count of gaps against an enrolment checklist — stays where it
    was and stays away from parents, because it is a note about the centre's paperwork rather
    than a question for the family.
  */
  const parent = ctx.role === 'parent';

  /*
    A parent gets none of this. Their overview is their own child's record, reached from
    Tamariki — a centre-wide ratio and a hazard count are not theirs to read, and the policies
    would refuse most of it anyway. Rendering an empty dashboard for them would be a screen
    that says "there is something here you cannot see".
  */
  const [children, states, adultsPresent, incidents, staffRecords, hazards, drills, myChildren, consentsByChild] =
    await Promise.all([
      daily ? listChildren(db, ctx.centre.id) : Promise.resolve([]),
      daily ? listAttendanceToday(db, ctx.centre.id) : Promise.resolve([]),
      daily ? readAdultsPresent(db, ctx.centre.id) : Promise.resolve(0),
      // The same fourteen days the register defaults to, so "2 drafts" here and "2 drafts"
      // there cannot disagree.
      daily
        ? (async () => {
            const start = shiftLocalDate(today, -13);
            const { fromUtc } = dayWindow(start, ctx.centre.timezone);
            const { toUtc } = dayWindow(today, ctx.centre.timezone);
            return listIncidents(db, ctx.centre.id, fromUtc, toUtc);
          })()
        : Promise.resolve([]),
      office ? listStaffRecords(db, ctx.centre.id) : Promise.resolve([]),
      daily ? listHazards(db, ctx.centre.id) : Promise.resolve([]),
      daily ? listDrills(db, ctx.centre.id) : Promise.resolve([]),
      /*
        Both calls are the same ones staff make, with no guardianship filter added here —
        `children_select` already narrows to `caller_ward_ids()` for a parent, and
        `current_consents` is `security_invoker` so it inherits that. Adding a `.eq()` would
        be a second boundary that can disagree with the first. See the header of
        `packages/api/src/children.ts`.
      */
      parent ? listChildren(db, ctx.centre.id) : Promise.resolve([]),
      parent ? listConsentsByChild(db, ctx.centre.id) : Promise.resolve(new Map()),
    ]);

  const present = children.filter((c) => states.find((s) => s.childId === c.id)?.kind === 'in');
  const { underTwo, twoAndOver } = splitByAgeBand(present, ctx.centre.timezone);
  const ratio = assessRatio({ underTwo, twoAndOver, adultsPresent });

  const incidentSummary = summariseIncidents(incidents);
  const hazardSummary = summariseHazards(hazards);
  const compliance = summarise(assessAll(staffRecords, today));
  /*
    `overdue === true`, not a truthiness check, and `facilities.ts` asks callers for exactly
    this. It is `boolean | null`, and `null` means the centre has stated no drill interval —
    which is a third state, not a late drill. A centre that has declined to state an interval
    would otherwise appear on this screen as permanently overdue against a rule it never set,
    which is the same mistake `sleepCheckMinutes` refuses to make by defaulting to nothing.
  */
  const drillsOverdue = drillStatuses(
    drills,
    new Date().toISOString(),
    ctx.centre.drillIntervalDays,
  ).filter((d) => d.overdue === true).length;

  /*
    One list, assembled rather than hand-written, so "nothing outstanding" is a real test of
    every item above and not a fourth branch somebody has to remember to update.
  */
  const outstanding: { href: string; tone: 'warn' | 'breach'; label: string }[] = [];
  if (daily && incidentSummary.awaitingNotification > 0) {
    outstanding.push({
      href: '/incidents',
      tone: 'breach',
      label: `${incidentSummary.awaitingNotification} whānau not told about an incident`,
    });
  }
  if (daily && incidentSummary.drafts > 0) {
    outstanding.push({
      href: '/incidents',
      tone: 'warn',
      label: `${incidentSummary.drafts} incident draft${incidentSummary.drafts === 1 ? '' : 's'}`,
    });
  }
  if (office && compliance.expired > 0) {
    outstanding.push({
      href: '/compliance',
      tone: 'breach',
      label: `${compliance.expired} staff record${compliance.expired === 1 ? '' : 's'} expired`,
    });
  }
  if (office && compliance.dueSoon > 0) {
    outstanding.push({
      href: '/compliance',
      tone: 'warn',
      label: `${compliance.dueSoon} expiring soon`,
    });
  }
  if (daily && hazardSummary.uncontrolled > 0) {
    outstanding.push({
      href: '/facilities',
      tone: 'breach',
      label: `${hazardSummary.uncontrolled} high-risk hazard${hazardSummary.uncontrolled === 1 ? '' : 's'} with nothing recorded`,
    });
  }
  if (daily && drillsOverdue > 0) {
    outstanding.push({
      href: '/facilities',
      tone: 'warn',
      label: `${drillsOverdue} drill${drillsOverdue === 1 ? '' : 's'} overdue`,
    });
  }

  /*
    One entry per child who still owes an answer, with the questions themselves.

    Computed on read from `missingConsents`, never materialised — the same argument the
    checklist engine makes for having no scheduler: nothing should put rows in the database
    for work nobody has done. It also means the prompt is honest without anybody at the
    centre having remembered to press a button, which is the difference between a product
    that asks and a product that could ask.
  */
  const consentAsks = parent
    ? myChildren
        .map((child) => ({
          child,
          kinds: missingConsents(consentsByChild.get(child.id) ?? []),
        }))
        .filter((row) => row.kinds.length > 0)
    : [];

  return (
    <>
      <PageHeader
        title={ctx.centre.name}
        subtitle={
          ctx.centre.moeServiceNumber
            ? `Ministry of Education service ${ctx.centre.moeServiceNumber}`
            : 'No Ministry service number recorded yet'
        }
      />

      {/*
        The ratio, first and full width, because it is the one thing on this screen somebody
        reads without stopping to read. The same component the attendance screen uses — not a
        smaller copy of it, which would be a second rendering of a compliance figure and would
        eventually disagree.

        Computed from the server's events alone. The attendance screen's version merges the
        browser's outbox on top; this one cannot see a queue and does not pretend to, which is
        why the roll is where somebody signs a child in and this is where they glance.
      */}
      {daily && (
        <section className="section" aria-labelledby="ratio-heading">
          <h2 id="ratio-heading" className="visually-hidden">
            Ratio right now
          </h2>
          <RatioBanner ratio={ratio} />
          <p className="sub" style={{ marginTop: '-0.75rem' }}>
            {present.length} of {children.length} signed in ·{' '}
            <Link href="/attendance">Open the roll</Link>
          </p>
        </section>
      )}

      {/*
        Above "Needs attention" and not inside it, because it is not the same kind of thing.
        That list is a set of one-line labels a member of staff scans; this is a question
        being put to somebody, and a question compressed to "4 consents outstanding" is one
        nobody can answer without opening something else first.
      */}
      {consentAsks.length > 0 && (
        <section className="section" aria-labelledby="consent-ask-heading">
          <h2 id="consent-ask-heading">Some decisions are needed from you</h2>
          <div className="card">
            {consentAsks.map(({ child, kinds }) => (
              <div key={child.id} style={{ marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 0.5rem' }}>
                  <strong>{displayName(child)}</strong>
                </p>
                <ul className="stack">
                  {kinds.map((kind) => (
                    <li key={kind}>
                      {CONSENT_DETAIL[kind].label}
                      <div className="sub" style={{ fontSize: '0.8125rem' }}>
                        {CONSENT_DETAIL[kind].detail}
                      </div>
                    </li>
                  ))}
                </ul>
                <p style={{ margin: '0.5rem 0 0' }}>
                  <Link href={`/children/${child.id}/documents`}>
                    Answer these for {displayName(child)}
                  </Link>
                </p>
              </div>
            ))}
            {/*
              Said once, at the bottom, and it is the sentence that makes the rest safe to
              show: a family that believes an answer is final will delay giving one.
            */}
            <p className="sub" style={{ margin: 0 }}>
              You can change any of these at any time, and a photo is never used in a way you
              have not agreed to.
            </p>
          </div>
        </section>
      )}

      {/*
        Withheld from a parent who has something to answer, because for them the section above
        IS this one. Every item `outstanding` can hold is gated on `daily` or `office`, so for
        a parent it is always empty and always renders "Nothing outstanding" — which, printed
        directly under a list of decisions the centre needs from them, is the screen
        contradicting itself. When they have nothing pending it stays, because then it is true
        and worth saying.
      */}
      {(!parent || consentAsks.length === 0) && (
      <section className="section" aria-labelledby="outstanding-heading">
        <h2 id="outstanding-heading">Needs attention</h2>
        <div className="card">
          {outstanding.length === 0 ? (
            /*
              One line, not a list of zeroes. "0 drafts, 0 expired, 0 hazards" is a screen that
              takes as long to read when everything is fine as when it is not, which is how
              somebody stops reading it.
            */
            <p style={{ margin: 0 }}>
              <Status tone="ok">Nothing outstanding</Status>{' '}
              <span className="sub">
                {daily
                  ? 'No drafts, nothing expired, no uncontrolled hazards.'
                  : 'Nothing on your screens needs attention.'}
              </span>
            </p>
          ) : (
            <ul className="stack">
              {outstanding.map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  {/*
                    Each one links to the screen that fixes it. A dashboard that names a problem
                    and does not say where to go is a dashboard somebody reads once.
                  */}
                  <Link className="plain" href={item.href}>
                    <Status tone={item.tone}>{item.label}</Status>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      )}

      {/*
        Where things live — the rail's six groups as cards, below the working part of the
        screen and above the standing note.

        Staff only, and that is the whole role condition. A parent has four links in the
        rail and no navigation problem to solve; the section that matters to them is the
        consent one above, and adding an inventory of the two screens they already have
        would be this page repeating the mistake its own header records — answering a
        question nobody arrived with. `Launcher` returns null for a role with no groups
        anyway, so this guard is about not asking rather than about not rendering.

        See `launcher.ts` for why it is here rather than at the top, and why it borrows
        the rail's groups instead of arranging the same screens a second way.
      */}
      {daily && (
        <section className="section" aria-labelledby="launcher-heading">
          <h2 id="launcher-heading">Where things live</h2>
          <Launcher role={ctx.role} />
        </section>
      )}

      {/*
        Kept, and moved below the working part of the screen.

        It is true and it is worth somebody reading once; it is not what anybody signs in to
        find out, and it sat above the fold for months while the screen said nothing about
        today. The list of what is held is AGENTS.md §1's own wording rather than a paraphrase —
        that sentence drifts if it is reworded twice.
      */}
      <section className="section" aria-labelledby="records-heading">
        <h2 id="records-heading">What this centre&rsquo;s records hold</h2>
        <div className="card">
          <p className="sub" style={{ margin: 0 }}>
            Children&rsquo;s names, dates of birth, allergies, medication doses, custody
            arrangements and attendance records. Under-5 records are among the most sensitive
            personal information in the country and a breach is notifiable &mdash; which is why
            who can read what is decided in the database on every request, and not by what a
            screen happens to show.
          </p>
        </div>
      </section>
    </>
  );
}
