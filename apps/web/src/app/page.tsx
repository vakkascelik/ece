import { listMyCentres, loadSession } from '@ece/api';
import { activeRole, activeMemberships } from '@ece/core';
import { serverDb } from '@/lib/supabase';

/**
 * Landing page, and the first real proof the architecture works: it calls the
 * shared query layer, and the rows it gets back are restricted by Row Level
 * Security rather than by any filter written here.
 *
 * Signed out, `loadSession` returns null and no centre is visible. Signed in,
 * exactly the centres the user has a membership for appear — and if that set is
 * empty, the correct thing to show is nothing rather than an error, because a
 * user with no membership is a normal state during onboarding.
 */
export default async function Home() {
  const db = await serverDb();
  const session = await loadSession(db);
  const centres = session ? await listMyCentres(db) : [];

  return (
    <main style={{ maxWidth: '44rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: '0 0 0.5rem' }}>ECE Platform</h1>
      <p style={{ color: '#6b6b6b', margin: '0 0 2.5rem' }}>
        Multi-tenant administration for New Zealand early learning services.
      </p>

      {!session ? (
        <p>Not signed in.</p>
      ) : (
        <>
          <p style={{ margin: '0 0 1rem' }}>
            Signed in. {activeMemberships(session).length} membership(s)
            {session.activeCentreId ? `, active role: ${activeRole(session)}` : ', no centre selected'}.
          </p>
          {centres.length === 0 ? (
            <p style={{ color: '#6b6b6b' }}>
              No centres yet — an owner or manager needs to add you.
            </p>
          ) : (
            <ul style={{ paddingLeft: '1.25rem' }}>
              {centres.map((c) => (
                <li key={c.id} style={{ marginBottom: '0.5rem' }}>
                  {c.name}
                  {c.moeServiceNumber ? ` · MoE ${c.moeServiceNumber}` : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
