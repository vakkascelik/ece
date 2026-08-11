import type { ReactNode } from 'react';
import Link from 'next/link';
import { can } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { signOut } from '../login/actions';
import { NavGroup } from './NavGroup';
import { NavGroupMemory } from './NavGroupMemory';
import { NavIcon } from './NavIcon';
import { NavLink } from './NavLink';
import { SideRail } from './SideRail';
import { SignOutControl } from './SignOutControl';
import { groupKey } from './navGroups';
import { closedGroups } from './navGroups.server';

/**
 * The signed-in shell. Every page under (app) is authenticated and scoped to one
 * centre, because requireCtx() runs here.
 *
 * Navigation is filtered by capability so an educator never sees a link to a
 * screen that would refuse them. That is presentation only — the write policies
 * in Postgres are what actually stop them.
 *
 * Grouping changes nothing about that. A NavGroup is a heading over links the same
 * `can()` calls already decided, and a group whose links all filter out disappears
 * with them — so the headings a role sees are a consequence of the filter, never an
 * input to it. Nothing here is a boundary; `requireCapability` on each route and the
 * policies underneath it are.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  // Which groups this person has collapsed. Rendered into the `open` attribute on the
  // server, so the rail arrives in the state they left it in rather than flashing open.
  const closed = await closedGroups();

  return (
    <div className="shell">
      {/* WCAG 2.4.1 — the sidebar repeats on every page and is otherwise ten tab
          stops between a keyboard user and the content. */}
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SideRail
        head={
          <>
            {/* Hidden by CSS on a phone: the centre's name does not need a label
                telling the reader it is a centre. */}
            <h2>Centre</h2>
            <strong>{ctx.centre.name}</strong>
            <span className="pill">{ctx.role}</span>
          </>
        }
      >
        {/*
          One <nav>, six headings. The groups are labels over the order that was already
          here — every `can()` condition, href and label below is unchanged, and so is the
          sequence within each group. See NavGroup for why a group that filters down to
          nothing renders nothing at all.
        */}
        <nav>
          <NavGroup label="Today" open={!closed.has(groupKey('Today'))}>
            <NavLink href="/" icon={<NavIcon name="overview" />}>Overview</NavLink>
            {can(ctx.role, 'recordDailyPractice') && (
              <NavLink href="/attendance" icon={<NavIcon name="attendance" />}>Attendance</NavLink>
            )}
            {can(ctx.role, 'recordDailyPractice') && <NavLink href="/sleep" icon={<NavIcon name="sleep" />}>Sleep checks</NavLink>}
            {/* Its own link, not a section of Site safety: used dozens of times a day at
                the door, and burying the frequent thing under the weekly one is how it
                stays a spiral notebook. Grouped under Today rather than beside Site safety
                for the same reason — this is a thing that happens at the door this morning. */}
            {can(ctx.role, 'recordDailyPractice') && <NavLink href="/visitors" icon={<NavIcon name="visitors" />}>Visitors</NavLink>}
          </NavGroup>

          <NavGroup label="Tamariki" open={!closed.has(groupKey('Tamariki'))}>
            {/*
              Shown to parents too, where it lists their own child and nothing else —
              the policy on `children` keys on guardianship, so the same link is a
              roll for staff and a single record for a parent.
            */}
            <NavLink href="/children" icon={<NavIcon name="children" />}>
              {ctx.role === 'parent' ? 'Your tamariki' : 'Children'}
            </NavLink>
            <NavLink href="/posts" icon={<NavIcon name="posts" />}>{ctx.role === 'parent' ? 'Pānui' : 'Posts'}</NavLink>
            <NavLink href="/messages" icon={<NavIcon name="messages" />}>Messages</NavLink>
          </NavGroup>

          <NavGroup label="Records" open={!closed.has(groupKey('Records'))}>
            {/* Beside Attendance because it is the same shift and the same tablet — not under
                Compliance, which is where the binder is assembled rather than where the day is
                recorded. `recordDailyPractice` includes educators, who are the people who file
                these; a parent reads their own child's through the child record.

                The grouping split that adjacency: Attendance is under Today and this is under
                Records. Half the argument survives intact — Compliance is under Centre, so this
                is still nowhere near the binder — and the half that does not is worth naming.
                Attendance is a screen somebody watches; an incident is a document somebody
                files, and the three things filed on the same shift are now beside each other
                instead. If that proves wrong in use, the fix is to move Incidents into Today,
                not to dissolve the groups. */}
            {can(ctx.role, 'recordDailyPractice') && <NavLink href="/incidents" icon={<NavIcon name="incidents" />}>Incidents</NavLink>}
            {/* The building rather than the children. Educators included: the person who
                spots a loose paving stone is the person walking on it. */}
            {can(ctx.role, 'recordDailyPractice') && (
              <NavLink href="/facilities" icon={<NavIcon name="facilities" />}>Site safety</NavLink>
            )}
            {can(ctx.role, 'recordDailyPractice') && (
              <NavLink href="/excursions" icon={<NavIcon name="excursions" />}>Excursions</NavLink>
            )}
          </NavGroup>

          <NavGroup label="People" open={!closed.has(groupKey('People'))}>
            {/* Beside People because both are about who works here, and distinct from it:
                People is who has a LOGIN, Staff is who works here — a reliever is on one
                list and not the other, which is the whole point of 0038. */}
            {can(ctx.role, 'recordDailyPractice') && <NavLink href="/staff" icon={<NavIcon name="staff" />}>Staff</NavLink>}
            {/* Directly under Staff, because it is the same list read forwards. Every other
                screen here answers what happened or what is happening; this one answers the
                only version of the question somebody can still act on. */}
            {can(ctx.role, 'recordDailyPractice') && <NavLink href="/roster" icon={<NavIcon name="roster" />}>Roster</NavLink>}
            {can(ctx.role, 'manageMembers') && <NavLink href="/members" icon={<NavIcon name="people" />}>People</NavLink>}
            {/* Beside Applications because both are queues of strangers asking for something,
                and neither is a record of anybody at the centre yet. */}
            {can(ctx.role, 'manageCentre') && <NavLink href="/enquiries" icon={<NavIcon name="enquiries" />}>Enquiries</NavLink>}
            {/* Next to People because both are about who works here — but a separate capability, for
                the reason recorded on `manageRecruitment` in @ece/core. */}
            {can(ctx.role, 'manageRecruitment') && (
              <NavLink href="/applications" icon={<NavIcon name="applications" />}>Applications</NavLink>
            )}
          </NavGroup>

          <NavGroup label="Money" open={!closed.has(groupKey('Money'))}>
            {can(ctx.role, 'manageCentre') && <NavLink href="/funding" icon={<NavIcon name="funding" />}>Funding</NavLink>}
            {/* Beside Funding because both are money, and distinct from it: Funding is what
                the Crown owes this centre, Accounts is what families do. */}
            {can(ctx.role, 'manageCentre') && <NavLink href="/billing" icon={<NavIcon name="accounts" />}>Accounts</NavLink>}
            {/* After the money screens because it is derived from them and from attendance:
                a report is what you read once the day-to-day is recorded, not instead of it. */}
            {can(ctx.role, 'manageCentre') && <NavLink href="/reports" icon={<NavIcon name="reports" />}>Reports</NavLink>}
          </NavGroup>

          <NavGroup label="Centre" open={!closed.has(groupKey('Centre'))}>
            {can(ctx.role, 'manageCentre') && <NavLink href="/compliance" icon={<NavIcon name="compliance" />}>Compliance</NavLink>}
            {can(ctx.role, 'manageCentre') && <NavLink href="/settings" icon={<NavIcon name="settings" />}>Settings</NavLink>}
            {/* Its own link rather than a Settings tab — a distinct, consequential action
                (send once, reach everyone, no undo), and burying it costs the one moment
                somebody actually needs to find it fast. */}
            {can(ctx.role, 'broadcastEmergency') && (
              <NavLink href="/broadcast" icon={<NavIcon name="broadcast" />}>Emergency broadcast</NavLink>
            )}
          </NavGroup>
        </nav>
        <NavGroupMemory />

        {/* Pinned to the bottom of the rail — see `.side-foot` in globals.css. */}
        <div className="side-foot">
          {/*
            The three links about the person rather than about the centre, and the only
            three a parent and an owner are offered identically — so they sit with the
            other two controls that are about the session rather than the day's work.

            A second landmark rather than a bare list, and labelled: "navigation" and
            "navigation, Your account" are distinguishable when skimmed, and these really
            are navigation. Two is not six — the six groups above are headings inside the
            one rail nav, for the reason recorded in NavGroup.
          */}
          <nav aria-label="Your account">
            <ul>
              {/* Everyone: this is the user's own account, not the centre's. */}
              <li>
                <NavLink href="/account" icon={<NavIcon name="account" />}>Account</NavLink>
              </li>
              {/* Everyone's own inbox — 0057, and the first thing that ever reads this table. */}
              <li>
                <NavLink href="/notifications" icon={<NavIcon name="notifications" />}>Notifications</NavLink>
              </li>
              {/*
                Last, and shown to everyone including parents. It documents the screens the
                reader can actually open — `/help` filters by the same capabilities this nav
                does, so an educator is not told about the accounts screen they cannot reach.
              */}
              <li>
                <NavLink href="/help" icon={<NavIcon name="help" />}>Help</NavLink>
              </li>
            </ul>
          </nav>

          {ctx.centres.length > 1 && (
            <p style={{ fontSize: 'var(--text-sm)', marginBottom: '0.75rem' }}>
              <Link href="/select-centre">Switch centre</Link>
            </p>
          )}

          {/*
            Not a plain form any more. Sign-out clears the browser outbox, so it can destroy
            the only record that a child is in the building — the control has to ask first when
            there is unsent work. The server action is passed down and called only once the
            queue allows it. See SignOutControl.
          */}
          <SignOutControl signOut={signOut} userId={ctx.userId} />
        </div>
      </SideRail>

      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
