-- Run in SQL Editor of jana-adamdar. Safe to rerun; existing reports are preserved.
begin;
alter table public.vsg_reports add column if not exists checked_date date;
alter table public.vsg_reports add column if not exists products jsonb not null default '[]'::jsonb;
alter table public.vsg_reports add column if not exists latitude double precision;
alter table public.vsg_reports add column if not exists longitude double precision;
create or replace function public.vsg_submit_product_report(
 p_report_id uuid,p_store_id uuid,p_store_name text,p_store_address text,p_result text,p_description text,p_photos jsonb,
 p_checked_date date,p_products jsonb,p_latitude double precision,p_longitude double precision
) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; item jsonb; normalized jsonb := '[]'::jsonb; expiry date; quantity integer; photo_index integer;
begin
 if auth.uid() is null or not public.vsg_is_member() then raise exception 'Доступ открывает администратор.' using errcode='42501'; end if;
 if exists(select 1 from public.vsg_reports where id=p_report_id and author_id=auth.uid()) then return p_report_id; end if;
 if p_checked_date is null or p_checked_date < date '2000-01-01' or p_checked_date > (now() at time zone 'Asia/Almaty')::date then raise exception 'Проверьте дату проверки.'; end if;
 if jsonb_typeof(p_products) is distinct from 'array' then raise exception 'Проверьте список товаров.'; end if;
 if jsonb_array_length(p_products)>20 then raise exception 'Максимум 20 товаров в отчёте.'; end if;
 if jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Добавьте фотографии.'; end if;
 if (p_latitude is null) <> (p_longitude is null) or (p_latitude is not null and not(p_latitude between 50.8 and 51.5 and p_longitude between 70.9 and 72.0)) then raise exception 'Укажите место в Астане.'; end if;
 for item in select value from jsonb_array_elements(p_products) loop
   if jsonb_typeof(item->'name') is distinct from 'string' or char_length(btrim(item->>'name')) not between 1 and 120 then raise exception 'Укажите название товара.'; end if;
   if coalesce(item->>'quantity','') !~ '^[0-9]{1,4}$' then raise exception 'Количество — целое число от 1 до 9999.'; end if;
   quantity := (item->>'quantity')::integer;
   if quantity<1 then raise exception 'Количество должно быть положительным.'; end if;
   if coalesce(item->>'photo_index','') !~ '^[0-5]$' then raise exception 'Выберите фото маркировки для каждого товара.'; end if;
   photo_index := (item->>'photo_index')::integer;
   if photo_index >= jsonb_array_length(p_photos) then raise exception 'Фото маркировки не приложено.'; end if;
   expiry := null;
   if item->'expiry' is distinct from 'null'::jsonb then
     if coalesce(item->>'expiry','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Укажите дату годности или отметьте, что срок требует уточнения.'; end if;
     expiry := (item->>'expiry')::date;
     if expiry < date '1900-01-01' or expiry > date '2200-12-31' then raise exception 'Проверьте срок годности.'; end if;
   end if;
   if p_result='clean' and expiry < p_checked_date then raise exception 'В списке есть просроченный товар. Проверьте результат проверки.'; end if;
   normalized := normalized || jsonb_build_array(jsonb_build_object('name',btrim(item->>'name'),'quantity',quantity,'expiry',expiry,'photo_index',photo_index,'expired_days',case when expiry is null then null else greatest(0,p_checked_date-expiry) end));
 end loop;
 target := public.vsg_submit_report(p_report_id,p_store_id,p_store_name,p_store_address,p_result,p_description,p_photos);
 update public.vsg_reports set checked_date=p_checked_date,products=normalized,latitude=p_latitude,longitude=p_longitude,occurred_at=case when p_checked_date=(now() at time zone 'Asia/Almaty')::date then now() else (p_checked_date::timestamp at time zone 'Asia/Almaty') end where id=target;
 return target;
end $$;
revoke all on function public.vsg_submit_product_report(uuid,uuid,text,text,text,text,jsonb,date,jsonb,double precision,double precision) from public,anon,authenticated;
grant execute on function public.vsg_submit_product_report(uuid,uuid,text,text,text,text,jsonb,date,jsonb,double precision,double precision) to authenticated;
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
create or replace view public.vsg_public_history with (security_barrier = true) as
  select r.id, r.store_id, s.name as store_name, s.address, s.city,
    r.result, r.description, r.occurred_at, r.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('path',p.storage_path,'order',p.sort_order) order by p.sort_order)
      from public.vsg_report_photos p where p.report_id = r.id), '[]'::jsonb) as photos, r.checked_date, r.products
  from public.vsg_reports r join public.vsg_stores s on s.id = r.store_id
  where r.moderation_state = 'approved';
revoke all on public.vsg_public_reports,public.vsg_public_history from public,anon,authenticated;
grant select on public.vsg_public_reports,public.vsg_public_history to anon,authenticated;
notify pgrst, 'reload schema';
commit;
