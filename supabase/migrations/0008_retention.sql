-- 0008 — retention and purging
--
-- A CORRECTION TO WHAT THIS REPO PREVIOUSLY SAID
--
-- The Phase 1 notes claimed the Privacy Act 2020 "gives a right to request"
-- deletion. It does not. The Act gives a right of **access** (IPP 6) and a right to
-- request **correction** (IPP 7). There is no general right to erasure in New
-- Zealand law — that is GDPR Article 17, and it does not apply here.
--
-- What the Act does impose is IPP 9: an agency must not keep personal information
-- for longer than is required for the purposes for which it may lawfully be used.
-- That is an obligation on the centre, discharged by following a retention
-- schedule — not an endpoint an individual triggers.
--
-- The design follows from that. The main mechanism is a scheduled sweep of records
-- whose retention has expired, and the ad-hoc purge is the exception, restricted
-- and recorded.
--
-- RETENTION PERIODS ARE A PARAMETER, NOT A CONSTANT
--
-- Funding-relevant records — enrolment and attendance — have to survive a Ministry
-- funding audit, and the working assumption here is seven years from the date a
-- child leaves. **That figure needs checking against the current ECE Funding
-- Handbook before this is used on real records**; it is stated as a default and a
-- parameter precisely so it can be corrected without a migration.
--
-- WHY PURGING IS POSSIBLE AT ALL, GIVEN AN APPEND-ONLY AUDIT LOG
--
-- Because of a decision made in 0005: `audit_events.detail` records column names
-- and never values. So the audit trail contains no personal information about a
-- child — only "somebody changed health_conditions on this date". A child's record
-- can therefore be destroyed while the evidence that it existed, and that it was
-- deleted, survives. Had the trigger logged `to_jsonb(NEW)` this migration would be
-- impossible without also destroying the audit trail.

/**
 * Archived children whose retention has run out.
 *
 * Only archived ones: a child still on the roll is not a retention question. The
 * clock runs from `archived_at`, which is the date they left.
 *
 * A function rather than a view so the period is a parameter — the number is a
 * policy decision that should live in one configurable place rather than being
 * compiled into a definition.
 */
create or replace function public.children_due_for_purge(p_retention_years integer default 7)
returns table (child_id uuid, centre_id uuid, archived_at timestamptz, years_since_leaving numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.centre_id,
    c.archived_at,
    round(extract(epoch from (now() - c.archived_at)) / 31557600.0, 1)
  from public.children c
  where c.archived_at is not null
    and c.archived_at < now() - make_interval(years => p_retention_years)
  order by c.archived_at
$$;

comment on function public.children_due_for_purge(integer) is
  'Archived children past their retention period. security invoker, so it only ever lists children the caller can already see.';

/**
 * Destroy one child's record.
 *
 * The most destructive operation in the product, so:
 *
 *  - **Owners only.** Not managers, and certainly not educators.
 *  - **Archived only.** A child currently on the roll cannot be purged. This is the
 *    guard against "delete this child" being used to remove an inconvenient record
 *    while they are still attending — which, after an incident, is the scenario
 *    worth designing against.
 *  - **A reason is required**, and it is recorded in the audit log before anything
 *    is deleted. `detail` here carries the reason and the child's age band, never a
 *    name: the audit row outlives the record and must not become a backdoor copy of
 *    what was just destroyed.
 *
 * Deletion cascades from `children` to enrolments, health conditions, medication
 * authorities, consent events, custody arrangements and guardian links. Consent is
 * append-only against edits and still deletable here, which is the right way round:
 * the point of append-only was that a consent decision cannot be quietly *changed*,
 * not that a departed family's file is kept forever.
 */
create or replace function public.purge_child(p_child uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centre    uuid;
  v_archived  timestamptz;
  v_under_two boolean;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required to purge a child record.';
  end if;

  select c.centre_id, c.archived_at, (c.date_of_birth > current_date - interval '2 years')
    into v_centre, v_archived, v_under_two
    from public.children c
   where c.id = p_child;

  if v_centre is null then
    raise exception 'No such child, or it has already been purged.';
  end if;

  -- security definer bypasses RLS, so authorisation is checked explicitly. Without
  -- this the function would let any authenticated caller purge any child anywhere.
  if not public.caller_has_role(v_centre, array['owner']::public.member_role[]) then
    raise exception 'Only an owner of this centre may purge a child record.';
  end if;

  if v_archived is null then
    raise exception 'This child is still enrolled. Archive the record first — purging a current child is not a retention action.';
  end if;

  -- Written before the delete, so a failure part-way leaves the intention recorded.
  insert into public.audit_events (centre_id, actor_id, action, entity, entity_id, detail)
  values (
    v_centre,
    auth.uid(),
    'purge',
    'children',
    p_child::text,
    jsonb_build_object(
      'reason', left(p_reason, 500),
      'archived_at', v_archived,
      'was_under_two', v_under_two
    )
  );

  delete from public.children where id = p_child;
end $$;

comment on function public.purge_child(uuid, text) is
  'Irreversibly destroys one archived child record and everything hanging off it. Owner only, reason required and audited.';

revoke execute on function public.purge_child(uuid, text) from public, anon;
grant  execute on function public.purge_child(uuid, text) to authenticated, service_role;

/**
 * Guardians with no children left.
 *
 * A guardian record survives the purge of the child that referenced it, because
 * `child_guardians` cascades and `guardians` does not. Left alone, the contact
 * details of a family who left seven years ago sit in the table indefinitely, which
 * is the exact thing IPP 9 is about.
 *
 * Separate from `purge_child` rather than folded into it: the same person is often
 * guardian to siblings, and deleting them alongside the first child purged would
 * strip the remaining sibling's record of a contact.
 */
create or replace function public.purge_orphaned_guardians(p_centre uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not public.caller_has_role(p_centre, array['owner']::public.member_role[]) then
    raise exception 'Only an owner of this centre may purge guardian records.';
  end if;

  with gone as (
    delete from public.guardians g
     where g.centre_id = p_centre
       -- Never a guardian who has an app account: that is a person with a login and
       -- possibly a membership, and removing them here would break their access
       -- rather than tidy up a contact card.
       and g.user_id is null
       and not exists (
         select 1 from public.child_guardians cg where cg.guardian_id = g.id
       )
    returning g.id
  )
  select count(*) into v_count from gone;

  if v_count > 0 then
    insert into public.audit_events (centre_id, actor_id, action, entity, detail)
    values (p_centre, auth.uid(), 'purge', 'guardians',
            jsonb_build_object('orphaned_removed', v_count));
  end if;

  return v_count;
end $$;

revoke execute on function public.purge_orphaned_guardians(uuid) from public, anon;
grant  execute on function public.purge_orphaned_guardians(uuid) to authenticated, service_role;
