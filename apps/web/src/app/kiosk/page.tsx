import { kioskRoll } from '@ece/api';
import { requireKiosk } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { KioskScreen } from './KioskScreen';
/*
  Route-scoped, and the first stylesheet in this app that is not `globals.css`.

  It was in the global sheet and pushed `first-load-css` over its 4kB budget — which
  was the check doing its job, but the number was the symptom. The real objection is
  that a door tablet's styles were being downloaded by every parent opening the app on
  a phone, to render a screen they will never see. Next scopes a stylesheet imported
  here to this route's chunk, so the budget is met by shipping less rather than by
  raising the limit.

  The pattern is worth copying only for a screen with a genuinely different visual
  language. Two of these is a design system; five is the CSS framework the budget
  exists to catch.
*/
import './kiosk.css';

/**
 * The door tablet.
 *
 * WHY THIS LIVES OUTSIDE `(app)`
 *
 * Because everything in that group renders the rail: every capability-filtered nav
 * link, the centre name, the role pill, and a sign-out control. On a screen in an
 * entrance that last one is the problem — anybody walking past could log the tablet
 * out, and the centre would discover it at the end of the day with no roll. So this is
 * a sibling segment, like `/login`, and it inherits the root layout and its per-request
 * CSP nonce and nothing else.
 *
 * `requireKiosk` is the mirror of `requireCtx` and deliberately not built on it: that
 * function sends a kiosk *here*, so reusing it would be the redirect loop again under
 * a different name.
 *
 * WHAT THIS SCREEN DOES NOT DO, BOTH ON PURPOSE
 *
 * **No ratio.** `kiosk_roll()` returns no date of birth, so the age bands cannot be
 * computed and `assessRatio` cannot run. A tablet that showed a ratio would need to
 * know every child's age, which is exactly the reading 0044 refused. It shows who is
 * here; the ratio is a staff screen.
 *
 * **No offline queue.** The web outbox holds attendance only and has nowhere to put a
 * guardian or a PIN — and a PIN in `localStorage` on an unattended tablet defeats the
 * entire point of 0044, which is that it is compared inside Postgres and never held by
 * the application. So a tap needs a connection, and the screen says so plainly rather
 * than accepting one it cannot deliver.
 */
export default async function KioskPage() {
  const ctx = await requireKiosk();
  const db = await serverDb();
  const roll = await kioskRoll(db);

  return <KioskScreen roll={roll} centreId={ctx.centreId} />;
}
