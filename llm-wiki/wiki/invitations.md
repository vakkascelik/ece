# Invitations

A two-step handshake for adding a person to a centre, with only the hash of each token
stored.

## Overview

There is deliberately no INSERT grant on `memberships`, because the self-serve version of
"add a person" is how a stranger joins a centre and reads children's records. Creating a
tenant and its first owner is therefore a script (`npm run onboard`); adding the fifth
educator is a form, because a manager should be able to do that on a Tuesday without
anybody's laptop.

An invitation is a two-step handshake: a manager states an intention, and the person named
proves they control that mailbox. The membership is created by the server at the end, not by
either party.

## Key Points

- **Only the SHA-256 of each token is stored.** A leaked backup yields nothing usable.
- **The manager who created it cannot read the hash back** — a column-level `GRANT`.
- **The invited email must match the signed-in one.** Otherwise the link is a bearer token
  for children's records.
- **Signups are disabled on the project**, which makes the invitation the authorisation to
  create the account.
- **The account is created *before* the invitation is claimed.** The other order strands
  somebody with a spent link.
- **No email is sent**, because no mailer is configured. The link is shown once and the
  product says so.

## Details

### Storing only the hash

The tokens themselves exist only in the emails they were sent in — the same reasoning as
never storing a password. A database read (a leaked backup, an errant service-role query, a
support person with dashboard access) then yields nothing that can be used.

The consequence is that a link **cannot be recovered**. Losing it means issuing a new one,
which supersedes the old: `createInvitation` withdraws any live invitation for that mailbox
first, because `invitations_one_live_per_email` refuses a second row and leaving two working
links for one mailbox is worse than losing the first.

The `token_hash` column is not granted to `authenticated` at all. There is no reason for a
browser to hold those values, and a column grant is the only mechanism that can say so.
Asserted in the suite.

### Three checks on acceptance, none optional

1. **The token matches something live** — not accepted, not withdrawn, not past seven days.
2. **The signed-in email is the invited one.** Without this a forwarded email, or one sitting
   in a shared inbox, becomes a way in. The cost is that somebody who signed up under a
   different address has to be re-invited, which is the right way round.
3. **It has not already been used.** Claiming and creating the membership are two statements,
   so the claim is written first and made conditional on the row still being unaccepted — two
   simultaneous clicks cannot both win. If the membership insert then fails the invitation is
   spent and must be reissued: an inconvenience rather than a link that works twice.

### Signups are disabled, so the invitation authorises the account

`disable_signup: true` is set on the Supabase project. Nobody self-registers into this
product, and an account with no membership is a dead end.

That makes the invitation the authorisation: possessing a token sent to a mailbox is proof of
holding that mailbox — exactly what an email verification link proves — so acceptance creates
the account with `email_confirm: true`.

Order matters and is not obvious. The account is created **before** the invitation is
claimed. The other way round, a failed signup leaves the invitation spent and the person
locked out with no way back except a manager reissuing it.

### Rejected: "join anyway" for a signed-in mismatch

The acceptance page tells somebody signed in as the wrong address to sign out and back in. It
does not offer a button. An invitation any signed-in person could accept is a bearer token
for access to children's records.

### Rejected: claiming an email was sent

No mailer is configured, so the link is shown to the manager once, to pass on however they
already talk to their staff. Saying that plainly beats a "we've sent an email" that never
arrives. Wiring a mailer changes one function.

### Why the hashing is not in `@ece/api`

`node:crypto` cannot be bundled for Metro, and it is exactly the import that breaks a mobile
build with an error that never mentions workspaces. So the queries take a `tokenHash` and the
web app hashes — which is also a useful guardrail, since a raw token should never exist in a
client bundle.

### `onboard.ts` and `generateLink`

The onboarding script uses `generateLink` rather than `inviteUserByEmail`, for three reasons:
it returns the user id (there is no admin get-user-by-email, and `listUsers` returned a bare
500 on this project); it does not depend on SMTP; and "already has an account" is a normal
path for a manager's second site, for whom `recovery` is the correct artefact anyway.

It never sets or prints a password.

The `listUsers` 500, run to ground on 2026-08-05: two `auth.users` rows inherited from the
Zelva era carry NULL in token columns (`confirmation_token` and friends) that the current
GoTrue scans into non-nullable strings, so any page containing either row fails with
"Database error finding users" — which also broke the dashboard's user list. The repair is
`coalesce` to `''`, the value new rows get. Worth remembering the shape: an admin API that
500s on *some* pages is usually one poison row, findable by walking `per_page=1`.

Since 2026-08-05 the script also takes `--role manager` (default remains `owner`). It stops
at those two: educators and whānau are invited from the app by the centre's own staff, which
keeps the decision and its audit trail inside the tenant instead of in a terminal.

## See Also

- [[tenancy-and-rls]] — why `memberships` has no INSERT grant
- [[conventions]]

*Last updated: 2026-08-05*
