# Post comments

## Overview

Whānau and kaiako replying to a post. Migration 0076, plus 0077 for a grant it should have
carried. Built 2026-08-30 from the Educa screenshots, as the first half of Phase 10b in
[replacing Educa](../../docs/doorway-without-infocare.md).

The gap was total: a grep across every migration for "comment" returned nothing but
`comment on table` DDL. Meanwhile Educa reports on comments in **three of its ten reports** —
Usage Overview counts "stories vs. comments", plus a Parent Engagement Graph and a Stories and
Comments report. It is the entity that incumbent measures its own value by, and this schema
had no row for it.

## Key Points

- **Visibility is delegated to `posts`, not restated.** `post_comments_select` says
  `post_id in (select id from public.posts)` and contains no guardianship logic of its own.
- **Moderation is three states**, defaulting to approve-first, and *auto-approved* is
  deliberately distinguishable from *approved by a person*.
- **Append-only.** No UPDATE on `body`, no DELETE for anybody including `service_role`.
- **Nobody's name appears on anybody else's comment.** A deliberate omission, and a real gap
  against Educa. See below.
- `/messages` (0016) already was Educa's *Conversations* and was not rebuilt.

## Details

### The delegated subquery is the whole design

The tempting shape for `post_comments_select` is its own audience clause: staff at the
centre, or a guardian of a child named on the post, or anyone at the centre for a pānui.
That is `posts_select` (0013) copied, and a copy of a guardianship rule is what this repo has
been bitten by before.

[[curriculum-strands]] established the alternative in 0058 and its header explains the
mechanism: a policy's USING clause may reference another table, and that reference is itself
subject to the referenced table's RLS for the calling session. So

```sql
post_id in (select id from public.posts)
```

already means *posts this caller may read*, with the staff, guardianship and pānui branches
evaluated once, in the place that owns them. **0076 adds no branch to post visibility and
changes no existing policy.**

The assertion that proves it is worth naming, because everything else is bookkeeping: Priya
and Quinn are both parents at centre A with different children. Priya comments on a learning
moment about her own child; Quinn reads the comment table and gets nothing. Nothing in
`post_comments_select` mentions guardianship, so if that subquery were ever evaluated with
policies off, this is the row that notices.

### Three states, and why `moderated_by` is a separate column

Educa's default is "Approved Comments Only", with "Auto Approve" and "Disable" beside it,
chosen per post. The default is copied because it is right for a service publishing about
other people's children: a comment naming a second child should not appear under a learning
moment before anybody has read it.

A comment is pending, approved or declined. `moderated_by` is **not** derivable from
`approved_at`:

| State | `approved_at` | `declined_at` | `moderated_by` |
|---|---|---|---|
| Waiting for a kaiako | null | null | null |
| A kaiako approved it | set | null | **set** |
| Auto-approved by the post's mode | set | null | **null** |
| Declined | null | set | set |

An auto-approved comment has nobody's name against it because nobody read it, and that is a
true and useful fact. Folding the two together — stamping the author, or the post's author,
as approver — would put a person's name against a decision they never made, in a table a
family can ask to see under IPP 6.

Both halves are forced by triggers rather than trusted to the client. `enforce_comment_mode`
discards whatever `approved_at` the caller sent, because a client that could set it would be
approving its own comment; `stamp_comment_moderator` fills `moderated_by` from `auth.uid()`,
because a client that could set *that* could erase the distinction above. The RLS suite
approves a comment with an UPDATE that never mentions `moderated_by` and asserts it comes out
stamped.

### Append-only, which is a deliberate difference from the incumbent

No UPDATE on `body` — the grant is `update (approved_at, declined_at, moderated_by)` and
nothing else, so a kaiako cannot rewrite a parent's words while leaving her name on them.
Postgres tests the table privilege before the policy, so it refuses first and refuses loudly
(42501, asserted).

No DELETE policy and no DELETE grant, for anybody. Educa lets a comment be removed. What a
centre published to a family, and what a family said back, is a record of a relationship in
which the centre holds the power; the same reasoning already makes `messages` (0016)
append-only. A comment that must genuinely be destroyed — a mistaken disclosure about another
child — is a Privacy Act deletion handled by a person with the service role, not a button in
a feed.

A declined comment therefore stays, declined, visible to its author and to staff. The
alternative is a comment that vanishes without trace from the screen of the person who wrote
it.

### Why the draft check is in a trigger and not only in the policy

A parent cannot see a draft, so `post_comments_insert`'s delegated subquery already stops
them. **Staff can see drafts** — that is what the rail's draft badge is for — and for them
the policy allows the insert. The trigger is the only thing left, and it refuses: a comment
on a draft is a reply to something nobody has been shown. Both paths are asserted separately,
because they fail for different reasons and one of them would silently stop being tested if
the other were removed.

### The names, which are missing on purpose

Educa shows who wrote each comment. This does not, and the omission is a decision rather than
an unfinished edge.

A pānui at Little Pearls reaches **275 guardians** (counted off their own people picker).
Rendering each commenter's name to all the others publishes a slice of the family roster to
every family, and nothing else in this product shows one parent another parent's name —
[[parent-self-service]] is built the other way round throughout. It would also need a read a
parent does not have: `guardians` is centre-scoped and a parent sees their own.

So the reader sees "You" on their own comments and no attribution on anybody else's. That is
a real gap against the incumbent, it is the most likely first complaint, and **the decision
belongs to the centre**: showing names to staff only is a small change, showing them to
everyone is a privacy choice with a consent conversation attached.

### Pinning

`posts.pinned_at`, a timestamp rather than a boolean so that two pinned posts have an order
without a second column, and so "since when" is answerable. `listPosts` orders
`pinned_at desc nullsFirst: false` ahead of `created_at desc`.

No new policy: it is a column on `posts`, so `posts_write_update` (0028) already decides —
the author, an owner or a manager. An educator pinning a colleague's post is *filtered*
rather than refused, so it would report success and change nothing, which is why the button
is drawn only for `canSteward`. The suite asserts an owner can pin and a parent cannot unpin.

### What 0077 was for

`review:security` failed HIGH on 0076's first run: `enforce_comment_mode` and
`stamp_comment_moderator` are SECURITY DEFINER, and Postgres grants EXECUTE on a new function
to PUBLIC by default — which includes `anon`. 0013 already revokes exactly this on
`child_consent_for_audience`; 0076 did not follow it.

The honest size of the exposure: both return `trigger`, and PostgreSQL refuses a direct call
to such a function outside a trigger context, so there is no known way to have called them.
It is still worth closing, because "probably unreachable" is an argument that must be
re-made every time somebody edits the body, and a revoke is an argument that does not. A
trigger function needs no EXECUTE grant to the caller who fires it — the trigger runs as the
table owner, which is why both triggers work with no grant at all.

0076 was already applied, so its checksum was bound. 0077 is a separate migration for that
reason and not for a tidier history.

## See Also

- [[consent-gated-media]] — the other half of a post, and the gate this one deliberately does not touch
- [[curriculum-strands]] — where the delegated-subquery policy was established
- [[parent-self-service]] — why a parent does not see another parent
- [[unverified-claims]] — item 44, the restore drill, found by the same session

*Last updated: 2026-08-30*
