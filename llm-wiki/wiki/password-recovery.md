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
- **`generateLink`'s `action_link` cannot sign anybody into this app** — the tokens come back in a
  fragment and no fragment reaches a server. Measured, not reasoned. **UPDATED 2026-08-11:
  `scripts/onboard.ts` no longer prints it.** It builds the `token_hash` form against
  `/auth/confirm` instead, which is the fix this page recorded as pending; see "Two redirect
  shapes" below.
- **Recovery was broken end to end on Railway, and had been since the first deploy.**
  `/auth/confirm` built its redirects from `request.url`, and Railway addresses the container
  internally, so `url.origin` is `https://localhost:8080` — the person was redirected to their own
  machine. It survived because nobody had completed a reset in production until the centre's own
  manager needed one. Fixed with `publicAppBase()`; see [[deployment]].
- **The flow is drilled end to end against live Postgres and real JWTs**, on a disposable
  account: link → session → short password refused → mismatch refused → new password set → new
  password signs in, old one does not, link cannot be replayed.
- **Changing a password while signed in (`/account`) requires the current password**, verified
  on a throwaway anon client. A session is not proof of knowing the password — an unlocked
  laptop in a staff room is the ordinary case.
- **Both flows revoke every other session** (`signOut({ scope: 'others' })`) after the change.

> **CORRECTED 2026-08-07 — the current-password check was bypassable by typing a URL.**
>
> This page records rejecting `updateUser` without the current password on `/account`, because it
> "converts walking past an unlocked screen into owning the account". `/reset-password` did exactly
> that: it checked only that `auth.user` existed and called `updateUser({ password })`, which GoTrue
> accepts on session authority alone. Anyone at an unlocked, signed-in browser could set a new
> password without knowing the old one — and the `signOut({ scope: 'others' })` above then locked the
> real holder out of every other device, with no email configured to tell them.
>
> The comment in the action described a protection it did not have: "what stands in for it is the
> recovery link ... holding it proves holding the mailbox". Nothing checked that a link had been used.
>
> **The gate is a signed claim, not a cookie**, and that choice was measured rather than assumed. A
> short-lived cookie set by `/auth/confirm` would stop a script and not the actual threat: `httpOnly`
> stops JavaScript, not a person with devtools open on the machine they are already sitting at. So a
> throwaway user was created and the two tokens compared:
>
> | session from | `amr` |
> |---|---|
> | password sign-in | `[{ method: 'password' }]` |
> | recovery link | `[{ method: 'otp' }]` |
>
> and the two carry different `session_id`s, so a recovery link is a new session rather than a
> relabelling of the one already in the browser. `/reset-password` now requires a session **not**
> established with a password — an absence rather than a presence, so a mailbox-proving method GoTrue
> adds later is allowed, while an MFA session (`[password, totp]`) is correctly refused: holding a
> second factor is not knowing the current password. Enforced in the page and again in the action,
> because the action is the thing that changes the password.

### `/auth/confirm`'s same-origin check was defeated by one backslash

Also 2026-08-07. The `next` parameter was sanitised with
`next.startsWith('/') && !next.startsWith('//')`, which looks exhaustive:

```js
new URL('/\\evil.com', 'https://app.example.nz').href   // 'https://evil.com/'
```

A single leading slash passed the check — and the WHATWG parser treats a backslash as a slash for
special schemes, so `/\` is `//` and everything after it is a host. Measured, not deduced.

That is an open redirect on the domain a password-reset email points at, which is the ideal phishing
primitive: the link really is the centre's own app, and the page it lands on is not. Cookies are
same-origin so the session itself does not leak, but a convincing "your session has expired, sign in
again" form does not need it.

Fixed by stopping reasoning about the string and asking the parser instead: resolve the value against
this origin and compare `.origin`, carrying forward only `pathname + search`. Robust against
backslashes, encodings, leading whitespace, `javascript:` and the next trick nobody has thought of,
because it is the same function the browser will use. In `lib/nextPath.ts` with tests, mutation-tested
against the old check.

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
of `action_link`, which is the branch that needs no verifier and works in any browser.

> **APPLIED 2026-08-11, and it took a real person to force it.** This paragraph said "Not yet
> applied — it changes how a tenant is onboarded and deserves its own commit", and it kept that
> status until `taner@littlepearls.org.nz` was attached as manager to both Little Pearls centres and
> the script printed exactly the dead link described above. The working one had to be hand-built
> before he could get in, which is a reasonable definition of "cheap fix that is no longer optional".
>
> It did get its own commit, as this page asked. Two details the original note did not anticipate:
> the base URL has to be **given** (`--app-url` or `ECE_PUBLIC_URL`) because a script has no request
> to read a host from and the app is now served under a path on a hostname it does not own — and the
> `type` follows whichever branch issued the token, `invite` for a new account and `recovery` for an
> existing one, rather than always `recovery`.
>
> A third thing surfaced while checking the result: the script reported `[new account]` **twice** for
> the same person. Re-issuing an invite for a user who exists but has never confirmed *succeeds*, so
> that branch is taken again and returns the same user id. It read as two accounts having been
> created; a membership query showed one user id and two rows. The label is now
> `new or not yet confirmed`.

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

*Last updated: 2026-08-11*
