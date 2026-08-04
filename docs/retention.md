# Retention

How long each kind of record is kept, why, and the honest state of the *why*.

## The obligation

Information Privacy Principle 9: personal information must not be kept for longer than
it is required for the purposes for which it may lawfully be used.

That is an obligation on the **centre**, discharged by following a schedule. It is not
something a family triggers — there is no right of erasure in New Zealand law. So the
mechanism has to be a review somebody does, not a request somebody makes.

## The schedule

| Record | Kept | Basis |
|---|---|---|
| Child record, enrolment, health, medication | **7 years after the enrolment ends** | Assumed to cover a Ministry funding audit. **Unverified** — see below |
| Attendance events | 7 years, with the child | Funding evidence; a claim must be defensible for as long as it can be audited |
| Consent decisions | 7 years, with the child | The record that consent existed is the defence if it is ever questioned |
| Whānau contact details | Removed when no child of theirs remains | Nothing needs a departed family's phone number |
| Custody arrangements | 7 years, with the child | Part of the child's record |
| Staff compliance records | 7 years after the person leaves | Licensing evidence outlives the employment |
| Messages | 7 years, with the child | Part of the record of the relationship with the family |
| Photos and videos | Deleted with the child record, or on request | See the note on media below |
| Audit log | Indefinitely | Holds no personal information — field names only. See below |
| Accounts (`auth.users`) | Removed when access ends | An account nobody uses is an unnecessary door |

### The seven-year figure is an assumption, not a citation

It comes from the belief that funding-relevant records must survive a Ministry funding
audit. **Nobody has checked it against a published requirement.** It is a function
parameter, not a constant, so correcting it does not need a migration:

```sql
select * from public.children_due_for_purge(7);   -- or whatever the real figure is
```

If the true figure is shorter, this product is keeping children's medical information
longer than the law allows, which is itself a breach of IPP 9. If it is longer, a centre
following this schedule destroys evidence it needed. **Both directions are harmful,
which is why this is item 3 on
[unverified-claims](../llm-wiki/wiki/unverified-claims.md) and not a footnote.**

## How a purge actually works

```sql
select * from public.children_due_for_purge(7);      -- what is due
select public.purge_child('<uuid>', 'reason, ten characters or more');
select public.purge_orphaned_guardians();            -- afterwards
```

Four guards, each of which is the only thing standing between a caller and a permanent
deletion:

1. **Owner only.** Not managers, not educators.
2. **Archived children only.** A child who still attends cannot be purged. That is not
   tidiness — it is the guard against "delete this child" being used to remove a record
   that has become inconvenient while they are still enrolled, which after an incident is
   the scenario worth designing against.
3. **A reason of at least ten characters**, written to the audit log **before** anything
   is deleted, so a failure part way through still leaves the intention recorded.
4. Guardians are purged **separately**, because the same person is usually guardian to
   siblings and removing them with the first child would strip the remaining sibling's
   record of a contact. A guardian who has a login is never touched, since that is a
   person with access rather than a contact card.

### Nothing runs on a timer

`children_due_for_purge()` lists what is due. Nothing calls it. Retention is currently
something a person has to remember, which is a real gap — but automating the
irreversible deletion of children's records without a human reading the list first is a
larger one. Closing it properly means a reminder, not a cron job.

## Why a purge is possible at all

Because `audit_events.detail` records the **names** of the columns that changed and
never their values. The audit trail therefore contains no personal information about any
child — only "somebody changed `health_conditions` on this date".

A child's record can be destroyed while the evidence that it existed, that it was
deliberately deleted, by whom, and why, survives. Had the trigger logged the row
contents, this would be impossible without also destroying the audit trail — and the two
obligations (delete when no longer needed; keep a record of what you did) would be in
direct conflict. Both halves are asserted in the RLS suite: that the purge is recorded,
and that no name or medical detail survives in the recording.

## Media

Photographs are the exception that needs stating. They are objects in private storage,
addressed by a path, and deleting the database row does not delete the file. That is what
`npm run sweep:media` is for, and it needs to run as part of any purge. A photo whose row
is gone is a photo nobody can find and nobody has deleted.

## What happens when a centre leaves

See [offboarding](offboarding.md). Short version: archive, export, purge every child,
then remove the tenant — and the tenant could not be removed at all until migration
0020, which is a defect the Phase 6 audit found by trying to do it.

---

*Last updated 2026-08-04.*
