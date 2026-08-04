-- ---------------------------------------------------------------------------
-- 0020 — make a centre removable, which it was not.
--
-- FOUND BY THE PHASE 6 AUDIT FIXTURE, NOT BY REASONING
--
-- The end-to-end audit creates a throwaway centre and drops it afterwards. The drop
-- failed, and the error was worth the whole exercise:
--
--   insert or update on table "audit_events" violates foreign key constraint
--   "audit_events_centre_id_fkey"
--
-- An *insert* failure while deleting. The mechanism:
--
--   1. `delete from centres where id = …` removes the centre row.
--   2. Postgres cascades to `children`, then onward to health, attendance, consent.
--   3. Each of those tables carries `audit_trigger()`, which inserts an audit row
--      recording the deletion — with `centre_id` set to the centre from step 1.
--   4. That centre no longer exists, so the foreign key rejects the audit row, and
--      the whole transaction aborts.
--
-- So **no centre could be deleted by anybody, ever** — not by an owner, not by the
-- service role, not by hand in the SQL editor. Every attempt failed on a constraint
-- whose message mentions neither centres nor the trigger. Five phases of work had
-- shipped with no way to offboard a customer, and nothing in the type system, the
-- policies or the RLS suite could have surfaced it. It took trying to do it.
--
-- WHY THE FIX IS TO DROP THE FOREIGN KEY RATHER THAN PATCH THE TRIGGER
--
-- Three options were on the table:
--
--   (a) Teach the trigger to skip when its centre is being deleted. It cannot tell:
--       there is no way inside an AFTER DELETE trigger to know whether the delete
--       arrived by cascade from a parent that is already gone.
--   (b) Make the constraint deferrable. Deferring moves the check to commit, at
--       which point the centre is *still* deleted. It fails identically, later.
--   (c) Drop the constraint.
--
-- (c) is not a workaround; it is the correct model. `audit_events` is an append-only
-- ledger of things that happened, and **a ledger has to outlive its subject.** A
-- foreign key asserts the opposite — that no entry may describe anything that no
-- longer exists — and that assertion is what created the contradiction. It is also
-- the reason the append-only guarantee and the deletion path were in a standoff:
-- nobody may delete an audit row (no policy, no grant, not even `service_role`), so
-- there was no legal sequence of statements that could have unblocked the centre.
--
-- The column stays, the index stays, and the RLS policy still keys on it, so a
-- surviving row belongs to a centre that no longer exists and is therefore invisible
-- to every authenticated caller — which is the right visibility for it. And because
-- `detail` records column *names* and never values, the residue after a tenant is
-- removed contains no personal information about anybody: a date, an action, an
-- entity name, and the UUID of an actor whose account has also been deleted.
--
-- WHAT THIS DOES NOT ADD
--
-- No `purge_centre()` function, and no button. Deleting a tenant is a deliberate
-- operator action against the service role, documented in `docs/offboarding.md` as
-- archive → export → purge children → delete. A self-destruct control in the UI of a
-- product used by tired people at 5pm is a support incident with a countdown on it,
-- and the operation is rare enough that a runbook is the right interface.
-- ---------------------------------------------------------------------------

alter table public.audit_events
  drop constraint if exists audit_events_centre_id_fkey;

comment on column public.audit_events.centre_id is
  'The centre the change happened at. Deliberately NOT a foreign key: see 0020. The '
  'ledger outlives its subject, so a row may name a centre that has since been '
  'removed. RLS keys on this column, so such a row is invisible to every '
  'authenticated caller.';

-- Belt and braces on the append-only guarantee, restated here because 0020 is where
-- a future reader will come looking after wondering why the FK went.
--   • no update policy, no delete policy, for any role
--   • no update or delete grant, including to service_role
-- Both were established in 0003 and neither is relaxed here. Dropping the constraint
-- removes a *reference*, not a protection.
