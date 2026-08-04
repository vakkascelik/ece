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
import type { Centre, Membership, Session } from '@ece/core';

export type Db = SupabaseClient;

/**
 * Anon-key client. Safe in the browser and in the mobile bundle: every request
 * carries the user's JWT and RLS decides what it can see.
 */
export function createAnonClient(url: string, anonKey: string): Db {
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
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
    .select('id, name, moe_service_number, slug, timezone, archived_at')
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
  return {
    userId: auth.user.id,
    memberships,
    // Never guessed when there is a choice. A manager of two sites who lands on
    // the wrong one and posts a notice has done real damage that is awkward to
    // undo, so with more than one membership the app must ask.
    activeCentreId: memberships.length === 1 ? memberships[0].centreId : null,
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
    .select('id, name, moe_service_number, slug, timezone, archived_at')
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
