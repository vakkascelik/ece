# The mobile app

For five phases it rendered the words "Not signed in." and offered nothing. Nobody who installed it
could use it.

## Overview

The Expo app was built alongside the web app from Phase 2 onwards and reached Phase 6 as a single
416-line component with no navigation, no assets, and — the part nobody had noticed written down —
**no way to authenticate**. `App.tsx:305` rendered a bare `<Text>Not signed in.</Text>`, and that was
the entire unauthenticated path. It worked on a development machine because a session already sat in
SecureStore, put there by a script.

That is the general lesson of this page more than any specific fix: the app typechecked, linted,
bundled through Metro in CI, and had components with careful accessibility labels. None of those
checks can tell you that the product has no front door.

## Key Points

- **One binary serves every centre.** The tenant is resolved after sign-in, never baked into the
  build — which is what forced pooled tenancy on the whole platform. See [[tenancy-and-rls]].
- **Mobile can only authenticate an already-provisioned user.** Sign-up and invitation acceptance
  are structurally impossible here; password reset lives on the web app (see
  [[password-recovery]]) and its recovery link opens in a browser.
- **Eleven defects were found in code that had never executed**, including a push registration that
  would have failed on every call.
- **A queued attendance event belongs to the person who made it**, because `recorded_by` is stamped
  at flush time. See [[offline-outbox]].
- **Sign-out refuses while the queue holds unsent work**, and names the count.
- Nothing has run on a device. See [[unverified-claims]].

## Details

### Why sign-up, password reset and invitations cannot live here

Three independent walls, and it is worth having them in one place because each one alone looks like
something that could be worked around:

1. **`disable_signup: true`** on the Supabase project, deliberately — an account is how somebody
   reaches children's records.
2. **Invitation acceptance needs the service-role key**, which bypasses every policy and must never
   enter a bundle that ships to a phone. It also needs `hashInviteToken`, which uses `node:crypto`,
   which Metro cannot bundle. See [[invitations]].
3. **A recovery link must land somewhere that can hold the resulting session and set the new
   password** — which since 2026-08-05 is the web app's `/auth/confirm` + `/reset-password`
   (see [[password-recovery]]), not a screen in this binary. Before that this wall read "there
   is no mailer, so a password-reset link has nowhere to go"; the reset flow now uses
   Supabase's built-in mailer, so the wall is the landing place, not the sending.

So the sign-in screen has exactly two fields and no third affordance, and there is a `no-access`
screen for the ordinary case of a real account with no membership yet. What replaces the missing
buttons is one honest sentence: access comes from a centre invitation, and since 2026-08-06 that
sentence also names where a forgotten password gets replaced — "the invitation, and setting a new
password if you have forgotten yours, both open in a browser". A dead end with a reason is a
person emailing their manager; a dead end without one is a support call.

The pack's own footnote for this screen ends "and no password reset — ask your centre to send a
new invitation", which is not repeated: a re-invitation cannot set a password for an address that
already has an account, so that sentence would send somebody down a path that does not work. Same
deviation as the web login screen — see [[design-system]] and [[password-recovery]].

**One error string for every sign-in failure** — `'Those details are not right.'` — carried over from
the web app with its reasoning intact: distinguishing an unknown address from a wrong password turns
the form into a way to enumerate who works at a named childcare centre. A network failure gets a
different message, because telling somebody with no signal that their details are wrong sends them
to reset a password that was correct.

### The shape, and why the providers sit where they do

```
App.tsx (36 lines)
  SafeAreaProvider          required by react-navigation, and was missing entirely
    SessionProvider         owns identity, the chosen centre, and two subscriptions
      RootNavigator         decides what is on screen, in one place
        StaffTabs           Roll · Posts · Messages · Settings
        WhanauTabs          Tamariki · Pānui · Messages · Settings
```

`SessionProvider` is **outside** the navigator because it holds the `onAuthStateChange` and
`AppState` subscriptions, and both must survive a tab change. Put either in a screen that unmounts
and a shared staffroom tablet keeps showing the previous educator's roll after they sign out —
silently, with no error to notice.

`RootNavigator` uses conditional rendering rather than a stack with guards. A guard that navigates on
a state change gives two sources of truth about which screen is showing, and the failure mode is a
signed-out user still looking at a roll.

The **roll is the first tab and the initial route for staff**, so a signed-in educator opens the app
onto the thing they came for. It happens forty times between 7.30 and 9.00 with a queue of parents
waiting, and every extra tap is multiplied by forty. Whānau land on their tamariki, for the same
reason in the other direction.

### The centre choice is a preference, never a grant

The same rule the web app applies to its `ece_centre` cookie, and it had to be reproduced rather than
invented: keep the current choice if a **live membership** still backs it; otherwise auto-select only
when there is exactly one; otherwise ask. Guessing between two sites is how a manager reads the wrong
room's ratio.

It now persists in SecureStore — it did not, so a two-site manager re-picked it on every cold start,
including the one at 7.25am. SecureStore rather than AsyncStorage not because a centre id is secret,
but because the session already lives there and two halves of "who is looking at what" in two stores
is two things that can disagree after a restore.

### Eleven defects in code that had never run

The full list is in the commit; three are worth keeping here because each represents a class.

**Push registration would have failed on every call.** The `push_tokens` upsert omitted `user_id`,
which is `not null` with no default and carries `with check (user_id = auth.uid())`. Fixed even
though nothing calls it in this build — a latent bug in a dormant path surfaces the day somebody
enables it, by which time the reasoning is gone. The prompt itself is deliberately not requested:
there is no worker reading the `notifications` queue, so a granted permission would deliver nothing
and teach families to ignore the app.

**The foreground listener never reloaded the roll.** It closed over `activeCentre` while that was
still `null`, inside an effect whose deps were `[loadIdentity]` with `exhaustive-deps` disabled — so
the effect never re-ran and the closure never updated. Returning to the app flushed the outbox and
refreshed the pending badge, which **looked** like it was working, and never re-read the roll, which
is the one thing it existed for. Fixed with a ref, and the eslint-disable is gone, which is the
machine-checkable proof it cannot recur.

**`ChildCard`'s consent props were dead.** It was passed `consents={[]}` and
`showConsentGaps={false}`, so a feature with tests behind it rendered nothing. Now real on the whānau
screens — and still empty on the roll, because an educator at the door cannot fix a missing consent
and that list has to stay scannable.

### The whānau surface

A parent gets their own children, one child's record, the pānui feed, and messages. `listChildren` is
the same call the roll makes: it returns one child on a parent's phone and thirty on a staff tablet,
because the policy keys on guardianship as well as centre. If that screen ever shows a child who is
not theirs, the bug is in a policy and not in the screen.

**Consents are recordable**, because `recordConsent` includes `parent` in the capability matrix, and a
parent tapping "yes" to an excursion on their phone is the most obviously useful thing this app does
for a family. `CONSENT_DETAIL` wording is used verbatim — "in the private journal your whānau reads"
and "on our website and social media" are different questions and families answer them differently,
so paraphrasing for a small screen would change what was asked. Two labelled buttons, never a switch:
a mis-tap on a toggle silently records the opposite of a decision about photographs of a child.

**Four states rendered, not two, since 2026-08-29** — given, declined, *asked and waiting*, and
never asked. The middle one arrived with `consent_requests` (0073). Before it this screen printed
"Not asked yet" for anything unanswered, which the moment the centre could record an ask became a
false statement to a family about their own child; [[asking-for-consent]] has the reasoning.
`consentProgress` in core keeps the two apart and both apps read it, which is what stops the phone
and the console disagreeing about whether a family was ever asked.

**No custody section anywhere on mobile.** `viewCustody` excludes parents, and an empty heading would
tell a parent that a court order exists. See [[consent-gated-media]] for the same reasoning applied
to photographs.

### Messages are online-only, for a hard reason

Not a preference. `sendMessage` inserts with **no `client_uuid`**, so there is no idempotency key —
the thing that makes the outbox safe. A queued message retried after a lost response would double-post
to a family.

So on failure the text stays in the composer and **nothing is appended to the transcript**. No greyed
"failed" bubble: `messages` is append-only in Postgres, and a transcript showing something the record
does not contain is a lie about the record — on the screen a parent would scroll back through to
prove they told the centre about an allergy.

Send stays enabled while offline, because attempting is the connectivity check. That is the same
doctrine the outbox uses, and a disabled button teaches people to give up.

### What has never run

**Corrected 2026-08-29.** This said "everything on a device", and that stopped being true on
18 August, when versionCode 4 was installed on an Android phone and booted, signed in, resolved
the tenant and rendered the roll. Module load, auth, tenant resolution and the ratio bar are
executed code. The page was edited earlier the same day this correction was written and the
sentence survived, which is how a stale absolute gets quoted back as current.

What has still never run on a device is everything that needs a *loaded* roll — the phone that
ran it had no children enrolled. The airplane-mode drill, the screen-reader pass, the touch-target audit, the
sign-out refusal, and whether the Supabase session is even large enough to take the chunked
SecureStore path. `expo-sqlite` cannot execute in this repo's test runner, which is why the most
consequential offline logic was moved into `@ece/core` as pure functions — `classifyWriteFailure` and
`describeSignOut` — where it can be tested at all. Both turned out to be wrong when written, which is
the argument for the move.

## See Also

- [[offline-outbox]] — the queue, the three-way classification, and the attribution finding
- [[tenancy-and-rls]] — why one binary must serve every centre
- [[invitations]] — why account creation cannot happen here
- [[unverified-claims]] — the device drills, and the store-submission blockers

*Last updated: 2026-08-29*
