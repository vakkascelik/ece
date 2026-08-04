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
      <aside className="side">
        <h2>Centre</h2>
        <div style={{ marginBottom: '0.35rem' }}>
          <strong>{ctx.centre.name}</strong>
        </div>
        <div className="pill" style={{ marginBottom: '1.25rem', display: 'inline-block' }}>{ctx.role}</div>

        <nav>
          <Link href="/">Overview</Link>
          {can(ctx.role, 'manageMembers') && <Link href="/members">People</Link>}
          {can(ctx.role, 'manageCentre') && <Link href="/settings">Settings</Link>}
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

      <main className="main">{children}</main>
    </div>
  );
}
