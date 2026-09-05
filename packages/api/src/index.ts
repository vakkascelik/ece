/**
 * @ece/api — the only place either app talks to Supabase.
 *
 * Both the web app and the mobile app import from here, so queries are written
 * once and behave identically. That matters more than it sounds: a query
 * duplicated between two clients is a query that will diverge, and the version
 * that diverges is usually the one that forgets a filter.
 *
 * Note what is NOT here: tenant filtering. Every tenant-scoped table is behind
 * Row Level Security keyed on `caller_centre_ids()`, so Postgres restricts the
 * rows and these functions do not. Adding `.eq('centre_id', …)` on top would be
 * harmless but misleading — it would suggest the filter is what keeps centres
 * apart, and the next person would trust it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Centre,
  LicenceType,
  Membership,
  RatioSource,
  ServiceModel,
  Session,
} from '@ece/core';

export type Db = SupabaseClient;

/**
 * Anon-key client. The key is safe to expose — every request carries the user's JWT and RLS decides
 * what it can see — but read the defaults below before using this in a browser.
 *
 * THE DEFAULTS ARE SERVER-SAFE, WHICH IS THE OPPOSITE OF WHAT THEY WERE.
 *
 * They used to be `{ persistSession: true, autoRefreshToken: true }` — right for a browser, and
 * every actual caller is server-side: the current-password check in `/account`, and two scripts.
 * Nothing in a browser calls this at all (the web app has `lib/supabaseBrowser.ts`, mobile has its
 * own), so the defaults were wrong for 100% of the callers and right for the one in the comment.
 *
 * What that cost: `autoRefreshToken` starts a ticker that fires every thirty seconds, so each
 * password change left a timer holding a reference to a client nobody would use again, keeping
 * Node's event loop alive. `persistSession` on a server is worse than useless — it makes two
 * simultaneous callers share one process-wide storage adapter.
 *
 * A browser caller must now opt in explicitly, which is the right way round: a session that fails
 * to persist is visible immediately, and a leaked timer is not.
 */
export function createAnonClient(
  url: string,
  anonKey: string,
  auth: { persistSession?: boolean; autoRefreshToken?: boolean; detectSessionInUrl?: boolean } = {},
): Db {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      ...auth,
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely, so it is the one credential that
 * can read every centre's children at once.
 *
 * Server-side only, for onboarding a tenant and for scheduled jobs. Never
 * construct this anywhere the mobile app or the browser can reach — Expo
 * inlines `EXPO_PUBLIC_*` into the shipped binary, and anything in a browser
 * bundle is public.
 */
export function createServiceClient(url: string, serviceRoleKey: string): Db {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface CentreRow {
  id: string;
  name: string;
  moe_service_number: string | null;
  slug: string;
  timezone: string;
  medication_requires_witness: boolean;
  sleep_check_minutes: number | null;
  drill_interval_days: number | null;
  licensed_places: number | null;
  ratio_source: RatioSource;
  ai_features: boolean;
  licence_type: LicenceType | null;
  service_model: ServiceModel | null;
  archived_at: string | null;
}

interface MembershipRow {
  id: string;
  centre_id: string;
  user_id: string;
  role: Membership['role'];
  revoked_at: string | null;
}

const toCentre = (r: CentreRow): Centre => ({
  id: r.id,
  name: r.name,
  moeServiceNumber: r.moe_service_number,
  slug: r.slug,
  timezone: r.timezone,
  medicationRequiresWitness: r.medication_requires_witness,
  // Null is meaningful and must survive the trip: it means the centre has stated no
  // interval, which the UI renders differently from any number. Do not `?? 0`.
  sleepCheckMinutes: r.sleep_check_minutes,
  // Null is meaningful here too: none stated, which the screen renders differently
  // from any number.
  drillIntervalDays: r.drill_interval_days,
  // Null is meaningful a third time: not stated, which the occupancy report renders
  // as a sentence rather than as a percentage. Do not `?? 0`.
  licensedPlaces: r.licensed_places,
  ratioSource: r.ratio_source,
  aiFeatures: r.ai_features,
  // Null is meaningful a fourth and fifth time: not stated. Nothing guesses a licence
  // or a service model, because a guess selects a ratio schedule. See 0083.
  licenceType: r.licence_type,
  serviceModel: r.service_model,
  archivedAt: r.archived_at,
});

const toMembership = (r: MembershipRow): Membership => ({
  id: r.id,
  centreId: r.centre_id,
  userId: r.user_id,
  role: r.role,
  revokedAt: r.revoked_at,
});

/** Every centre the signed-in user may see. RLS does the restricting. */
export async function listMyCentres(db: Db): Promise<Centre[]> {
  const { data, error } = await db
    .from('centres')
    .select('id, name, moe_service_number, slug, timezone, medication_requires_witness, sleep_check_minutes, drill_interval_days, licensed_places, ratio_source, ai_features, licence_type, service_model, archived_at')
    .is('archived_at', null)
    .order('name');
  if (error) throw new Error(`listMyCentres: ${error.message}`);
  return (data as CentreRow[]).map(toCentre);
}

export async function loadSession(db: Db): Promise<Session | null> {
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await db
    .from('memberships')
    .select('id, centre_id, user_id, role, revoked_at')
    .eq('user_id', auth.user.id)
    .is('revoked_at', null);
  if (error) throw new Error(`loadSession: ${error.message}`);

  const memberships = (data as MembershipRow[]).map(toMembership);

  /*
    Only asked when the membership list is empty, which is the only way a kiosk can
    look — 0043 hides kiosk rows from `memberships_select`, so a device reads none of
    its own. Every human therefore pays nothing for this: one extra round trip on the
    one session shape that would otherwise be uninterpretable.

    An account holding both a human membership and a kiosk one is a misconfiguration,
    and this resolves it toward the person. The narrower reading — a device that is
    also somebody's login — is the one that should not silently work.
  */
  let kioskCentreId: string | null = null;
  if (memberships.length === 0) {
    const { data: centre, error: kioskError } = await db.rpc('caller_kiosk_centre_id');
    if (kioskError) throw new Error(`loadSession (kiosk): ${kioskError.message}`);
    kioskCentreId = typeof centre === 'string' ? centre : null;
  }

  return {
    userId: auth.user.id,
    memberships,
    // Never guessed when there is a choice. A manager of two sites who lands on
    // the wrong one and posts a notice has done real damage that is awkward to
    // undo, so with more than one membership the app must ask.
    activeCentreId: memberships.length === 1 ? memberships[0].centreId : null,
    kioskCentreId,
  };
}

// ---------------------------------------------------------------------------
// Onboarding — service role only
// ---------------------------------------------------------------------------

/**
 * Create a centre and make someone its owner.
 *
 * Requires a service-role client: there is deliberately no RLS policy allowing
 * an authenticated user to insert into `centres`, because a self-serve tenant
 * table fills with junk and the support cost lands on one person.
 */
export async function createCentre(
  serviceDb: Db,
  input: { name: string; slug: string; ownerUserId: string; moeServiceNumber?: string | null },
): Promise<Centre> {
  const { data, error } = await serviceDb
    .from('centres')
    .insert({
      name: input.name,
      slug: input.slug,
      moe_service_number: input.moeServiceNumber ?? null,
    })
    .select('id, name, moe_service_number, slug, timezone, medication_requires_witness, sleep_check_minutes, drill_interval_days, licensed_places, ratio_source, ai_features, licence_type, service_model, archived_at')
    .single();
  if (error) throw new Error(`createCentre: ${error.message}`);

  const centre = toCentre(data as CentreRow);

  const { error: memberError } = await serviceDb
    .from('memberships')
    .insert({ centre_id: centre.id, user_id: input.ownerUserId, role: 'owner' });
  if (memberError) {
    // A centre with no owner is unreachable through the app — nobody can see it
    // and nobody can grant access to it. Fail loudly rather than leave one.
    throw new Error(
      `createCentre: centre ${centre.id} was created but the owner membership failed ` +
        `(${memberError.message}). It has no owner and must be repaired or removed.`,
    );
  }

  return centre;
}

export * from './members';
export * from './children';
export * from './invitations';
export * from './attendance';
export * from './compliance';
export * from './engagement';
export * from './billing';
export * from './rs7';
export * from './recruitment';
export * from './registers';
export * from './facilities';
// Evidence photos — 0075. Staff-only, and deliberately not part of ./engagement:
// nothing in it touches consent, and keeping it apart is what keeps that true.
export * from './evidence';

// Rooms, tasks and checklists — 0066 to 0069. Note the boundary is NOT uniform in
// here: `rooms` is readable by a parent and everything else in the file is staff-only.
export * from './worklist';
export * from './staff';
// The ECE Return's staffing section. Reuses `listStaffMembers` and `listStaffRecords`
// rather than reading those tables again — the registration flag comes from the same
// practising-certificate row the licensing binder reads, so the two cannot disagree.
export * from './census';

// The enrolment agreement as a weekday pattern (0085). Separate from `children.ts` because
// the agreement is a funding input with its own write predicate, not part of the child record's
// vocabulary — and separate from `census.ts` because the two tables share a shape and nothing
// else: one is a staff contract, the other a parent-signed agreement.
export * from './bookingSchedule';

// Where a child lives (0086). Its own module rather than part of `children.ts` for the reason
// `bookingSchedule` is: the enrolment vocabulary in there is already large, and this table has
// a different write predicate and a different identity rule from everything beside it.
export * from './childAddresses';

// Service closures (0088). Centre-scoped rather than child-scoped, and the only table in
// this package whose read policy is plain centre membership - a family needs to know the
// centre is shut next Thursday.
export * from './closures';
// Definer functions only — a kiosk holds no table grant, so there is nothing here to
// select from and no query for a later reader to widen.
export * from './kiosk';

// Usage records for external model calls. Not the calls themselves — see @ece/ai.
export * from './ai';

// Enrolment enquiries. The public write path is the definer function; apps/site maps a
// narrow import to this module so it cannot reach the rest of the API.
export * from './enquiries';

// A family's own notification queue, and the emergency broadcast that is 0057's only writer
// of it so far — the fan-out is a definer function, the same shape as kiosk.ts.
export * from './notifications';
