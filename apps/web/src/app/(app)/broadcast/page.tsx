import { listEmergencyBroadcasts, listMembers } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { BroadcastForm } from './BroadcastForm';

/**
 * Emergency broadcast: send, and what has been sent.
 *
 * Owner/manager only — `broadcastEmergency` in `@ece/core`, checked again in Postgres by
 * `broadcast_emergency` (0057) because a capability list only decides what this page draws.
 *
 * Deliberately not called "Notifications" or folded into Settings: this is a distinct,
 * consequential action — send once, reach everyone, no undo — and burying it under a
 * settings tab is how it gets pressed by accident by someone looking for something else.
 */
export default async function BroadcastPage() {
  const ctx = await requireCapability('broadcastEmergency');
  const db = await serverDb();

  const [members, history] = await Promise.all([
    listMembers(db, ctx.centre.id),
    listEmergencyBroadcasts(db, ctx.centre.id),
  ]);
  // A kiosk is a door tablet, not a person with an inbox — see 0057's fan-out, which
  // excludes it the same way.
  const recipientCount = members.filter((m) => m.role !== 'kiosk').length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Emergency broadcast</h1>
          <p className="sub">{ctx.centre.name}</p>
        </div>
      </div>

      <BroadcastForm recipientCount={recipientCount} />

      <div className="section">
        <h2>Sent from this centre</h2>
        <div className="card">
          {history.length === 0 ? (
            <p className="empty" style={{ margin: 0 }}>
              Nothing has been sent yet.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Reached</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.createdAt).toLocaleString('en-NZ')}</td>
                    <td>{h.title}</td>
                    <td>{h.body}</td>
                    <td>{h.recipientCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
