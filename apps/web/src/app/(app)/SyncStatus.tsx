'use client';

import { useCallback, useEffect, useState } from 'react';
import { OUTBOX_EVENT, snapshot } from '@/lib/outboxStore';

/**
 * Is anything I typed still only on this device?
 *
 * The single most trust-bearing screen in 1Place is its Connection Status dialog —
 * *Device Network Status · Server Connection · Last Synced · SYNC NOW* — and this
 * product had the whole outbox underneath and showed the user nothing outside the
 * attendance roll. Somebody signing children in on a tablet needs to know whether what
 * they just typed exists anywhere but in front of them, and they need to know it on
 * every screen, not the one where the queue happens to be rendered.
 *
 * THREE FACTS, NOT ONE, BECAUSE THEY FAIL SEPARATELY
 *
 * The device having wifi, the server answering, and the queue being empty are three
 * different states with three different responses — reconnect, wait, or press the
 * button. Collapsing them into one green dot is how a person concludes "it is broken"
 * and starts writing on paper, and the paper never gets typed up.
 *
 * WHY IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY
 *
 * Online, reachable, queue empty is the overwhelmingly common case, and a permanent
 * "all good" badge is furniture people stop seeing — at which point it cannot warn
 * anybody. It appears when there is something true to report and is silent otherwise.
 *
 * `navigator.onLine` is deliberately only ONE of the three inputs. It answers "is
 * there a network interface", not "can I reach the server": a captive portal at a
 * conference, or the centre's wifi with the fibre down, both report online. The health
 * probe is what actually answers the question, and the two disagreeing is itself
 * worth showing.
 */
export function SyncStatus({
  userId,
  healthHref,
}: {
  userId: string;
  /**
   * MUST ALREADY CARRY THE MOUNT. Pass `appPath('/api/health')`, never a bare path.
   *
   * The same trap `PageActions` documents: this is a client component, `ECE_PORTAL_MOUNT`
   * is server-only on purpose, and a probe pointed at `/api/health` under a mounted app
   * hits the marketing site's 404 — which this component would then report as "server not
   * answering" on every screen, permanently, while the server was fine.
   */
  healthHref: string;
}) {
  const [queue, setQueue] = useState({ unsent: 0, dead: 0 });
  const [online, setOnline] = useState(true);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const refreshQueue = useCallback(() => setQueue(snapshot(userId)), [userId]);

  const probe = useCallback(async () => {
    try {
      // `cache: 'no-store'` matters more than it looks: a cached 200 from ten minutes
      // ago would report the server as reachable while the tablet is on a dead link,
      // which is the exact lie this component exists to prevent.
      const res = await fetch(healthHref, { cache: 'no-store' });
      /*
       * DRAIN THE BODY, EVEN THOUGH ONLY `res.ok` IS WANTED.
       *
       * This one line is why the entire end-to-end and accessibility suite timed out
       * for six days. `await fetch(...)` resolves as soon as the headers arrive; the
       * response body is a stream, and a stream nobody reads leaves the request **in
       * flight** in Chromium's accounting. This component is in `(app)/layout.tsx`, so
       * that happened on every authenticated page — and Playwright's `networkidle`
       * waits for the in-flight count to reach zero, which it therefore never did.
       * 32 accessibility tests and 10 role-boundary tests failed at 60s each, on
       * screens that were rendering perfectly.
       *
       * Measured rather than reasoned: with the body unread, 29 of 30 requests settled
       * and `/api/health` stayed outstanding past 25 seconds. With this line, 30 of 30
       * settle and `networkidle` is reached.
       *
       * It is a real defect and not only a test artefact — a leaked response per page
       * load, repeating every two minutes, on a tablet that stays open all day. The
       * `.catch()` is deliberate: a body that cannot be read is not a reason to report
       * the server unreachable when the headers already said 200.
       */
      await res.text().catch(() => {});
      setReachable(res.ok);
    } catch {
      setReachable(false);
    }
    setCheckedAt(new Date().toISOString());
  }, [healthHref]);

  useEffect(() => {
    refreshQueue();
    setOnline(navigator.onLine);
    void probe();

    const onQueue = () => refreshQueue();
    const onOnline = () => {
      setOnline(true);
      void probe();
    };
    const onOffline = () => {
      setOnline(false);
      setReachable(false);
    };

    window.addEventListener(OUTBOX_EVENT, onQueue);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Every two minutes. Often enough that a person who walks back into range sees it
    // change without pressing anything, rare enough that it is not a heartbeat on a
    // metered connection. The `online` event does the fast path.
    const timer = window.setInterval(() => void probe(), 120_000);

    return () => {
      window.removeEventListener(OUTBOX_EVENT, onQueue);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [probe, refreshQueue]);

  async function sendNow() {
    setBusy(true);
    try {
      /*
        Imported here rather than at the top of the file, and this is why `outboxStore`
        was split out.

        This component sits in `(app)/layout.tsx`. A static import of `flush` — which
        reaches `@ece/api` and through it `@supabase/supabase-js` — is the kind of
        dependency that has no business being resolved before the login page paints.
        Measurement showed Next was already splitting it out either way, so this buys no
        kilobytes today; it makes the property hold on purpose rather than by the
        bundler's current preference. Watching the queue is free, sending it is not, and
        nobody pays for the second until they press the button.
      */
      const [{ flush }, { browserDb }] = await Promise.all([
        import('@/lib/outbox'),
        import('@/lib/supabaseBrowser'),
      ]);
      await flush(browserDb(), userId);
    } catch {
      // `flush` already records per-entry failures on the entries themselves and the
      // queue count below reflects them. Swallowing here is deliberate: a thrown
      // error from the button would replace a screen that is otherwise working.
    } finally {
      await probe();
      refreshQueue();
      setBusy(false);
    }
  }

  const trouble = !online || reachable === false;
  const waiting = queue.unsent > 0 || queue.dead > 0;
  if (!trouble && !waiting) return null;

  const label = queue.dead > 0
    ? `${queue.dead} stuck`
    : queue.unsent > 0
      ? `${queue.unsent} not sent yet`
      : 'Offline';

  return (
    <div className="no-print" style={{ marginBottom: '0.75rem' }}>
      <button
        type="button"
        className={`flag ${queue.dead > 0 ? 'flag-critical' : trouble ? 'flag-warn' : 'flag-quiet'}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ cursor: 'pointer', border: 0, font: 'inherit' }}
      >
        {label}
      </button>

      {open && (
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <dl style={{ margin: 0 }}>
            <dt>This device</dt>
            <dd>{online ? 'Connected' : 'No network'}</dd>

            <dt>This centre&rsquo;s server</dt>
            <dd>
              {reachable === null
                ? 'Checking…'
                : reachable
                  ? 'Answering'
                  : 'Not answering'}
              {checkedAt && (
                <span className="sub"> · checked {new Date(checkedAt).toLocaleTimeString('en-NZ')}</span>
              )}
            </dd>

            <dt>Waiting to send</dt>
            <dd>
              {queue.unsent === 0 && queue.dead === 0
                ? 'Nothing — everything you have entered is saved'
                : `${queue.unsent} waiting${queue.dead > 0 ? `, ${queue.dead} stuck` : ''}`}
            </dd>
          </dl>

          {queue.dead > 0 && (
            /*
              "Stuck" is not "lost", and the wording has to keep them apart. A dead
              entry has been refused repeatedly — a clock two hours ahead is the usual
              cause and it heals itself as real time catches up. Telling somebody their
              sign-in failed when it will go through in an hour makes them enter it
              twice.
            */
            <p className="sub" style={{ marginTop: '0.5rem' }}>
              Some entries have been refused several times. They are still here and are
              retried; nothing has been lost. If they stay stuck, check this device&rsquo;s
              clock — a tablet running fast is the usual cause.
            </p>
          )}

          <p style={{ margin: '0.75rem 0 0' }}>
            <button type="button" className="small" onClick={() => void sendNow()} disabled={busy}>
              {busy ? 'Sending…' : 'Try now'}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
