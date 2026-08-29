# Emergency broadcast

*Phase 12's item, scoped down to the one channel that is actually real today.*

Migration `0056`–`0057`. Code: `packages/core/src/notifications.ts`,
`packages/api/src/notifications.ts`, `apps/web/src/app/(app)/broadcast/`,
`apps/web/src/app/(app)/notifications/`.

---

## What "broadcast" does not mean yet, said before anything else

`docs/roadmap-phases-8-13.md` scoped this as "a `notification_kind` and a fan-out. Build on
push and email first." This project has neither. Push has never been executed once, and
unverified-claims item 5 has said so since before this feature existed. **The reason has changed
and this line said otherwise until 2026-08-29:** it read "an EAS build and a real device are
needed", and both now exist — five AABs, one of them installed and run. What is missing is a
device that has been *asked* for a push token, and a worker: nothing reads the `notifications`
queue and calls Expo's API. There is no email-sending integration of any kind, only Supabase Auth's own
templates for password resets.

Building a real email vendor integration to make "broadcast" live up to the word would be its
own multi-day undertaking with its own privacy-statement change — the same shape of decision
the roadmap already made once about SMS ("a vendor, a cost, a phone-number column that is a new
PII surface") and deferred. So this ships the channel that is genuinely real: a row every member
can read on their own [[reporting|Notifications]] page, sent the instant an owner or manager
presses Send. `BroadcastForm.tsx`'s own copy says this plainly rather than letting the word
"broadcast" oversell what happens — *"today that means: an entry each of them can read on their
own Notifications page. It does not yet send a push notification or an email."*

---

## `notifications` had a writer for nobody and a reader for nothing

0017 built `push_tokens`, `notification_preferences`, and the `notifications` queue itself, with
quiet-hours arithmetic tested to 17 assertions — and then nothing in either app ever inserted a
row, and no page in `apps/web` ever read one. `grep` for `.from('notifications')` outside 0017
itself returned nothing until this feature. `/notifications` is the first reader; the fan-out
inside `broadcast_emergency` is the first writer.

---

## Why a `SECURITY DEFINER` function rather than an `INSERT` policy

Sending one broadcast means writing into every active member's row — a fan-out across the whole
centre, which 0017's own comment had already named as *"a service-role action, like
onboarding"* when it declined to grant `authenticated` any `INSERT` on `notifications` at all.

`broadcast_emergency` is that action, the same shape `purge_child` uses: it bypasses every
policy below it, so its own explicit `caller_has_role(centre_id, ['owner','manager'])` check is
the only thing standing between a caller and every family's inbox at a centre that is not
theirs. Not granted to `anon` — this is not a public write path like the enrolment enquiry or
the careers form.

## Why a separate `emergency_broadcasts` table

`notifications_own` restricts a row to `user_id = auth.uid()` by design — 0017 argued a manager
has no reason to browse what an individual family was told, because the events that caused it
are readable through their own tables. An emergency broadcast is the one case that reasoning
does not cover: an owner needs to see **what** was sent, **who** sent it, and **to how many**,
as a single fact — not as forty individual delivery rows they have no policy to read.

`emergency_broadcasts` is that fact, and it is append-only for the same reason
`detail_confirmations` and `ai_requests` already are here: a sent broadcast is a record of what
a centre told its families, and an editable version of that record answers nothing a reviewer
could trust. Revoked from `service_role` too, not just `authenticated` — checked directly,
by trying to delete a manual test row and being refused, which is 0018's `waitlist` pattern
proving out again rather than a surprise.

## `wantsKind` has no branch for `emergency`, on purpose

Every other kind checks a boolean in `NotificationPreferences`. `emergency` has no field to
check: nobody can opt out of being told the building is being evacuated, so `wantsKind` returns
`true` unconditionally for it rather than reading a preference that does not exist. `send_after`
is set to `now()` in the same `INSERT … SELECT`, bypassing quiet hours entirely — an emergency
notification held until 7am is not an emergency notification.

## A bug the RLS suite caught while being written, not after

The first draft of the suite verified the fan-out by counting `notifications` rows as the
sending owner, immediately after calling `broadcast_emergency`. It failed — correctly.
`notifications_own` means an owner can read only **her own** row through ordinary RLS, exactly
like anyone else; the fan-out total is not a fact a normal authenticated session can see in one
query. The check needed `service_role` to bypass RLS the same way the definer function itself
does. Left in as the comment on that assertion, because it is the kind of mistake a next
person writing a similar check will make identically.

## Recipient count is computed, not memorised

The suite computes the expected recipient count from `memberships` at assertion time rather than
hard-coding a number, because the shared fixture accumulates state across a 5,800-line file —
by the point this block runs, an earlier parent-revocation test has already reduced centre A's
active membership from four to three. A hard-coded `4` would have been a plausible-looking
number that was simply wrong, and wrong in the direction nobody would have noticed without
re-reading four thousand lines to recount by hand.

14 new RLS assertions, 438/438 overall.

## What `/notifications` is not

No unread count, no bell icon, nothing telling a family this page has something new on it. A
person has to think to open it. That is a real gap, named rather than hidden — the same
transparency this repo already applies to the mobile-restart gap on [[offline-outbox]]. Closing
it properly is a push notification actually being delivered, which is unverified-claims item 5
and needs a device this repo does not have.

## Related

[[reporting]] · [[offline-outbox]] · [[unverified-claims]] · [[tenancy-and-rls]] ·
[[parent-self-service]]

*Last updated: 2026-08-29*
