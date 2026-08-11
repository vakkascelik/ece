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
 *                              [--moe 12345] [--existing-centre <uuid>] [--role manager] \
 *                              [--app-url https://host/portal]
 *
 * `--app-url` (or `ECE_PUBLIC_URL`) is where the sign-in link points. Required to print one,
 * because a script has no request to read a host from and the app is served under a path on a
 * hostname it does not own — see the long note where the link is built.
 *
 * `--role` covers the other person this script legitimately attaches: a manager,
 * which its own comments call the common case. It stops there — educators and
 * whānau are invited from the app by the centre's own staff, which keeps the
 * decision and its audit trail inside the tenant instead of in a terminal.
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
  const role = typeof args.role === 'string' ? args.role.trim() : 'owner';

  if (role !== 'owner' && role !== 'manager') {
    die(`--role must be owner or manager, not "${role}". Educators and whānau are invited from the app.`);
  }
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
  let hashedToken: string | null;
  let linkType: 'invite' | 'recovery';
  let note: string;

  const asInvite = await db.auth.admin.generateLink({ type: 'invite', email: owner });
  if (!asInvite.error) {
    userId = asInvite.data.user.id;
    hashedToken = asInvite.data.properties?.hashed_token ?? null;
    linkType = 'invite';
    /*
     * "new or unconfirmed", not "new".
     *
     * This said `new account`, and it lied the second time it was run for the same person:
     * re-issuing an invite for a user who exists but has never set a password **succeeds**, so this
     * branch is taken again and the same user id comes back. Onboarding somebody to their second
     * centre therefore printed "new account" twice, which reads like two accounts were created.
     * Caught by checking the memberships afterwards and finding one user id, not two.
     */
    note = 'new or not yet confirmed';
  } else {
    const alreadyExists =
      asInvite.error.status === 422 || /already.*registered/i.test(asInvite.error.message);
    if (!alreadyExists) die(`Creating an account for ${owner} failed: ${asInvite.error.message}`);

    const recovery = await db.auth.admin.generateLink({ type: 'recovery', email: owner });
    if (recovery.error || !recovery.data?.user?.id) {
      die(`${owner} already has an account but no sign-in link could be issued: ${recovery.error?.message ?? 'no user returned'}`);
    }
    userId = recovery.data.user.id;
    hashedToken = recovery.data.properties?.hashed_token ?? null;
    linkType = 'recovery';
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
      { centre_id: centreId, user_id: userId, role, revoked_at: null },
      { onConflict: 'centre_id,user_id' },
    );
  if (memberError) die(`Attaching the ${role} failed: ${memberError.message}`);
  console.log(`  role        ${role}`);

  /*
   * THIS PRINTED A LINK THAT COULD NOT SIGN ANYBODY IN, AND HAD SINCE THE SCRIPT WAS WRITTEN.
   *
   * It printed `properties.action_link` — GoTrue's own `/verify` URL. Measured on 2026-08-05 and
   * written up in llm-wiki/wiki/password-recovery.md: for a link from `generateLink`, `/verify`
   * responds `303` to `…#access_token=…`, and **a fragment is never sent to the server**. Nothing in
   * `apps/web` reads one — `browserDb()` exists and is called from nowhere, so `detectSessionInUrl`
   * never runs. The person landed on `site_url`, signed out, with nothing to act on.
   *
   * That page recorded the fix as available, cheap and "not yet applied". It is applied here,
   * because onboarding Little Pearls' manager produced exactly the dead link it describes and the
   * working one had to be hand-built to get him in.
   *
   * `token_hash` is the branch `/auth/confirm` can actually read: no PKCE verifier, so it works in
   * any browser, which is the right property for a link that gets pasted into a message.
   *
   * WHY THE BASE URL HAS TO BE GIVEN RATHER THAN GUESSED
   *
   * A script has no request to read a host from, and the app is served under `/portal` on somebody
   * else's hostname — so there is no default that is right more often than it is wrong. Guessing
   * would reintroduce the same failure one level up: a plausible link that goes nowhere. It reads
   * `ECE_PUBLIC_URL`, the variable the app itself now uses for outbound links, so there is one
   * answer to "where do people reach this" rather than two that drift.
   */
  const appUrl = (typeof args['app-url'] === 'string' ? args['app-url'] : process.env.ECE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');

  if (!hashedToken) {
    console.log(`\n  No sign-in link was issued. They will need a password reset from the app.\n`);
    return;
  }
  if (!appUrl) {
    console.log(
      `\n  Attached, but no link was printed: this script cannot know the public URL.\n` +
        `  Set ECE_PUBLIC_URL or pass --app-url https://host/portal and re-run — it is\n` +
        `  idempotent, and re-running issues a fresh token.\n`,
    );
    return;
  }

  const link = `${appUrl}/auth/confirm?token_hash=${hashedToken}&type=${linkType}&next=/reset-password`;
  console.log(
    `\n  Send them this to set a password. Single use, and it expires —\n` +
      `  re-run this command to issue another.\n\n  ${link}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
