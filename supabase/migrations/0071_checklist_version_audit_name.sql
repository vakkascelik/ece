-- ---------------------------------------------------------------------------
-- 0071 — rename the checklist-version audit trigger to the name the guards look for
--
-- CORRECTION, and the guard worked. 0068 created the trigger on
-- `checklist_template_versions` as `checklist_versions_audit` — the table's short
-- name, which reads better and is wrong.
--
-- Both audit-coverage guards match on `tgname = relname || '_audit'`: the class
-- assertion in `rls_isolation.sql` and check 11 in `scripts/security-review.ts`. A
-- trigger under any other name is invisible to both, so the table would have been
-- reported as missing its trigger forever — which is what happened, on the first run —
-- and had the guards instead matched loosely, the table would have been reported as
-- covered while nothing checked that the name pattern held.
--
-- The convention is not cosmetic. It is the only thing that lets a catalogue query
-- answer "is every consequential table audited" without a hand-maintained list, and a
-- hand-maintained list is what let `shifts` and `staff_leave` go unaudited from 0041
-- to 0059.
--
-- The trigger itself was correct and firing. This changes its name and nothing else.
-- ---------------------------------------------------------------------------

drop trigger if exists checklist_versions_audit on public.checklist_template_versions;

drop trigger if exists checklist_template_versions_audit on public.checklist_template_versions;
create trigger checklist_template_versions_audit
  after insert or update or delete on public.checklist_template_versions
  for each row execute function public.audit_trigger();
