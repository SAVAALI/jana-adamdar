-- Run in SQL Editor of jana-adamdar after setup.sql. Safe to rerun.
-- Adds coordinates without deleting reports or changing publication status.
begin;

alter table public.vsg_reports add column if not exists latitude double precision;
alter table public.vsg_reports add column if not exists longitude double precision;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='vsg_report_location' and conrelid='public.vsg_reports'::regclass) then
    alter table public.vsg_reports add constraint vsg_report_location check (
      (latitude is null and longitude is null) or
      (latitude is not null and longitude is not null and latitude between 50.8 and 51.5 and longitude between 70.9 and 72.0)
    );
  end if;
end $$;

alter table public.vsg_reports add column if not exists checked_date date;
alter table public.vsg_reports add column if not exists products jsonb not null default '[]'::jsonb;
create or replace view public.vsg_public_reports with (security_barrier = true) as
  select distinct on (r.store_id)
    r.id, r.store_id, s.name as store_name, s.address, s.city,
    r.result, r.description, r.occurred_at, r.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('path',p.storage_path,'order',p.sort_order) order by p.sort_order)
      from public.vsg_report_photos p where p.report_id = r.id), '[]'::jsonb) as photos,
    r.latitude, r.longitude, r.checked_date, r.products
  from public.vsg_reports r join public.vsg_stores s on s.id = r.store_id
  where r.moderation_state = 'approved'
  order by r.store_id, r.occurred_at desc, r.created_at desc, r.id desc;
grant select on public.vsg_public_reports to anon, authenticated;

-- Wrapper keeps report, photo metadata and coordinates in one transaction.
-- Original RPC remains available to older clients.
create or replace function public.vsg_submit_located_report(
  p_report_id uuid, p_store_id uuid, p_store_name text, p_store_address text,
  p_result text, p_description text, p_photos jsonb,
  p_latitude double precision, p_longitude double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if auth.uid() is null or not public.vsg_is_member() then
    raise exception 'Доступ к отправке открывает администратор команды.' using errcode='42501';
  end if;
  if p_latitude is null or p_longitude is null or not (p_latitude between 50.8 and 51.5 and p_longitude between 70.9 and 72.0) then
    raise exception 'Выберите место магазина в Астане.';
  end if;
  -- Idempotent retries must not modify a previously submitted report.
  if exists(select 1 from public.vsg_reports where id=p_report_id and author_id=auth.uid()) then return p_report_id; end if;
  target := public.vsg_submit_report(p_report_id,p_store_id,p_store_name,p_store_address,p_result,p_description,p_photos);
  update public.vsg_reports set latitude=p_latitude, longitude=p_longitude where id=target;
  return target;
end;
$$;

-- Administrators can place existing reports and correct a misplaced pin.
create or replace function public.vsg_set_report_location(
  p_report_id uuid, p_latitude double precision, p_longitude double precision
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.vsg_is_admin() then raise exception 'Только администратор может изменить место проверки.' using errcode='42501'; end if;
  if p_latitude is null or p_longitude is null or not (p_latitude between 50.8 and 51.5 and p_longitude between 70.9 and 72.0) then
    raise exception 'Выберите место магазина в Астане.';
  end if;
  update public.vsg_reports set latitude=p_latitude, longitude=p_longitude where id=p_report_id;
  if not found then raise exception 'Отчёт не найден.'; end if;
end;
$$;
revoke all on function public.vsg_submit_located_report(uuid,uuid,text,text,text,text,jsonb,double precision,double precision), public.vsg_set_report_location(uuid,double precision,double precision) from public, anon, authenticated;
grant execute on function public.vsg_submit_located_report(uuid,uuid,text,text,text,text,jsonb,double precision,double precision), public.vsg_set_report_location(uuid,double precision,double precision) to authenticated;
notify pgrst, 'reload schema';
commit;
