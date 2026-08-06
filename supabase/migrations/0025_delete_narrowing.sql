-- ---------------------------------------------------------------------------
-- 0025 — the narrowing condition that 0022 dropped on the DELETE side
--
-- 0022 split fourteen `FOR ALL` write policies into insert/update/delete, reading the
-- expressions back out of the catalogue and re-issuing them verbatim so a transcription
-- error was impossible. It did that correctly. What it could not see is that **a `FOR ALL`
-- policy is asymmetric to begin with**: PostgreSQL checks USING for DELETE and WITH CHECK
-- for INSERT, so any condition an author put only in WITH CHECK was never applied to
-- DELETE in the first place.
--
-- So this is not a regression 0022 introduced. It is a pre-existing asymmetry that 0022
-- made visible by writing it down as three separate policies — and one that the migration's
-- own comment, "a write policy declares the verbs it is for", invites this file to finish.
--
-- FOUND BY ASKING THE CATALOGUE, which is the only thing that could have found it:
--
--   select d.tablename, d.qual = i.with_check
--     from pg_policies d join pg_policies i
--       on i.tablename = d.tablename
--      and i.policyname = replace(d.policyname, '_delete', '_insert')
--    where d.cmd = 'DELETE' and d.policyname like '%\_write\_delete';
--
-- Ten split tables have a DELETE policy. Six match their INSERT check exactly. Four do not,
-- and they are not the same kind of difference:
--
-- | table         | what WITH CHECK adds                        | a hole on DELETE? |
-- |---------------|---------------------------------------------|-------------------|
-- | invoice_lines | `i.status = 'draft'`                        | **YES**           |
-- | posts         | `author_id is null or author_id = auth.uid()`| **YES**           |
-- | bookings      | the booking's centre = the child's centre    | no                |
-- | enrolments    | the enrolment's centre = the child's centre  | no                |
--
-- `bookings` and `enrolments` are left alone deliberately. Their extra condition is a
-- consistency rule about the row being written — it stops a two-site operator booking a
-- child into the wrong roll — and it is not an authorisation rule. On DELETE the USING
-- clause already confines the caller to rows in a centre where they hold owner or manager,
-- and a row that violated the consistency rule could never have been inserted. Adding it to
-- DELETE would only make an inconsistent row undeletable, which is the opposite of useful.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. invoice_lines: an issued invoice must actually freeze
--
-- The one that matters. README, funding-and-billing.md and unverified-claims §14 all state
-- that an issued invoice cannot be changed, and §14 files it specifically as a claim that
-- was once false and is now backed by a test that fails when it stops being true. It was
-- false again, in the one verb the test did not cover:
--
--   DELETE /rest/v1/invoice_lines?id=eq.<line>
--
-- USING only asked "are you an owner or manager of this invoice's centre", so an owner with
-- their own JWT could remove a line from an ISSUED, PAID or VOID invoice. Because a credit
-- is a negative line by design, that moves the total in either direction: delete the
-- "centre closed" credit and the family owes MORE than the invoice they were sent, after
-- issue, with no void-and-reissue and no reason recorded. `invoice_totals` is a view, so the
-- app would show the new figure immediately while the family holds the old one.
--
-- 0021 already blocks the status-reversion route and INSERT/UPDATE already require draft, so
-- this was the only remaining way to change an issued invoice — reached in one statement
-- instead of three.
--
-- DELETE stays granted rather than being revoked: editing a DRAFT invoice by removing a line
-- is a legitimate thing to do, and it is what `draft` means.
-- ---------------------------------------------------------------------------

drop policy if exists invoice_lines_write_delete on public.invoice_lines;
create policy invoice_lines_write_delete on public.invoice_lines
  as permissive for delete to public
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_lines.invoice_id
         and public.caller_has_role(i.centre_id, array['owner','manager']::public.member_role[])
         and i.status = 'draft'
    )
  );


-- ---------------------------------------------------------------------------
-- 2. posts: DELETE goes away entirely
--
-- The author condition in WITH CHECK means an educator may create and edit a post attributed
-- to themselves and not one attributed to a colleague. On DELETE that condition was absent,
-- so any staff member at the centre — `caller_staff_centre_ids` includes every educator —
-- could destroy a colleague's write-up of a child's day. Being able to delete a post you are
-- not allowed to edit is incoherent in either direction.
--
-- Rather than pick a predicate, the verb goes. **Nothing in this product deletes a post.**
-- `publishPost` and `archivePost` are the whole vocabulary; there is no `deletePost` in
-- `packages/api`, no delete control on `PostCard`, and archiving is the recorded design
-- because a pānui a family has already read should not be able to vanish.
--
-- So DELETE was a granted verb with no caller, which is the definition of surface. `anon`
-- never had it; `service_role` keeps it, so an operator can still act. Cascade is unaffected:
-- deleting a centre still removes its posts, because a referential action runs as the table
-- owner and is not a DELETE by the caller — the same reasoning `0020` and the e2e teardown
-- already rely on.
-- ---------------------------------------------------------------------------

drop policy if exists posts_write_delete on public.posts;
revoke delete on public.posts from authenticated;


-- ---------------------------------------------------------------------------
-- 3. The class, not the instance — so this cannot come back quietly
--
-- 0022's lesson was that reading fourteen policies and finding them fine is a statement with
-- a shelf life of one commit. The same applies here: the next `FOR ALL` policy that puts a
-- narrowing condition only in WITH CHECK, and is later split, loses it on DELETE again.
--
-- This asserts the invariant instead. Every `_write_delete` policy's USING must equal its
-- `_write_insert` counterpart's WITH CHECK, except for an allowlist of tables where the
-- difference is a write-consistency rule rather than an authorisation rule. Adding a name to
-- that allowlist is a decision, and it has to be made here where the reasoning is.
-- ---------------------------------------------------------------------------

do $$
declare
  -- Reasons in the table at the top of this file. Both are "the row's centre must match the
  -- child's centre", which constrains what may be written and says nothing about who may
  -- delete.
  allowed  text[] := array['bookings', 'enrolments'];
  offenders text;
begin
  select string_agg(d.tablename, ', ' order by d.tablename)
    into offenders
    from pg_policies d
    join pg_policies i
      on i.schemaname = d.schemaname
     and i.tablename  = d.tablename
     and i.policyname = replace(d.policyname, '_delete', '_insert')
   where d.schemaname = 'public'
     and d.cmd = 'DELETE'
     and d.policyname like '%\_write\_delete'
     and d.qual is distinct from i.with_check
     and not (d.tablename = any(allowed));

  if offenders is not null then
    raise exception
      '0025: DELETE is broader than INSERT on: %. A condition in WITH CHECK is not applied to '
      'DELETE. Either add it to the delete policy''s USING clause, or add the table to the '
      'allowlist in this migration with the reason why the condition is about the row being '
      'written rather than about who may remove it.', offenders;
  end if;
end;
$$;

comment on policy invoice_lines_write_delete on public.invoice_lines is
  'Draft only. Without the status condition an owner could remove a line from an issued '
  'invoice and change what a family was billed after they had been sent it — see 0025.';
