import type { ReactNode } from 'react';
import Link from 'next/link';
import { can } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { signOut } from '../login/actions';
import { NavLink } from './NavLink';
import { SideRail } from './SideRail';

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
          {can(ctx.role, 'manageMembers') && <NavLink href="/members">People</NavLink>}
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

          <form action={signOut}>
            <button className="secondary auth-secondary" type="submit">Sign out</button>
          </form>
        </div>
      </SideRail>

      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
