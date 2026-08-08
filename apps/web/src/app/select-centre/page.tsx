import { redirect } from 'next/navigation';
import { listMyCentres, loadSession } from '@ece/api';
import { isKiosk } from '@ece/core';
import { serverDb } from '@/lib/supabase';
import { chooseCentre } from './actions';

/**
 * Shown when a user belongs to more than one centre — a manager of a two-site
 * operator, or a parent with children at two services.
 *
 * Deliberately a screen rather than an automatic pick. Guessing is how somebody
 * posts a notice to the wrong centre, and that is not recoverable by editing it.
 */
export default async function SelectCentrePage() {
  const db = await serverDb();
  const session = await loadSession(db);
  if (!session) redirect('/login');

  // A kiosk used to land here and be told it had access to more than one centre,
  // above a list of exactly one. This page is for people choosing between sites.
  if (isKiosk(session)) redirect('/kiosk');

  const centres = await listMyCentres(db);
  if (centres.length === 0) redirect('/no-access');

  return (
    <main className="center">
      <h1>Which centre?</h1>
      <p className="sub">You have access to more than one.</p>

      {centres.map((c) => (
        <form action={chooseCentre} key={c.id} className="card" style={{ marginBottom: '0.75rem' }}>
          <input type="hidden" name="centreId" value={c.id} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <div>
              <strong>{c.name}</strong>
              {c.moeServiceNumber && <div className="pill" style={{ marginTop: '0.35rem' }}>MoE {c.moeServiceNumber}</div>}
            </div>
            <button type="submit">Open</button>
          </div>
        </form>
      ))}
    </main>
  );
}
