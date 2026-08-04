/**
 * Creates a centre and attaches its first owner.
 *
 * This exists because there is deliberately no way to do it from the app. There
 * is no INSERT policy on `centres` and no INSERT grant on `memberships`, so a
 * signed-in user cannot create a tenant or add themselves to one — which is the
 * point: a self-serve version of this is how a stranger joins a centre and reads
 * children's records.
 *
 * So it runs with the service role, which bypasses RLS entirely. Every line below
 * is outside the tenant boundary and should be read with that in mind.
 *
 * No password is ever set or printed. It issues an invite link and the person
 * chooses their own credential — a password this script generated would exist in
 * a terminal buffer, a scrollback, and probably a chat message.
 *
 *   npx tsx scripts/onboard.ts --name "Little Pearls Mt Albert" \
 *                              --slug little-pearls-mt-albert \
 *                              --owner manager@example.co.nz \
 *                              [--moe 12345] [--existing-centre <uuid>]
 */

import { createClient } from '@supabase/supabase-js';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const owner = typeof args.owner === 'string' ? args.owner.trim().toLowerCase() : '';
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
  const moe = typeof args.moe === 'string' ? args.moe.trim() : null;
  const existing = typeof args['existing-centre'] === 'string' ? args['existing-centre'] : null;

  if (!owner || !owner.includes('@')) die('--owner must be an email address.');
  if (!existing && (!name || !slug)) die('--name and --slug are required unless --existing-centre is given.');
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    die('--slug must be lowercase letters, numbers and hyphens: it appears in URLs.');
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // --- the centre ----------------------------------------------------------
  let centreId = existing;
  if (!centreId) {
    const { data, error } = await db
      .from('centres')
      .insert({ name, slug, moe_service_number: moe })
      .select('id, name, slug')
      .single();
    // 23505 is the unique violation. Both `slug` and `moe_service_number` are
    // unique, and re-running this after a half-finished onboarding is a normal
    // thing to do, so say which one collided rather than printing a raw error.
    if (error) {
      if (error.code === '23505') {
        die(
          `A centre already exists with that slug or Ministry service number.\n  ` +
            `Pass --existing-centre <uuid> to attach an owner to it instead.`,
        );
      }
      die(`Creating the centre failed: ${error.message}`);
    }
    centreId = data.id;
    console.log(`\n  centre      ${data.name}  (${data.slug})`);
    console.log(`              ${centreId}`);
  } else {
    const { data, error } = await db.from('centres').select('id, name, slug').eq('id', centreId).single();
    if (error || !data) die(`No centre with id ${centreId}.`);
    console.log(`\n  centre      ${data.name}  (${data.slug})  [existing]`);
  }

  // --- the person ----------------------------------------------------------
  //
  // `generateLink` is used for both cases rather than `inviteUserByEmail`, for
  // three reasons:
  //
  //  * It returns the user id, so no lookup is needed. There is no admin
  //    get-user-by-email, and `listUsers` is a paginated search that has to be
  //    walked — and on this project it returns a bare 500, so a script depending
  //    on it fails with `{}` as its error message.
  //  * It does not depend on SMTP being configured. A project without a custom
  //    mailer cannot send invites reliably, and onboarding should not be blocked
  //    on email delivery.
  //  * Onboarding a manager's second site is the common case, so "already has an
  //    account" is a normal path, not an error. For them `recovery` is also the
  //    correct artefact: they need to get in, not to be invited again.
  let userId: string;
  let actionLink: string | null;
  let note: string;

  const asInvite = await db.auth.admin.generateLink({ type: 'invite', email: owner });
  if (!asInvite.error) {
    userId = asInvite.data.user.id;
    actionLink = asInvite.data.properties?.action_link ?? null;
    note = 'new account';
  } else {
    const alreadyExists =
      asInvite.error.status === 422 || /already.*registered/i.test(asInvite.error.message);
    if (!alreadyExists) die(`Creating an account for ${owner} failed: ${asInvite.error.message}`);

    const recovery = await db.auth.admin.generateLink({ type: 'recovery', email: owner });
    if (recovery.error || !recovery.data?.user?.id) {
      die(`${owner} already has an account but no sign-in link could be issued: ${recovery.error?.message ?? 'no user returned'}`);
    }
    userId = recovery.data.user.id;
    actionLink = recovery.data.properties?.action_link ?? null;
    note = 'existing account';
  }
  console.log(`  owner       ${owner}  [${note}]`);

  // --- the membership ------------------------------------------------------
  //
  // Upsert on (centre_id, user_id) so re-running is a no-op, and reinstate a
  // revoked row rather than leaving somebody locked out with no visible reason.
  const { error: memberError } = await db
    .from('memberships')
    .upsert(
      { centre_id: centreId, user_id: userId, role: 'owner', revoked_at: null },
      { onConflict: 'centre_id,user_id' },
    );
  if (memberError) die(`Attaching the owner failed: ${memberError.message}`);
  console.log(`  role        owner`);

  console.log(
    actionLink
      ? `\n  Send them this to set a password. Single use, and it expires —\n` +
          `  re-run this command to issue another.\n\n  ${actionLink}\n`
      : `\n  No sign-in link was issued. They will need a password reset from the app.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
