-- ---------------------------------------------------------------------------
-- 0072 — the EXECUTE grant 0068 left at its default
--
-- The same mistake as 0030, caught by the same check, and fixed the same way.
-- `review:security` check 6 went from clean to HIGH the moment 0068 applied:
-- `checklist_run_guard` is SECURITY DEFINER and, like every function, was created
-- with EXECUTE granted to PUBLIC — which makes a function running as the table owner
-- callable by `anon`.
--
-- The severity is genuinely low in its current form. Called directly it receives no
-- trigger context and fails on the first reference to `new`, and it writes nothing.
-- It is fixed anyway, for the reason 0031 already gave: "it is harmless in its current
-- form" is exactly the argument that stops being true after the next edit.
--
-- **A trigger function does not need EXECUTE granted to the caller.** PostgreSQL
-- checks TRIGGER on the table, not EXECUTE on the function, when firing one. So
-- revoking from PUBLIC outright costs nothing and the trigger keeps working — which
-- the checklist assertions in `rls_isolation.sql` prove, since they drive all three of
-- its refusals plus the success path as three different callers.
--
-- WORTH RECORDING THAT THIS HAPPENED TWICE
--
-- 0031's header ends: "Found by a check rather than by review: 0030 was read twice
-- before it was applied and this was in neither reading, because the grant is not
-- written down anywhere in the file. It is what `create function` does when you say
-- nothing."
--
-- That was written eleven days ago and it did not stop the identical omission in 0068,
-- because a lesson in a migration header is only read by somebody already reading that
-- migration. What actually caught it both times is the check, which is the argument for
-- keeping checks blunt and running them before committing rather than after.
-- ---------------------------------------------------------------------------

revoke execute on function public.checklist_run_guard() from public;

comment on function public.checklist_run_guard() is
  'Trigger only. Three refusals a CHECK cannot express: the denormalised centre must match the template''s, the version must be published, and completing requires an answer to every required item. EXECUTE revoked from PUBLIC — a definer function reachable by anon is a hole waiting for an edit, and a trigger needs TRIGGER on the table rather than EXECUTE on the function.';
