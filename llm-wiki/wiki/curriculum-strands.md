# Te Whāriki strands

*Tier 4 of the roadmap, lowest priority by its own ranking — and the two bugs it caught
along the way are worth more than the feature itself.*

Migration `0058`. Code: `packages/api/src/engagement.ts`, `apps/web/src/app/(app)/posts/Compose.tsx`,
`apps/web/src/app/(app)/compliance/binder/`.

---

## What this deliberately does not build

`docs/roadmap-phases-8-13.md` scopes Tier 4 with a flat refusal first: *"Do not build a
portfolio product."* Storypark and every incumbent in this market already holds years of a
centre's learning stories, and building an inferior competitor against data this product
does not have is a losing fight. What is cheap and genuinely this product's ground is
compliance: tag a post to a strand, and let the evidence binder count what has been tagged.

No goals, no learning outcomes, no per-strand curriculum text of any kind — there is not
even a column for it. Transcribing that level of detail from memory would be asserting
curriculum content this repo has not checked, in a compliance product whose whole premise is
that an unchecked figure gets said out loud rather than presented as fact.

## Why the five strand names are seeded, when `criteria` refuses to be

`criteria` (0012) ships genuinely empty, loaded only from a file a human has checked,
because Ministry licensing criteria are renumbered periodically and this repo has already
been burned once by a stale numbering. Te Whāriki's five strand names are a different kind
of fact — the stable top-level structure of a national curriculum document, not something
that drifts the way a renumbered criterion does. So 0058 seeds them directly, `source`
column and all, the same shape `criteria_sets.source` carries.

That is not the same as calling them verified. [[unverified-claims]] item 33 records the
honest state: the five names are common, consistently repeated knowledge in this field, not
a transcription checked character-by-character against a primary-source copy of *He Whāriki
Mātauranga mō ngā Mokopuna o Aotearoa*. Worth saying plainly rather than skating past it —
this repo has already paid once for exactly this class of mistake, a macron in the wrong
place (`Māori` rendered `Maōri` by a font nobody had looked at rendered), and a wrong macron
sitting quietly in a column labelled "source: Te Whāriki, 2017" is a worse version of the
same failure, because a compliance document is more likely to be checked than a heading font.

## Reference data, one grant to `SELECT`

`curriculum_strands` has no path for the app to insert a sixth strand or rename one —
`revoke all … grant select` only, the same shape `criteria` uses. Five rows, forever, by
construction rather than by convention. That fact is what let `listCurriculumStrands` stay
unpaged rather than routed through `fetchAll` — see the `bounded-queries.test.ts` note below.

## `post_strands` delegates visibility to `posts`, rather than re-deriving it

A Postgres policy's `USING` clause may reference another table, and that reference is itself
subject to the referenced table's own RLS for the calling session. So `post_strands_select`
is simply `post_id in (select id from public.posts)` — whatever this caller could already
see through `posts_select`'s guardianship, staff and pānui branches, they can see the
strand tags on. Restating that logic here would be a second copy with its own chance to
drift from the first.

## Two real defects, both caught before either was ever committed

**A `FOR ALL` policy that reintroduced the shape 0022 already removed once.** The first
draft of `post_strands_write` was a single `FOR ALL` policy, copied from reading 0013's
*original* text for `post_children_write` rather than its current, live shape.
`review:security` check 5 caught it immediately: `FOR ALL` covers `SELECT`, so a table
carrying both a `FOR SELECT` policy and a `FOR ALL` policy has two permissive read paths
that OR together — the exact shape that produced the Phase 4 consent leak this check exists
to catch. 0022 had already split `post_children_write` into separate INSERT and DELETE
policies for this reason; `post_strands` follows that split rather than reintroducing what
0022 removed. Neither migration nor RLS suite had been committed yet, so the fix went into
0058 itself rather than a visible follow-up migration.

**A PL/pgSQL trap the RLS suite's own convention walked straight into.** Every append-only
and permission-refusal assertion in this file captures a result in a variable named `code`.
`curriculum_strands` has a real column also named `code`. `where code = 'wellbeing'` inside
a block that has `declare code text` is genuinely ambiguous to PL/pgSQL, which raises
`42702` rather than guessing — caught only because the assertion checked for `42501`
specifically and got a different, unexpected sqlstate back. Fixed by qualifying the column
(`curriculum_strands.code`) rather than renaming the file's usual variable, which stays
consistent with several thousand other lines.

## `listStrandCoverage` counts published posts only

A draft is not evidence that curriculum work happened, the same reasoning
[[reporting]]'s occupancy report applies to closed days: counting it would report something
that has not actually reached anybody. Verified end to end against the real database —
tagging a draft leaves coverage unchanged, and publishing it makes the count appear
immediately, with no separate step.

9 new RLS assertions, 447/447 overall. 16/16 security review after the policy split.

## Related

[[reporting]] · [[compliance-and-evidence]] · [[unverified-claims]] · [[consent-gated-media]]

*Last updated: 2026-08-10*
