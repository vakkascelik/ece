-- ---------------------------------------------------------------------------
-- 0031 — the EXECUTE grant 0030 left at its default
--
-- `scripts/review:security` check 6 dropped from clean to LOW the moment 0030
-- applied: `enforce_incident_transition` is SECURITY DEFINER and, like every
-- function, was created with EXECUTE granted to PUBLIC. That makes a function
-- running as the table owner callable by `anon`.
--
-- The severity is genuinely low — called directly it receives no trigger context
-- and fails immediately, and it writes nothing. It is fixed anyway, because the
-- argument "it is harmless in its current form" is exactly the argument that stops
-- being true after the next edit, and because 0022 already made this decision for
-- every boundary predicate in the schema.
--
-- The precedent copied here is `enforce_media_consent`, whose ACL is `postgres`
-- alone. **A trigger function does not need EXECUTE granted to the caller**:
-- PostgreSQL checks TRIGGER on the table, not EXECUTE on the function, when firing
-- one. So revoking it from PUBLIC outright costs nothing and the trigger keeps
-- working — which the incident assertions in `rls_isolation.sql` prove, since they
-- drive every branch of it as four different callers.
--
-- Found by a check rather than by review: 0030 was read twice before it was applied
-- and this was in neither reading, because the grant is not written down anywhere
-- in the file. It is what `create function` does when you say nothing.
-- ---------------------------------------------------------------------------

revoke execute on function public.enforce_incident_transition() from public;

comment on function public.enforce_incident_transition() is
  'Trigger only. EXECUTE revoked from PUBLIC: a definer function reachable by anon is a hole waiting for an edit, and a trigger needs TRIGGER on the table rather than EXECUTE on the function.';
