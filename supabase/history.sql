-- Run in SQL Editor of jana-adamdar after setup.sql. Safe to rerun.
-- Exposes only published report history; no authors, emails or review notes.
begin;
alter table public.vsg_reports add column if not exists checked_date date;
alter table public.vsg_reports add column if not exists products jsonb not null default '[]'::jsonb;
create or replace view public.vsg_public_history with (security_barrier = true) as
  select r.id, r.store_id, s.name as store_name, s.address, s.city,
    r.result, r.description, r.occurred_at, r.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('path',p.storage_path,'order',p.sort_order) order by p.sort_order)
      from public.vsg_report_photos p where p.report_id = r.id), '[]'::jsonb) as photos, r.checked_date, r.products
  from public.vsg_reports r join public.vsg_stores s on s.id = r.store_id
  where r.moderation_state = 'approved';
revoke all on public.vsg_public_history from public, anon, authenticated;
grant select on public.vsg_public_history to anon, authenticated;
notify pgrst, 'reload schema';
commit;
