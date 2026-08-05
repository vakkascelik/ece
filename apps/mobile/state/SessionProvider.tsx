import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { listMyCentres, loadSession } from '@ece/api';
import { activeRole, describeSignOut, type Centre, type MemberRole, type Session } from '@ece/core';
import { supabase } from '../lib/supabase';
import { flush, pending, pendingAttendance } from '../lib/outbox';
import { unregisterPush } from '../lib/push';
import { readActiveCentre, writeActiveCentre } from './activeCentreStore';

/**
 * Who is signed in, which centre they are looking at, and whether the last write reached the
 * server. One provider, mounted once, above the navigator.
 *
 * WHY THIS EXISTS RATHER THAN STATE IN A SCREEN
 *
 * Three of the subscriptions below must survive navigation, and in a single-screen app they
 * happened to. `onAuthStateChange` is what stops a shared staffroom tablet showing the previous
 * educator's roll; the `AppState` listener is what refreshes the roll when somebody comes back
 * to the app after twenty minutes in a nappy change. Put either in a screen that unmounts on a
 * tab change and it silently stops working — no error, just stale data on a compliance screen.
 *
 * FOUR DEFECTS FIXED HERE, ALL FROM THE SINGLE-COMPONENT VERSION
 *
 * 1. **The foreground listener never reloaded the roll.** It closed over `activeCentre` while
 *    that was still `null`, inside an effect whose deps were `[loadIdentity]` with
 *    `exhaustive-deps` disabled — so the effect never re-ran and the closure never updated.
 *    Returning to the app flushed the outbox and refreshed the pending badge, which looked like
 *    it was working, and never re-read the roll, which is the one thing it was for. Fixed with a
 *    ref, deliberately: a ref is the mechanism for "the latest value, read from a subscription
 *    that must not be torn down and rebuilt".
 * 2. **The chosen centre was not persisted.** See `activeCentreStore.ts`.
 * 3. **Two sources of truth for the active tenant.** `loadSession` already returns
 *    `Session.activeCentreId`, and the old code ignored it and synthesised its own. Here the
 *    provider owns it, and `role` is derived from the pair rather than from a spread.
 * 4. **A failed launch was unrecoverable.** `status` went to `'error'` and the only refresh path
 *    called `sync`, never `loadIdentity`, and nothing reset `status`. There is a `retry()` now.
 */

export type Status = 'loading' | 'ready' | 'error';

interface SessionValue {
  status: Status;
  message: string;
  session: Session | null;
  centres: Centre[];
  centre: Centre | undefined;
  activeCentre: string | null;
  role: MemberRole | null;
  isParent: boolean;
  online: boolean;
  /** Queued attendance, so the ratio can count children the server has not seen yet. */
  queued: Awaited<ReturnType<typeof pendingAttendance>>;

  chooseCentre: (centreId: string) => void;
  refreshQueue: () => Promise<void>;
  syncNow: () => Promise<void>;
  retry: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string } | null>;
  /** Returns a reason when it refuses, so the caller can show it and offer to flush. */
  signOut: (opts?: { force?: boolean }) => Promise<{ blocked: string } | null>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [activeCentre, setActiveCentre] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<Awaited<ReturnType<typeof pendingAttendance>>>([]);

  /**
   * The latest chosen centre, for the two subscriptions that are created once and must not be
   * rebuilt. See defect 1 above — this ref is the fix, not a convenience.
   */
  const activeCentreRef = useRef<string | null>(null);
  activeCentreRef.current = activeCentre;

  const userIdRef = useRef<string | null>(null);

  const refreshQueue = useCallback(async () => {
    // Scoped to this user: another educator's queued sign-ins are theirs, must not count into
    // this person's ratio, and must never be flushed under this person's token.
    setQueued(await pendingAttendance(userIdRef.current));
  }, []);

  /**
   * Read who this is and which centres they belong to.
   *
   * The centre rule is the web app's, deliberately identical: keep the current choice if it is
   * still backed by a live membership; otherwise auto-select **only** when there is exactly one;
   * otherwise ask. Guessing between two sites is how somebody reads the wrong room's ratio.
   */
  const loadIdentity = useCallback(async () => {
    // Two independent queries, one round trip of latency instead of two. On a cold start at 7.25am
    // this is the difference the roll is measured by.
    const [s, cs] = await Promise.all([loadSession(supabase), listMyCentres(supabase).catch(() => [])]);
    setSession(s);
    userIdRef.current = s?.userId ?? null;

    if (!s) {
      setCentres([]);
      setActiveCentre(null);
      await writeActiveCentre(null);
      return null;
    }

    setCentres(cs);

    const stored = await readActiveCentre();
    setActiveCentre((prev) => {
      // A stored or previous value is a preference; it survives only if a live membership backs
      // it. RLS would return nothing for a stale one anyway — this is so the screen makes sense.
      const candidate = prev ?? stored;
      const kept = candidate && cs.some((c) => c.id === candidate) ? candidate : null;
      if (kept) return kept;
      return cs.length === 1 ? cs[0]!.id : null;
    });

    return s;
  }, []);

  /** Drain the queue, then re-read. Failure is expected offline and is not an error. */
  const sync = useCallback(
    async (centreId: string | null) => {
      let deferred = 0;
      try {
        const report = await flush(supabase, userIdRef.current);
        deferred = report.deferred;
        setOnline(true);
      } catch {
        // flush() reports a transient failure as `deferred` and only throws on the unexpected.
        setOnline(false);
      }
      if (deferred > 0) setOnline(false);
      await refreshQueue();

      if (centreId) {
        // The roll itself is fetched by the screen that shows it; this only tells the tree
        // whether the network is answering, so a stale roll can say so.
        try {
          await listMyCentres(supabase);
          setOnline(true);
        } catch {
          setOnline(false);
        }
      }
    },
    [refreshQueue],
  );

  const bootstrap = useCallback(async () => {
    setStatus('loading');
    setMessage('');
    try {
      const s = await loadIdentity();
      setStatus('ready');
      if (s) await sync(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }, [loadIdentity, sync]);

  // Mount once: bootstrap, then subscribe to auth changes and to coming back to the foreground.
  useEffect(() => {
    void bootstrap();

    /*
     * A shared tablet must not keep showing the previous person's roll after they sign out.
     *
     * Two things here are not obvious. **Filter on the event**: supabase-js fires
     * `INITIAL_SESSION` on subscribe and `TOKEN_REFRESHED` roughly hourly, and re-reading the
     * identity on all of them means two queries an hour, forever, for nothing. **Defer the
     * body**: calling other supabase functions synchronously inside this callback can deadlock on
     * the auth lock, so it yields first.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT' && event !== 'USER_UPDATED') return;
      setTimeout(() => {
        void loadIdentity().catch(() => setOnline(false));
      }, 0);
    });

    /*
     * Reads the centre from a ref, not from this closure — that is the fix for the defect where
     * returning to the app never reloaded the roll.
     *
     * Guarded on a genuine transition: iOS fires `inactive → active` after the app switcher or any
     * system sheet, and without this every glance at the notification shade refetches.
     */
    let previous = AppState.currentState;
    const appState = AppState.addEventListener('change', (next) => {
      const returning = previous !== 'active' && next === 'active';
      previous = next;
      if (returning) void sync(activeCentreRef.current);
    });

    return () => {
      sub.subscription.unsubscribe();
      appState.remove();
    };
    // bootstrap/loadIdentity/sync are all stable useCallbacks over stable deps.
  }, [bootstrap, loadIdentity, sync]);

  const chooseCentre = useCallback((centreId: string) => {
    setActiveCentre(centreId);
    void writeActiveCentre(centreId);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string } | null> => {
      const { error } = await supabase.auth.signInWithPassword({
        // Normalised exactly as the web app does, so an address typed with a capital on a phone
        // keyboard reaches the same account.
        email: email.trim().toLowerCase(),
        password,
      });

      /*
       * ONE MESSAGE FOR EVERY FAILURE.
       *
       * Not politeness. Distinguishing "no such account" from "wrong password" turns this form
       * into a way to find out who works at a named childcare centre, one address at a time.
       * The web app makes the same choice for the same reason — do not "improve" this by
       * surfacing Supabase's message.
       */
      if (error) return { error: 'Those details are not right.' };

      await loadIdentity();
      return null;
    },
    [loadIdentity],
  );

  const signOut = useCallback(
    async (opts?: { force?: boolean }): Promise<{ blocked: string } | null> => {
      /*
       * Signing out clears the outbox, which on a shared tablet is correct and means sign-out
       * can destroy the only record that a child is in the building. So an unsent queue blocks
       * it, and the message names the number. See `describeSignOut` in @ece/core.
       */
      /*
       * A final flush first, while this token is still valid. The tablet is usually on centre wifi
       * when somebody taps sign out, so this answers the queue question before it is a question.
       */
      await flush(supabase, userIdRef.current).catch(() => {});

      const mine = await pending(userIdRef.current);
      const verdict = describeSignOut({
        unsent: mine.filter((e) => !e.deadAt).length,
        dead: mine.filter((e) => e.deadAt).length,
      });

      if (!verdict.allowed && !opts?.force) return { blocked: verdict.message };

      /*
       * THE QUEUE IS NOT CLEARED, AND THAT IS A CORRECTION.
       *
       * The first version of this called `clearAll()` here, following the docstring on that
       * function, which claims sign-out is its caller. Both were wrong, and the reason is
       * `recordAttendance`: it stamps `recorded_by` from `auth.uid()` at **flush time**. So the
       * options were to discard queued sign-ins — destroying the only record that children were in
       * the building — or to leave them for the next person's token to send, filing one educator's
       * observations under another's name in a table with no UPDATE grant for anybody.
       *
       * Neither. Queue rows are tagged with the user who made them (see `outbox.ts`), so they wait
       * for that person and nobody else. They survive sign-out, they do not count into the next
       * user's ratio, and they cannot jam the next user's flush. `clearAll()` keeps its place as a
       * deliberate, confirmed wipe for a device being handed on — not a side effect of leaving.
       *
       * Order still matters: the push token goes before the session, because the delete is gated on
       * `user_id = auth.uid()` and afterwards there is no `auth.uid()` to match.
       */
      await unregisterPush(supabase).catch(() => {});
      // `scope: 'local'`. The default is global, which revokes refresh tokens on every device the
      // person owns — so signing out of the staffroom tablet would sign them out of their own
      // phone. Remote revocation is a containment action for the breach runbook, not a side effect
      // of a tap on the device you are still holding.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      await writeActiveCentre(null);

      // Everything, not just the centres — the old code left the previous user's children,
      // health, feed and queue in memory, and the queue still counted into the ratio.
      setSession(null);
      setCentres([]);
      setActiveCentre(null);
      setQueued([]);
      setOnline(true);
      setStatus('ready');
      setMessage('');
      return null;
    },
    [],
  );

  const centre = useMemo(() => centres.find((c) => c.id === activeCentre), [centres, activeCentre]);
  const role = useMemo(
    () => (session && activeCentre ? activeRole({ ...session, activeCentreId: activeCentre }) : null),
    [session, activeCentre],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      message,
      session,
      centres,
      centre,
      activeCentre,
      role,
      isParent: role === 'parent',
      online,
      queued,
      chooseCentre,
      refreshQueue,
      syncNow: () => sync(activeCentreRef.current),
      retry: bootstrap,
      signIn,
      signOut,
    }),
    [
      status,
      message,
      session,
      centres,
      centre,
      activeCentre,
      role,
      online,
      queued,
      chooseCentre,
      refreshQueue,
      sync,
      bootstrap,
      signIn,
      signOut,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
