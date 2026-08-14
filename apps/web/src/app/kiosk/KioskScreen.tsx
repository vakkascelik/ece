'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import type { KioskChild, KioskGuardian, KioskWeekEvent } from '@ece/api';
import { shiftLocalDate } from '@ece/core';
import { loadGuardians, reviewWeek, signAtDoor, verifyAtDoor, type SignResult } from './actions';

/**
 * Three steps: which child, which adult, what PIN.
 *
 * Split that way because each answer narrows the next, and because a single form
 * asking all three at once would put a PIN field on screen before anybody has said who
 * they are — which is how a parent types their PIN against the wrong child's row.
 *
 * The PIN lives in component state for the length of one attempt and is never written
 * anywhere else. It is not in a URL, not in `localStorage`, not in a cookie, and there
 * is no offline queue that could hold it. That is the whole reason 0044 compares it
 * inside Postgres.
 *
 * The review flow (0062) holds it slightly longer, and that is a stated cost, not a
 * slip: the PIN unlocks the week (`review-pin`) and then signs the outcome over what was
 * shown (`review`) — entered once, used twice, still never persisted. Demanding it twice
 * would make disputes rarer than they should be, and signing without showing is the
 * rubber stamp §6-3 criterion 6 forbids.
 */

type Step =
  | { at: 'roll' }
  | { at: 'guardian'; child: KioskChild; guardians: KioskGuardian[] }
  | { at: 'pin'; child: KioskChild; guardian: KioskGuardian }
  | { at: 'review-pin'; child: KioskChild; guardian: KioskGuardian }
  | {
      at: 'review';
      child: KioskChild;
      guardian: KioskGuardian;
      pin: string;
      timezone: string;
      events: KioskWeekEvent[];
    };

/** The completed week the server computed in the centre's own calendar. */
export interface ReviewWeek {
  from: string;
  to: string;
}

export function KioskScreen({
  roll,
  centreId,
  week,
}: {
  roll: KioskChild[];
  centreId: string;
  week: ReviewWeek;
}) {
  const [step, setStep] = useState<Step>({ at: 'roll' });
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [online, setOnline] = useState(true);

  /*
    A tap here needs a connection, and the screen has to say so before somebody walks
    away believing their child is signed in. `navigator.onLine` is a weak signal — it
    reports the link, not whether the server is reachable — so it is used to warn and
    never to decide: the attempt is still made, and a real failure is reported by the
    action.
  */
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  /*
    Back to the roll eight seconds after a success. An entrance screen left on a
    confirmation is a screen the next family has to clear before they can start.

    Eight rather than six: long enough to read across a foyer while putting a coat on a hook,
    short enough that the next person in a 3pm queue is not waiting on it. The `Done` button
    is there for anybody who wants it gone sooner, and nothing else on the confirmation is
    tappable — there is no partial state left behind for the next person to find.
  */
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 8000);
    return () => clearTimeout(t);
  }, [done]);

  function chooseChild(child: KioskChild) {
    setProblem(null);
    startLoading(async () => {
      const result = await loadGuardians(child.childId);
      if ('error' in result) {
        setProblem(result.error);
        return;
      }
      if (result.guardians.length === 0) {
        setProblem('Nobody is listed for this child yet. Please ask a kaiako.');
        return;
      }
      setStep({ at: 'guardian', child, guardians: result.guardians });
    });
  }

  return (
    <main className="kiosk">
      <header className="kiosk-head">
        <h1>Sign in and out</h1>
        {/*
          THE STRIP IS ALWAYS HERE, AND IT NEVER MOVES ANYTHING.

          It used to render only when offline, which meant the roll jumped down the moment the
          wifi dropped — under the finger of somebody already reaching for their child's name.
          Reserving the height means the state can change while a parent is mid-tap without
          the target moving, the same reason the mobile app's offline strip reserves its own.

          Quiet when connected and breach-toned when not, because there is no offline queue on
          this screen and there is not going to be one: a queue here would mean a PIN sitting
          in browser storage waiting for a connection, and 0044 compares PINs inside Postgres
          precisely so that never has to happen.
        */}
        <p className={online ? 'kiosk-link' : 'kiosk-link is-offline'} role="status">
          {online
            ? 'Connected to the centre.'
            : 'This tablet is offline. A sign-in will not save until it is back — please ask a kaiako.'}
        </p>
      </header>

      {problem && (
        <p className="kiosk-problem" role="alert">
          {problem}
        </p>
      )}

      {done ? (
        <ConfirmationPanel message={done} onDone={() => setDone(null)} />
      ) : step.at === 'roll' ? (
        <Roll roll={roll} busy={loading} onChoose={chooseChild} />
      ) : step.at === 'guardian' ? (
        <GuardianPicker
          step={step}
          onBack={() => setStep({ at: 'roll' })}
          onChoose={(guardian) => setStep({ at: 'pin', child: step.child, guardian })}
          onReview={(guardian) => setStep({ at: 'review-pin', child: step.child, guardian })}
        />
      ) : step.at === 'pin' ? (
        <PinPad
          step={step}
          onBack={() => setStep({ at: 'roll' })}
          onSigned={(message) => {
            setStep({ at: 'roll' });
            setDone(message);
          }}
        />
      ) : step.at === 'review-pin' ? (
        <ReviewPinPanel
          step={step}
          week={week}
          onBack={() => setStep({ at: 'roll' })}
          onUnlocked={(pin, timezone, events) =>
            setStep({ at: 'review', child: step.child, guardian: step.guardian, pin, timezone, events })
          }
        />
      ) : (
        <ReviewPanel
          step={step}
          week={week}
          onBack={() => setStep({ at: 'roll' })}
          onDone={(message) => {
            setStep({ at: 'roll' });
            setDone(message);
          }}
        />
      )}

      <footer className="kiosk-foot">
        {/* No sign-out control, deliberately: this screen is unattended, and anybody
            walking past could otherwise log the tablet out and leave the centre with
            no roll. A device is signed out from a staff screen. */}
        <span>Tap your child, then your name.</span>
      </footer>
      <span hidden data-centre={centreId} />
    </main>
  );
}

function Roll({
  roll,
  busy,
  onChoose,
}: {
  roll: KioskChild[];
  busy: boolean;
  onChoose: (child: KioskChild) => void;
}) {
  if (roll.length === 0) {
    return <p className="kiosk-empty">No tamariki are enrolled here yet.</p>;
  }

  // Not here first. The queue at 8am is arriving and the queue at 3pm is leaving, and
  // sorting by state would reorder the grid under somebody's finger between those two
  // moments. Alphabetical stays put.
  const sorted = [...roll].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <ul className="kiosk-grid">
      {sorted.map((child) => (
        <li key={child.childId}>
          <button type="button" disabled={busy} onClick={() => onChoose(child)}>
            <span className="kiosk-name">{child.displayName}</span>
            <span className={`kiosk-state ${child.present ? 'is-here' : ''}`}>
              {child.present ? 'Here' : 'Not here'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GuardianPicker({
  step,
  onBack,
  onChoose,
  onReview,
}: {
  step: Extract<Step, { at: 'guardian' }>;
  onBack: () => void;
  onChoose: (guardian: KioskGuardian) => void;
  onReview: (guardian: KioskGuardian) => void;
}) {
  // Signing OUT needs `can_collect`; signing IN does not. Enforced again in Postgres —
  // this only decides what is worth offering.
  const signingOut = step.child.present;

  return (
    <section className="kiosk-panel">
      <h2>
        {step.child.displayName} &mdash; {signingOut ? 'going home' : 'arriving'}
      </h2>
      <p className="kiosk-sub">Who are you?</p>

      <ul className="kiosk-list">
        {step.guardians.map((g) => {
          const blocked = signingOut && !g.canCollect;
          return (
            <li key={g.guardianId}>
              <button type="button" disabled={blocked || !g.hasPin} onClick={() => onChoose(g)}>
                <span>{g.fullName}</span>
                {blocked && <span className="kiosk-note">not on the collection list</span>}
                {!blocked && !g.hasPin && <span className="kiosk-note">no PIN set up yet</span>}
              </button>
              {/*
                Drawn only for a named signatory with a PIN — the same display-only
                filtering as `canCollect` above, re-enforced by both 0062 functions.
                A secondary control rather than a second row, because the person mid
                sign-in at 8am must never mistake it for the button they came for.
              */}
              {g.isSignatory && g.hasPin && (
                <button type="button" className="kiosk-review" onClick={() => onReview(g)}>
                  Check last week&rsquo;s attendance
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" className="kiosk-back" onClick={onBack}>
        Back
      </button>
    </section>
  );
}

function PinPad({
  step,
  onBack,
  onSigned,
}: {
  step: Extract<Step, { at: 'pin' }>;
  onBack: () => void;
  onSigned: (message: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [state, action, pending] = useActionState<SignResult | null, FormData>(signAtDoor, null);
  const kind = step.child.present ? 'out' : 'in';

  /*
    A fresh key per attempt, as everywhere in this repo. `on conflict (client_uuid) do
    nothing` reports a repeated key as success, so a key fixed at mount would make the
    afternoon sign-out look like a duplicate of the morning sign-in — and the child
    would stay on the roll after going home.
  */
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(crypto.randomUUID()), []);

  useEffect(() => {
    if (!state || !('ok' in state)) return;
    if (state.message === null) {
      onSigned(
        `${step.child.displayName} is signed ${kind === 'in' ? 'in' : 'out'}. Ka pai!`,
      );
      return;
    }
    // A refusal the server phrased. Clear the PIN and stay put so they can retry
    // without starting from the roll.
    setPin('');
    setKey(crypto.randomUUID());
  }, [state, onSigned, step.child.displayName, kind]);

  const message = state && 'ok' in state ? state.message : null;
  const error = state && 'error' in state ? state.error : null;

  return (
    <section className="kiosk-panel">
      <h2>
        {step.guardian.fullName}, signing {step.child.displayName}{' '}
        {kind === 'in' ? 'in' : 'out'}
      </h2>
      <p className="kiosk-sub">Enter your PIN.</p>

      {(message || error) && (
        <p className="kiosk-problem" role="alert">
          {message ?? error}
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="childId" value={step.child.childId} />
        <input type="hidden" name="guardianId" value={step.guardian.guardianId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="clientUuid" value={key ?? ''} />
        <input type="hidden" name="pin" value={pin} />

        <PadGrid pin={pin} onPin={setPin} disabled={pending} />

        <div className="kiosk-actions">
          <button type="submit" disabled={pending || pin.length < 4 || key === null}>
            {pending ? 'Just a moment…' : `Sign ${kind === 'in' ? 'in' : 'out'}`}
          </button>
          <button type="button" className="kiosk-back" onClick={onBack} disabled={pending}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * The dots and the digits, shared by every PIN entry on this screen.
 *
 * Extracted when 0062 added a second PIN moment — one pad, so the sign-in flow and the
 * review flow cannot drift on the property that matters: the count is echoed, the digits
 * never are. A PIN echoed on a screen in an entrance is a PIN the person behind you can
 * read.
 */
function PadGrid({
  pin,
  onPin,
  disabled,
}: {
  pin: string;
  onPin: (next: (p: string) => string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <p className="kiosk-dots" aria-live="polite">
        {pin.length === 0 ? 'No numbers yet' : '•'.repeat(pin.length)}
        <span className="visually-hidden">{pin.length} numbers entered</span>
      </p>

      <div className="kiosk-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onPin((p) => (p.length < 8 ? p + d : p))}
            disabled={disabled}
          >
            {d}
          </button>
        ))}
        <button type="button" onClick={() => onPin(() => '')} disabled={disabled}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => onPin((p) => (p.length < 8 ? `${p}0` : p))}
          disabled={disabled}
        >
          0
        </button>
        <button type="button" onClick={() => onPin((p) => p.slice(0, -1))} disabled={disabled}>
          Back
        </button>
      </div>
    </>
  );
}

/**
 * Step one of the review: the PIN unlocks the week — §6-3's "information to which the
 * signature relates" has to be on screen before anything can be signed over it.
 */
function ReviewPinPanel({
  step,
  week,
  onBack,
  onUnlocked,
}: {
  step: Extract<Step, { at: 'review-pin' }>;
  week: ReviewWeek;
  onBack: () => void;
  onUnlocked: (pin: string, timezone: string, events: KioskWeekEvent[]) => void;
}) {
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function unlock() {
    setProblem(null);
    start(async () => {
      const result = await reviewWeek({
        childId: step.child.childId,
        guardianId: step.guardian.guardianId,
        from: week.from,
        to: week.to,
        pin,
      });
      if ('error' in result) {
        setProblem(result.error);
        return;
      }
      if (!result.ok) {
        // A refusal the server phrased — wrong PIN, locked. Clear and stay, as the
        // sign-in pad does, so a mistype does not restart from the roll.
        setProblem(result.message);
        setPin('');
        return;
      }
      onUnlocked(pin, result.timezone, result.events);
    });
  }

  return (
    <section className="kiosk-panel">
      <h2>
        {step.guardian.fullName}, checking {step.child.displayName}&rsquo;s week
      </h2>
      <p className="kiosk-sub">Enter your PIN to see last week&rsquo;s attendance.</p>

      {problem && (
        <p className="kiosk-problem" role="alert">
          {problem}
        </p>
      )}

      <PadGrid pin={pin} onPin={setPin} disabled={pending} />

      <div className="kiosk-actions">
        <button type="button" onClick={unlock} disabled={pending || pin.length < 4}>
          {pending ? 'Just a moment…' : 'Show me the week'}
        </button>
        <button type="button" className="kiosk-back" onClick={onBack} disabled={pending}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * Step two: the week itself, and the signature over it.
 *
 * Times render in the CENTRE's timezone, carried back by the function — never the
 * tablet's locale, which is whatever the hardware shipped with. The seven days are
 * always drawn, including empty ones: "nothing recorded on Wednesday" is information a
 * family may want to dispute, and a list that skips quiet days hides exactly the row
 * that is wrong.
 */
function ReviewPanel({
  step,
  week,
  onBack,
  onDone,
}: {
  step: Extract<Step, { at: 'review' }>;
  week: ReviewWeek;
  onBack: () => void;
  onDone: (message: string) => void;
}) {
  const [disputing, setDisputing] = useState(false);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(outcome: 'approved' | 'disputed') {
    setProblem(null);
    start(async () => {
      const result = await verifyAtDoor({
        childId: step.child.childId,
        guardianId: step.guardian.guardianId,
        from: week.from,
        to: week.to,
        outcome,
        comment,
        pin: step.pin,
      });
      if ('error' in result) {
        setProblem(result.error);
        return;
      }
      if (result.message !== null) {
        setProblem(result.message);
        return;
      }
      onDone(
        outcome === 'approved'
          ? `Last week is confirmed for ${step.child.displayName}. Ka pai!`
          : 'Thank you — the office will take a look and come back to you.',
      );
    });
  }

  // Group the instants into the centre's calendar days. en-CA because its date style
  // is YYYY-MM-DD, which matches the keys the seven-day loop below builds.
  const dayOf = new Intl.DateTimeFormat('en-CA', {
    timeZone: step.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeOf = new Intl.DateTimeFormat('en-NZ', {
    timeZone: step.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const byDay = new Map<string, KioskWeekEvent[]>();
  for (const e of step.events) {
    const day = dayOf.format(new Date(e.at));
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }

  const days: { date: string; label: string; events: KioskWeekEvent[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftLocalDate(week.from, i);
    const [y, m, d] = date.split('-').map(Number);
    // UTC on the parts: the string is already a centre-calendar day, and the tablet's
    // own zone must not shift it while turning it into a weekday name.
    const label = new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(Date.UTC(y as number, (m as number) - 1, d as number)));
    days.push({ date, label, events: byDay.get(date) ?? [] });
  }

  return (
    <section className="kiosk-panel">
      <h2>{step.child.displayName}&rsquo;s week</h2>
      <p className="kiosk-sub">
        If this looks right, confirm it. If something is off, tell the office.
      </p>

      {problem && (
        <p className="kiosk-problem" role="alert">
          {problem}
        </p>
      )}

      <ul className="kiosk-week">
        {days.map((day) => (
          <li key={day.date}>
            <span className="kiosk-week-day">{day.label}</span>
            <span className="kiosk-week-times">
              {day.events.length === 0
                ? 'nothing recorded'
                : day.events
                    .map((e) => `${e.kind === 'in' ? 'in' : 'out'} ${timeOf.format(new Date(e.at))}`)
                    .join(', ')}
            </span>
          </li>
        ))}
      </ul>

      {disputing && (
        <label className="kiosk-comment">
          What looks wrong?
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            disabled={pending}
          />
        </label>
      )}

      <div className="kiosk-actions">
        {disputing ? (
          <button
            type="button"
            onClick={() => send('disputed')}
            disabled={pending || comment.trim().length === 0}
          >
            {pending ? 'Just a moment…' : 'Send to the office'}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => send('approved')} disabled={pending}>
              {pending ? 'Just a moment…' : 'That’s right — confirm it'}
            </button>
            <button type="button" onClick={() => setDisputing(true)} disabled={pending}>
              Something&rsquo;s not right
            </button>
          </>
        )}
        <button type="button" className="kiosk-back" onClick={onBack} disabled={pending}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * The confirmation, over the whole screen.
 *
 * Full-screen rather than a panel in the flow, for one reason: it has to be readable from
 * where the parent is standing when they turn to leave, which is several steps away and not
 * looking directly at the tablet. A panel among the roll is read by somebody still at arm's
 * length.
 *
 * It covers the roll, which means the next person cannot start until it clears — that is the
 * cost and it is the right way round. Eight seconds of "Ka pai" is better than a second
 * family beginning a sign-in on top of a confirmation the first one never saw.
 *
 * One control, and it dismisses. No "undo", no link to the child, nothing that leads
 * anywhere: this screen is unattended and every affordance on it is a thing a stranger in
 * the foyer can press.
 */
function ConfirmationPanel({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <section className="kiosk-done" role="status" aria-live="assertive">
      <p>{message}</p>
      <button type="button" onClick={onDone}>
        Done
      </button>
    </section>
  );
}
