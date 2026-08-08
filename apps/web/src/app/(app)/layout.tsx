import type { ReactNode } from 'react';
import Link from 'next/link';
import { can } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { signOut } from '../login/actions';
import { NavLink } from './NavLink';
import { SideRail } from './SideRail';
import { SignOutControl } from './SignOutControl';

/**
 * The signed-in shell. Every page under (app) is authenticated and scoped to one
 * centre, because requireCtx() runs here.
 *
 * Navigation is filtered by capability so an educator never sees a link to a
 * screen that would refuse them. That is presentation only — the write policies
 * in Postgres are what actually stop them.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();

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
        <nav>
          <NavLink href="/">Overview</NavLink>
          {/*
            Shown to parents too, where it lists their own child and nothing else —
            the policy on `children` keys on guardianship, so the same link is a
            roll for staff and a single record for a parent.
          */}
          <NavLink href="/children">{ctx.role === 'parent' ? 'Your tamariki' : 'Children'}</NavLink>
          <NavLink href="/posts">{ctx.role === 'parent' ? 'Pānui' : 'Posts'}</NavLink>
          <NavLink href="/messages">Messages</NavLink>
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/attendance">Attendance</NavLink>}
          {/* Beside Attendance because it is the same shift and the same tablet — not under
              Compliance, which is where the binder is assembled rather than where the day is
              recorded. `recordDailyPractice` includes educators, who are the people who file
              these; a parent reads their own child's through the child record. */}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/incidents">Incidents</NavLink>}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/sleep">Sleep checks</NavLink>}
          {/* The building rather than the children. Educators included: the person who
              spots a loose paving stone is the person walking on it. */}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/facilities">Site safety</NavLink>}
          {/* Its own link, not a section of Site safety: used dozens of times a day at
              the door, and burying the frequent thing under the weekly one is how it
              stays a spiral notebook. */}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/visitors">Visitors</NavLink>}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/excursions">Excursions</NavLink>}
          {/* Beside People because both are about who works here, and distinct from it:
              People is who has a LOGIN, Staff is who works here — a reliever is on one
              list and not the other, which is the whole point of 0038. */}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/staff">Staff</NavLink>}
          {/* Directly under Staff, because it is the same list read forwards. Every other
              screen here answers what happened or what is happening; this one answers the
              only version of the question somebody can still act on. */}
          {can(ctx.role, 'recordDailyPractice') && <NavLink href="/roster">Roster</NavLink>}
          {can(ctx.role, 'manageMembers') && <NavLink href="/members">People</NavLink>}
          {/* Next to People because both are about who works here — but a separate capability, for
              the reason recorded on `manageRecruitment` in @ece/core. */}
          {can(ctx.role, 'manageRecruitment') && (
            <NavLink href="/applications">Applications</NavLink>
          )}
          {can(ctx.role, 'manageCentre') && <NavLink href="/compliance">Compliance</NavLink>}
          {can(ctx.role, 'manageCentre') && <NavLink href="/funding">Funding</NavLink>}
          {can(ctx.role, 'manageCentre') && <NavLink href="/settings">Settings</NavLink>}
          {/* Everyone: this is the user's own account, not the centre's. */}
          <NavLink href="/account">Account</NavLink>
        </nav>

        {/* Pinned to the bottom of the rail — see `.side-foot` in globals.css. */}
        <div className="side-foot">
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
