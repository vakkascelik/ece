'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import type { KioskChild, KioskGuardian } from '@ece/api';
import { loadGuardians, signAtDoor, type SignResult } from './actions';

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
 */

type Step =
  | { at: 'roll' }
  | { at: 'guardian'; child: KioskChild; guardians: KioskGuardian[] }
  | { at: 'pin'; child: KioskChild; guardian: KioskGuardian };

export function KioskScreen({ roll, centreId }: { roll: KioskChild[]; centreId: string }) {
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

  // Back to the roll a few seconds after a success. An entrance screen left on a
  // confirmation is a screen the next family has to clear before they can start.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 6000);
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
        {!online && (
          <p className="kiosk-offline" role="status">
            This tablet is offline. Signing in needs a connection — please ask a kaiako.
          </p>
        )}
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
        />
      ) : (
        <PinPad
          step={step}
          onBack={() => setStep({ at: 'roll' })}
          onSigned={(message) => {
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
}: {
  step: Extract<Step, { at: 'guardian' }>;
  onBack: () => void;
  onChoose: (guardian: KioskGuardian) => void;
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

        <p className="kiosk-dots" aria-live="polite">
          {/* The count, not the digits. A PIN echoed on a screen in an entrance is a
              PIN the person behind you can read. */}
          {pin.length === 0 ? 'No numbers yet' : '•'.repeat(pin.length)}
          <span className="visually-hidden">{pin.length} numbers entered</span>
        </p>

        <div className="kiosk-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPin((p) => (p.length < 8 ? p + d : p))}
              disabled={pending}
            >
              {d}
            </button>
          ))}
          <button type="button" onClick={() => setPin('')} disabled={pending}>
            Clear
          </button>
          <button
            type="button"
            onClick={() => setPin((p) => (p.length < 8 ? `${p}0` : p))}
            disabled={pending}
          >
            0
          </button>
          <button
            type="button"
            onClick={() => setPin((p) => p.slice(0, -1))}
            disabled={pending}
          >
            Back
          </button>
        </div>

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

function ConfirmationPanel({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <section className="kiosk-panel kiosk-done">
      <p role="status">{message}</p>
      <button type="button" onClick={onDone}>
        Done
      </button>
    </section>
  );
}
