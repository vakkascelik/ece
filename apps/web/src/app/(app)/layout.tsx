import type { ReactNode } from 'react';
import Link from 'next/link';
import { can } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { signOut } from '../login/actions';

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
      <aside className="side">
        <h2>Centre</h2>
        <div style={{ marginBottom: '0.35rem' }}>
          <strong>{ctx.centre.name}</strong>
        </div>
        <div className="pill" style={{ marginBottom: '1.25rem', display: 'inline-block' }}>{ctx.role}</div>

        <nav>
          <Link href="/">Overview</Link>
          {/*
            Shown to parents too, where it lists their own child and nothing else —
            the policy on `children` keys on guardianship, so the same link is a
            roll for staff and a single record for a parent.
          */}
          <Link href="/children">{ctx.role === 'parent' ? 'Your tamariki' : 'Children'}</Link>
          <Link href="/posts">{ctx.role === 'parent' ? 'Pānui' : 'Posts'}</Link>
          <Link href="/messages">Messages</Link>
          {can(ctx.role, 'recordDailyPractice') && <Link href="/attendance">Attendance</Link>}
          {can(ctx.role, 'manageMembers') && <Link href="/members">People</Link>}
          {can(ctx.role, 'manageCentre') && <Link href="/compliance">Compliance</Link>}
          {can(ctx.role, 'manageCentre') && <Link href="/funding">Funding</Link>}
          {can(ctx.role, 'manageCentre') && <Link href="/settings">Settings</Link>}
          {/* Everyone: this is the user's own account, not the centre's. */}
          <Link href="/account">Account</Link>
        </nav>

        {ctx.centres.length > 1 && (
          <p style={{ fontSize: '0.8125rem', marginBottom: '1rem' }}>
            <Link href="/select-centre">Switch centre</Link>
          </p>
        )}

        <form action={signOut}>
          <button className="secondary" type="submit" style={{ width: '100%' }}>Sign out</button>
        </form>
      </aside>

      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
