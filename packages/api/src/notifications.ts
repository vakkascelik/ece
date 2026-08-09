/**
 * Emergency broadcasts, and a family's own notification queue.
 *
 * `notifications` already existed (0017) with no writer and nothing in either app that read
 * it. This adds the first of each: `broadcastEmergency` writes, through the SECURITY DEFINER
 * function that does the fan-out and the authorisation check in one place — see 0057 for why
 * this is not a plain INSERT policy. `listMyNotifications` reads, through the `notifications_own`
 * policy that has been sitting unused since 0017.
 */

import { fetchAll } from './paging';
import type { Db } from './index';

export interface MyNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  created_at: string;
}

/**
 * The signed-in caller's own notifications, newest first.
 *
 * No centre filter and none needed: `notifications_own` already restricts this to
 * `user_id = auth.uid()`, and a person can belong to more than one centre — seeing an
 * emergency broadcast from either one is the point, not a leak.
 */
export async function listMyNotifications(db: Db): Promise<MyNotification[]> {
  const rows = await fetchAll<NotificationRow>('listMyNotifications', (a, b) =>
    db
      .from('notifications')
      .select('id, kind, title, body, route, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(a, b),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    route: r.route,
    createdAt: r.created_at,
  }));
}

/**
 * Send an emergency broadcast to every active member of a centre.
 *
 * Returns how many `notifications` rows it created — the same count `broadcast_emergency`
 * also writes into `emergency_broadcasts`, so the caller can say "sent to 14 people" without
 * a second query.
 */
export async function broadcastEmergency(
  db: Db,
  input: { centreId: string; title: string; body: string },
): Promise<number> {
  const { data, error } = await db.rpc('broadcast_emergency', {
    p_centre_id: input.centreId,
    p_title: input.title,
    p_body: input.body,
  });
  if (error) throw new Error(`broadcastEmergency: ${error.message}`);
  return data as number;
}

export interface EmergencyBroadcastRecord {
  id: string;
  title: string;
  body: string;
  recipientCount: number;
  sentBy: string;
  createdAt: string;
}

interface EmergencyBroadcastRow {
  id: string;
  title: string;
  body: string;
  recipient_count: number;
  sent_by: string;
  created_at: string;
}

/** What has been sent from this centre, newest first — the staff-visible history. */
export async function listEmergencyBroadcasts(
  db: Db,
  centreId: string,
): Promise<EmergencyBroadcastRecord[]> {
  const rows = await fetchAll<EmergencyBroadcastRow>('listEmergencyBroadcasts', (a, b) =>
    db
      .from('emergency_broadcasts')
      .select('id, title, body, recipient_count, sent_by, created_at')
      .eq('centre_id', centreId)
      .order('created_at', { ascending: false })
      .range(a, b),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    recipientCount: r.recipient_count,
    sentBy: r.sent_by,
    createdAt: r.created_at,
  }));
}
