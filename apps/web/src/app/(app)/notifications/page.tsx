import { listMyNotifications } from '@ece/api';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

const KIND_LABELS: Record<string, string> = {
  post: 'Post',
  message: 'Message',
  attendance: 'Attendance',
  reminder: 'Reminder',
  emergency: 'Emergency',
};

/**
 * A person's own notifications — the first thing in this product that ever reads the
 * `notifications` table 0017 created. Every role gets this page, the same reasoning
 * `/account` uses: it is the caller's own inbox, scoped by `notifications_own`
 * (`user_id = auth.uid()`), not a centre-management screen.
 *
 * WHAT THIS IS NOT: a push notification, an email, or an unread count in the nav. Nothing
 * currently tells a family this page has something new on it — they have to think to open
 * it. That is a real gap, named rather than hidden, and it is why `/broadcast`'s own copy
 * does not oversell what "sent" means yet.
 */
export default async function NotificationsPage() {
  await requireCtx();
  const db = await serverDb();
  const notifications = await listMyNotifications(db);

  return (
    <>
      <h1>Notifications</h1>
      <p className="sub">Only you can see this list.</p>

      <div className="card">
        {notifications.length === 0 ? (
          <p className="empty" style={{ margin: 0 }}>
            Nothing yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {notifications.map((n) => (
              <li
                key={n.id}
                style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--line)' }}
              >
                <div className="inline">
                  {n.kind === 'emergency' && <span className="flag flag-critical">Emergency</span>}
                  <strong>{n.title}</strong>
                  <span className="sub" style={{ fontSize: '0.75rem' }}>
                    {KIND_LABELS[n.kind] ?? n.kind} · {new Date(n.createdAt).toLocaleString('en-NZ')}
                  </span>
                </div>
                <p style={{ margin: '0.25rem 0 0' }}>{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
