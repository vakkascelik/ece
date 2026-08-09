-- ---------------------------------------------------------------------------
-- 0053 — the audit trigger 0052 should have carried
--
-- A separate migration because 0052 was already applied when the gap was found, and an
-- applied migration is a contract: `scripts/migrate.ts` stores a checksum, and editing the
-- file — even to add a comment — makes the runner refuse. That has been learned here once
-- already, on 0045, where the fix was to restore the file byte-for-byte and put the
-- correction in the next one. Same again.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE TABLE NEEDS IT, WHICH IS NOT OBVIOUS
--
-- `review:security` reported it, so the rule caught this rather than a person. But the
-- reasoning is worth stating because somebody will otherwise wonder whether an enquiry
-- table is consequential enough to audit.
--
-- It is, twice over. The row is a stranger's claim about a **named child**, and the office
-- both moves it through statuses and deletes it. *"Who declined this family, and when"* is
-- a question a centre can be asked months later. So is *"who removed the enquiry"* — and a
-- delete is the case that matters most, because afterwards the audit row is the only
-- evidence the enquiry ever existed. Exactly the property `audit_events` has for a purged
-- child record.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE INSERT WILL BE ATTRIBUTED TO NOBODY, AND THAT IS CORRECT
--
-- The writer is `anon`, through `submit_enrolment_application`, so there is no `auth.uid()`
-- and `actor_id` is null. That is the honest answer rather than a gap: the row records that
-- an enquiry arrived from the public form, and this product cannot name who sent it.
--
-- Worth knowing before somebody reads a null actor as a bug and "fixes" it by attributing
-- the row to the centre's owner, which would be a record saying the owner filed an
-- application about a child they have never met.
-- ---------------------------------------------------------------------------

drop trigger if exists enrolment_applications_audit on public.enrolment_applications;
create trigger enrolment_applications_audit
  after insert or update or delete on public.enrolment_applications
  for each row execute function public.audit_trigger();
