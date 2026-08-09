-- ---------------------------------------------------------------------------
-- 0056 — the enum value, on its own
--
-- `ALTER TYPE ... ADD VALUE` and a statement that *uses* the new value cannot share a
-- transaction (PG12+ permits the ADD but not a subsequent read of it in the same one) —
-- the exact hazard docs/roadmap-phases-8-13.md's per-table checklist names as item 8. The
-- function that uses 'emergency' is 0057, one migration later, so this is not relying on
-- plpgsql's lazy body compilation to dodge the restriction; it simply never shares a
-- transaction with a use.
-- ---------------------------------------------------------------------------

alter type public.notification_kind add value if not exists 'emergency';

comment on type public.notification_kind is
  'emergency bypasses quiet hours and the per-kind opt-out — see broadcast_emergency() in 0057.';
