import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listMyCentres, loadSession } from '@ece/api';
import { activeRole, can, isKiosk, type Capability, type Centre, type MemberRole } from '@ece/core';
import { serverDb } from './supabase';

/**
 * Resolving "who is this and which centre are they looking at" for every page.
 *
 * The active centre lives in a cookie so a server render can read it without a
 * round trip. A cookie is client-controlled, so it is a *preference*, never a
 * grant: every request re-checks it against the caller's memberships, and an
 * unrecognised value is discarded rather than trusted. RLS would refuse the
 * queries anyway, but failing here produces a comprehensible screen instead of
 * an empty one.
 */

export const CENTRE_COOKIE = 'ece_centre';

export interface Ctx {
  userId: string;
  centre: Centre;
  role: MemberRole;
  centres: Centre[];
}

/**
 * Everything a signed-in page needs, or a redirect.
 *
 * Redirects rather than throwing, because every authenticated page wants the
 * same three outcomes and repeating that logic per page is how one page ends up
 * rendering for a signed-out user.
 */
export async function requireCtx(): Promise<Ctx> {
  const db = await serverDb();
  const session = await loadSession(db);
  if (!session) redirect('/login');

  /*
    A door tablet has no business on any page in this group, and until this branch
    existed it could not say so: a kiosk reads no memberships (0043) but one centre,
    so it fell past the checks below with a centre and no role and was sent to
    `/select-centre` — which rendered, offered its single centre, and bounced back
    here on every press. A loop, not a refusal.

    Sent to `/kiosk` rather than `/no-access` because the account is working exactly
    as intended; it is simply not a person.
  */
  if (isKiosk(session)) redirect('/kiosk');

  const centres = await listMyCentres(db);
  if (centres.length === 0) redirect('/no-access');

  const store = await cookies();
  const requested = store.get(CENTRE_COOKIE)?.value;

  // The cookie is a hint. Only a value backed by a live membership is honoured.
  const chosen =
    (requested && centres.find((c) => c.id === requested)) ??
    (centres.length === 1 ? centres[0] : undefined);

  if (!chosen) redirect('/select-centre');

  const role = activeRole({ ...session, activeCentreId: chosen.id });
  if (!role) redirect('/select-centre');

  return { userId: session.userId, centre: chosen, role, centres };
}

/**
 * Gate a page on a capability.
 *
 * This is a usability boundary, not a security one — RLS and the write policies
 * are what actually stop an educator changing the roster. Hiding it here just
 * means they never see a button that would fail.
 */
export async function requireCapability(capability: Capability): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!can(ctx.role, capability)) redirect('/');
  return ctx;
}

export interface KioskCtx {
  userId: string;
  centreId: string;
}

/**
 * The mirror of `requireCtx`, for the one route a device may see.
 *
 * Deliberately not built on `requireCtx` — that function redirects a kiosk *to*
 * `/kiosk`, so reusing it here would be the loop again with different names. The two
 * guards are opposites and each sends the other's caller away.
 *
 * It returns a centre id and nothing else. There is no `Centre` and no role, because
 * everything a kiosk may know comes back from the definer functions in 0044 and
 * widening this return type is how a screen in an entrance starts rendering a roll it
 * was never granted.
 */
export async function requireKiosk(): Promise<KioskCtx> {
  const db = await serverDb();
  const session = await loadSession(db);
  if (!session) redirect('/login');
  if (!isKiosk(session)) redirect('/');
  return { userId: session.userId, centreId: session.kioskCentreId as string };
}
