# Consent-gated media

A photograph of a child cannot exist in this system without a recorded consent decision, and
withdrawing that decision hides it again.

## Overview

Phase 1 built consent as append-only events and split photo consent into `photo_internal` (the
private journal their whānau reads) and `photo_public` (website, social media, print). Phase 4 is
where those decisions finally do work: `media.audience` decides which consent is required, and two
independent Postgres mechanisms enforce it.

The plan asked for media to be "consent-gated at upload — refused server-side, not hidden". That
is necessary and not sufficient, because consent can be withdrawn *after* the upload.

## Key Points

- **Two mechanisms, not one.** A trigger refuses the attachment; a **restrictive** policy re-checks
  on every read.
- **The read check applies to staff too.** A photo a family has withdrawn consent for is not one an
  educator should be browsing either.
- **The gate reaches storage.** Withdrawing consent stops a signed URL being *issuable*, not merely
  the row being visible.
- **One child without consent hides the whole item.** Correct, not harsh.
- **Consent is never checked in application code.** One rule, one implementation.
- **Photographs are fine once a family has agreed** — this page is the enforcement, not a ban.
  How the question actually gets put to them is [[asking-for-consent]], added 2026-08-29,
  because until then nothing in the product ever asked.
- The bug that made this a restrictive policy is worth reading below: it hid correctly from whānau
  and not at all from staff, which is exactly why it survived a first review.

## Details

### Why both mechanisms are needed

| Alone | Fails how |
|---|---|
| Trigger only | A parent withdraws consent and last month's photos stay visible. The withdrawal did nothing |
| Policy only | The upload succeeds, the file lands in storage, the post shows a silent gap. Nobody is told why |

So: the trigger refuses with a message that names the child and says what to do, and the policy
makes withdrawal take effect immediately and retroactively with no cleanup job and no cache to
invalidate.

### The bug: `FOR ALL` covers SELECT, and permissive policies are OR-ed

The first version put the consent check inside the permissive `media_select`:

```sql
using ( (staff or guardian or panui) and media_consent_satisfied(id) )
```

and separately declared `media_write` as `FOR ALL`. Two facts about Postgres RLS combine badly:

1. `FOR ALL` covers SELECT as well as the write verbs.
2. Multiple *permissive* policies are OR-ed together.

So `media_write`'s `USING (centre_id in staff centres)` was a second, independent grant of SELECT
with no consent condition. Staff matched it, the `and` never had to be satisfied, and a photograph a
family had withdrawn consent for stayed on screen for every educator in the building.

**The parent was hidden correctly**, which is what made it survive review — the retroactive half
looked like it worked, because for the caller most likely to be tested it did.

The fix in `0015` splits the write policy *and* moves consent to a **restrictive** policy, which is
AND-ed with all of them and cannot be routed around by adding another. Splitting alone would have
worked today and broken the next time somebody added a permissive policy.

**General rule for this schema:** a condition that must hold for *every* reader belongs in a
restrictive policy. A condition about *which* readers belongs in a permissive one.

Every other `FOR ALL` policy was re-read afterwards. They are all narrower than or equal to their
matching select policy, so OR-ing them adds no visibility — `media` was the only case where the
select policy was *narrower*, which is precisely the shape that produces this.

### A null signed URL is a malfunction, not a withdrawn consent

Recorded on 2026-08-06 because a wrong comment nearly caused a real regression, and the same
mistake is available to anybody reading this code.

`signMediaUrl` returns `null` when a URL cannot be issued, and its comment claimed the usual
cause was "the caller may no longer read it, which is the gate working". **That cannot happen.**
The gate is a restrictive policy on `public.media` **SELECT**, so a caller who may no longer
read a photo never receives its row, never has a `storagePath`, and never calls the signer. The
suite asserts exactly this with `count(*) = 0` — "withdrawing consent hides existing media from
STAFF, not only from whānau".

So `url === null` means storage is unreachable, the path is wrong, or a clock is skewed. It is a
fault, and both feeds are right to say so.

The consequence of believing otherwise: the design pack requires that a withdrawn photo render
**nothing** — no placeholder, no notice, nothing announced, because a notice explaining an
absence discloses the family's decision. Reading the wrong comment made the mobile feed's
"could not be loaded" chip look like exactly that disclosure, and it was deleted on those
grounds before the policy was checked. That would have silenced a genuine failure and bought no
privacy at all, because the case being protected never reaches a client.

**The pack's requirement is already satisfied, one layer lower than the pack imagines.** It asks
for a rendering rule; this schema makes the data absent. That is strictly stronger, and it is
the general shape to prefer: a privacy rule enforced by a policy cannot be forgotten by a
component.

### The restrictive policy is SELECT-only, deliberately

Staff must be able to **delete** media whose consent has been withdrawn — which is exactly media
they can no longer read. Scoping the restriction to SELECT is what makes that possible. Asserted
directly: "staff CAN still delete media they can no longer read".

### Two functions, and why the narrow one is the granted one

| Function | Security | Granted to |
|---|---|---|
| `has_consent(child, kind)` | invoker | authenticated — fails closed for a caller who cannot see the child |
| `child_consent_for_audience(child, audience)` | definer | **nobody** |
| `media_consent_satisfied(media_id)` | definer | authenticated |

The gate has to answer "does this child have consent" while a policy is being evaluated, regardless
of who is asking — so it needs a definer function. But making *that* callable would hand anybody an
oracle for "does child X have photo consent". So the granted surface takes a **media id**: a caller
can only ask about media, and asking about an id they do not have is a very weak oracle. Asserted
that the child-level function is not callable.

### The gate reaches storage

`0014` creates a **private** bucket. A public bucket serves any object to anybody holding the URL,
and for photographs of children that is a disclosure rather than a setting — the path appears in
logs, screenshots and forwarded links.

Reads go through short-lived signed URLs, and the storage read policy defers to the `media` row via
`can_read_media_object`, which is `security invoker` so the restrictive policy does the deciding.
The consequence is the strongest form of the guarantee: **after a withdrawal, a signed URL cannot be
issued at all** — verified for both staff and the parent.

Objects are `<centre_id>/<uuid>.<ext>`. The first segment is the tenant, which lets the write policy
say "your centre only" without a join. The filename is a UUID and never the original, because an
original filename can carry a child's name and a storage path is visible in more places than a
database column.

### Orphans, and why they are tolerated

A file must be uploaded *before* there is a media row to attach a child to, so the gate cannot fire
at upload — it fires on the next statement. An upload for a child without consent therefore leaves
an object behind.

`posts/actions.ts` deletes the file and the row when the gate refuses. `scripts/sweep-orphan-media.ts`
catches what it cannot: a tab closed mid-flow, a crash, a dropped connection. Report-only by
default, and it ignores anything under an hour old because that may be an upload in progress.

Orphans are unreachable rather than exposed — no media row means the storage read policy has nothing
to match. They are a storage bill and a pile of photographs nothing accounts for, which is reason
enough to clear them.

### Rejected: `next/image` for media

It proxies through the Next image optimiser, which **caches** the upstream URL. Caching a photograph
behind a short-lived signed URL would outlive both the signature and the consent that permitted it —
the image would keep being served from the optimiser's cache after a family withdrew consent, which
is what every other layer is arranged to prevent. A plain `img` tag with a signed URL is correct
here.

### Rejected: a separate consent for video

Video is gated by the same consent as photographs. The `photo_internal` wording says "Photos of your
child", which most services read as covering moving images — but that is a reading, not a certainty.
A centre wanting a separate video consent needs a new `consent_kind`, not a looser gate.

### Untagged media would bypass the gate entirely

No children means nothing to check, so the upload form requires naming who is in it. That is not a
tagging nicety: it is the list the gate checks.

## See Also

- [[asking-for-consent]] — how a decision gets collected in the first place
- [[compliance-and-evidence]] — the other place consent decisions are read
- [[tenancy-and-rls]] — the guardianship predicates this builds on
- [[unverified-claims]] — push delivery, which is built and has never run
- [[privacy-and-retention]]

*Last updated: 2026-08-29*
