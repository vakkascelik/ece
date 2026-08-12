/**
 * The same constraint bug 0026 diagnosed and fixed, reintroduced on a newer table.
 *
 * `enrolment_applications.moved_by` is `references auth.users(id) on delete set null` (0052:80),
 * and the row also carries `moved_at`. The constraint added beside them was symmetric:
 *
 *     check ((moved_by is null) = (moved_at is null))
 *
 * So deleting an auth account nulls `moved_by` on every application that account moved, `moved_at`
 * stays set, and the CHECK fails — which does not merely reject the constraint, it makes **deleting
 * that account impossible**. A staff member leaves, somebody removes their login, and the delete
 * errors on a table nobody was thinking about.
 *
 * 0026 hit exactly this on `job_applications.status_changed_by` and settled it: the implication
 * runs one way only. If we know who, we know when. Not the reverse — a move by a since-deleted
 * account legitimately has a time and no name, and that is a true record rather than a broken one.
 * The comment on that constraint says so in as many words, and it is dated four weeks before 0052.
 *
 * Two tables, one lesson, and the second one did not inherit it because a constraint is copied by
 * reading the shape rather than the reasoning. Recorded here so the next `*_by`/`*_at` pair is
 * written asymmetrically the first time.
 *
 * NO DATA CHANGE. The symmetric form is strictly stronger, so every existing row already satisfies
 * the weaker one and no row needs repairing. The only thing this unblocks is a future deletion.
 */

alter table public.enrolment_applications
  drop constraint if exists enrolment_applications_moved_complete;

alter table public.enrolment_applications
  add constraint enrolment_applications_moved_complete
  check (moved_by is null or moved_at is not null);

comment on constraint enrolment_applications_moved_complete on public.enrolment_applications is
  'If we know who moved it, we know when. Not the reverse: `on delete set null` on moved_by '
  'means a move by a since-deleted account legitimately has a time and no name, and requiring '
  'symmetry made deleting that account impossible — the same defect 0026 fixed on '
  'job_applications, reintroduced in 0052 and corrected here.';
