# Password recovery and change

Self-serve password reset by email, and an in-app password change — and why the "no password
reset, ask for a re-invitation" stance the design documents carried was corrected rather than
implemented.

## Overview

Until 2026-08-05 the platform had no way for a user to change a lost password. The design
handoff said so on the login screen itself — "There is no sign-up and no password reset here —
ask your centre to re-invite you" — and presented re-invitation as the recovery path.

That path did not exist. The invitation flow **refuses** to set a password for an address that
already has an account, deliberately, because doing so would let anyone who intercepts an
invitation take over the existing account (`apps/web/src/app/invite/[token]/actions.ts`). So the
documented recovery route dead-ended at "sign in first" — which is the one thing the person
cannot do. A user who forgot their password was locked out permanently, fixable only by an
operator in the Supabase dashboard. For an owner-role user there may be nobody above them to
even notice.

The replacement is the standard email-based reset, built to keep the property the "no reset"
stance was actually protecting: the form must not reveal who has an account at a named
childcare centre.

## Key Points

- **The reset form has one outcome.** "If that address has an account here, a reset link is on
  its way" — for known addresses, unknown addresses, and send failures alike. Same reasoning as
  the single login error string. A real send failure is still `report()`ed to observability.
- **Recovery links land on `/auth/confirm` (a route handler, not a page)** because turning the
  link into a session writes auth cookies, and a Server Component render cannot.
- **With the default Supabase email template, the link only works in the browser that
  requested it** — the PKCE verifier lives in a cookie set at request time. Opened elsewhere it
  fails safe, back to `/forgot-password?expired=1`. The route also accepts
  `?token_hash=…&type=recovery` so a customised template (`{{ .TokenHash }}`) works
  cross-browser if that trade is ever wanted.
- **A link from `admin.generateLink` cannot sign anybody into this app**, and that is not a
  property of this feature but of the existing onboarding script. Measured, not reasoned —
  see "Two redirect shapes" below.
- **The flow is drilled end to end against live Postgres and real JWTs**, on a disposable
  account: link → session → short password refused → mismatch refused → new password set → new
  password signs in, old one does not, link cannot be replayed.
- **Changing a password while signed in (`/account`) requires the current password**, verified
  on a throwaway anon client. A session is not proof of knowing the password — an unlocked
  laptop in a staff room is the ordinary case.
- **Both flows revoke every other session** (`signOut({ scope: 'others' })`) after the change.
- **One password rule, one place**: `apps/web/src/lib/password.ts`, shared by invitation
  acceptance, change and reset. Ten characters minimum, no composition rules.
- **Whether reset emails actually deliver is unverified** — see [[unverified-claims]]. The
  project has no custom SMTP; Supabase's built-in mailer is rate-limited to a handful of
  messages an hour.

## Details

### Two redirect shapes, and why one of them is a dead end

GoTrue's `/verify` endpoint hands the session back in one of two ways, and which one you get
depends on whether a PKCE challenge was registered when the token was issued. This was measured
on 2026-08-05 by generating a link and fetching it with redirects disabled, not inferred:

| Issued by | `/verify` responds | Readable by a route handler? |
|---|---|---|
| `resetPasswordForEmail` from the app | `303` to `…/auth/confirm?code=…` | **Yes** — query string |
| `admin.auth.admin.generateLink` | `303` to `…#access_token=…&refresh_token=…` | **No** — a fragment is never sent to the server |

The app's own path is the first one, verified from the installed source rather than the docs:
`@supabase/ssr`'s `createServerClient` sets `flowType: "pkce"`, and `resetPasswordForEmail`
posts `code_challenge`/`code_challenge_method` when the flow type is `pkce`. So the emailed link
carries a code and `/auth/confirm` exchanges it.

The second row is a **pre-existing defect in `scripts/onboard.ts`**, surfaced by this work and
not caused by it. That script prints the `action_link` from `generateLink` and tells a new owner
to open it. The tokens arrive in the fragment, and nothing in the web app reads a fragment —
`browserDb()` in `apps/web/src/lib/supabase.ts` is exported and **called from nowhere**, so
`detectSessionInUrl` never runs. The link therefore lands on `site_url` and leaves the person
signed out, with no error to act on. The fix is available and cheap now that `/auth/confirm`
exists: print `{origin}/auth/confirm?token_hash={properties.hashed_token}&type=recovery` instead
of `action_link`, which is the branch that needs no verifier and works in any browser. **Not yet
applied** — it changes how a tenant is onboarded and deserves its own commit.

A third thing fell out of the same measurement, confirming what `deploy-auth-config.ts` already
says: a `redirectTo` that is not on `uri_allow_list` is **silently** replaced with `site_url`.
A link generated with `redirectTo` of `http://localhost:3100/...` came back pointing at the
production origin. No error, no warning. Only ports 3000 and the production origin are on the
list.

### The handoff's master prompt asks for this feature to be deleted

The design pack that arrived on 2026-08-05 does not merely omit password reset — its master
prompt forbids it, under "do not soften the safety decisions", and its route list omits every
route this feature added. That instruction was refused rather than followed, and the reasoning is
recorded in [[design-system]] so that the next reader finds it from either direction. The short
version: the constraint protects a real property (no staff enumeration), which is preserved by
the uniform response, but the recovery path it points at has never worked.

### Rejected: no reset at all (the original design stance)

The design rationale said the cost of the single login error string was "one confused password
reset" — but the login screen spec simultaneously said there was no reset. The stance survived
as long as it did because nobody had traced what re-invitation actually does to an existing
account. Once traced, "no reset" turned out to mean "no recovery", which for a product whose
accounts guard children's records is a lockout mechanism, not a safety property. The safety
property worth keeping — no account enumeration — is carried by the uniform response instead.

### Rejected: letting a re-invitation set a new password

It would make the reset flow unnecessary, but an invitation link is created by a manager and
travels through whatever channel they choose; an email sent by the auth provider to the
account's own mailbox is a strictly better proof of control. The takeover refusal in the invite
flow stays.

### Rejected: `updateUser` without the current password on /account

Supabase allows it (the session is authority enough for GoTrue), and it is one field fewer.
But it converts "walked past an unlocked screen" into "owns the account".

### The /account page is not /settings

`/settings` is the centre's page, gated on `manageCentre`. `/account` is the user's own and
every role gets it — a parent's password guards their child's records exactly as much as a
manager's does. `/reset-password` sits outside `(app)` for the same reason `/invite` does: a
recovery session is authenticated but should not have to pass centre-membership checks to set
a password.

## See Also

- [[invitations]] — how accounts come to exist, and the takeover refusal this page leans on
- [[mobile-app]] — why none of this lives in the mobile app
- [[unverified-claims]] — email delivery is on it

*Last updated: 2026-08-05*
