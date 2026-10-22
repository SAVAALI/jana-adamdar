-- Run once in the SQL Editor of the NEW jana-adamdar project. Safe to rerun.
-- Contains no passwords, API keys or demo reports.
begin;

create table if not exists public.vsg_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text not null,
  role text not null default 'pending' check (role in ('pending','member','admin','blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.vsg_stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  address text not null check (char_length(btrim(address)) between 1 and 160),
  city text not null default 'Астана' check (city = 'Астана'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists vsg_store_identity
  on public.vsg_stores (lower(btrim(name)), lower(btrim(address)), city);

create table if not exists public.vsg_reports (
  id uuid primary key,
  store_id uuid not null references public.vsg_stores(id),
  author_id uuid not null references auth.users(id),
  result text not null check (result in ('clean','violation')),
  description text not null check (char_length(btrim(description)) between 10 and 1000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  moderation_state text not null default 'pending' check (moderation_state in ('pending','approved','rejected')),
  moderation_note text not null default '' check (char_length(moderation_note) <= 500),
  moderated_by uuid references auth.users(id),
  moderated_at timestamptz
);
create index if not exists vsg_reports_store on public.vsg_reports(store_id, occurred_at desc);
create index if not exists vsg_reports_author on public.vsg_reports(author_id, created_at desc);
create index if not exists vsg_reports_moderation on public.vsg_reports(moderation_state, created_at desc);

create table if not exists public.vsg_report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.vsg_reports(id) on delete cascade,
  storage_path text not null unique,
  filename text not null check (char_length(filename) between 1 and 150),
  sort_order smallint not null check (sort_order between 0 and 5),
  unique(report_id, sort_order)
);

alter table public.vsg_members enable row level security;
alter table public.vsg_stores enable row level security;
alter table public.vsg_reports enable row level security;
alter table public.vsg_report_photos enable row level security;

create or replace function public.vsg_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vsg_members where user_id = auth.uid() and role = 'admin');
$$;
create or replace function public.vsg_is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vsg_members where user_id = auth.uid() and role in ('member','admin'));
$$;
revoke all on function public.vsg_is_admin(), public.vsg_is_member() from public;
grant execute on function public.vsg_is_admin(), public.vsg_is_member() to anon, authenticated;

drop policy if exists vsg_member_read on public.vsg_members;
create policy vsg_member_read on public.vsg_members for select to authenticated
  using (user_id = auth.uid() or public.vsg_is_admin());
drop policy if exists vsg_report_read on public.vsg_reports;
create policy vsg_report_read on public.vsg_reports for select to authenticated
  using (author_id = auth.uid() or public.vsg_is_admin());
drop policy if exists vsg_store_read on public.vsg_stores;
create policy vsg_store_read on public.vsg_stores for select to authenticated
  using (public.vsg_is_member() or exists (
    select 1 from public.vsg_reports r where r.store_id = vsg_stores.id and r.author_id = auth.uid()
  ));
drop policy if exists vsg_photo_read on public.vsg_report_photos;
create policy vsg_photo_read on public.vsg_report_photos for select to authenticated
  using (exists(select 1 from public.vsg_reports r where r.id = report_id));

grant usage on schema public to anon, authenticated;
revoke all on public.vsg_members, public.vsg_stores, public.vsg_reports, public.vsg_report_photos from public, anon, authenticated;
grant select on public.vsg_members, public.vsg_stores, public.vsg_reports, public.vsg_report_photos to authenticated;

create or replace function public.vsg_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vsg_members(user_id, display_name, email)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), 'Участник'), 60), coalesce(new.email,''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.vsg_handle_new_user() from public, anon, authenticated;
drop trigger if exists vsg_on_auth_user_created on auth.users;
create trigger vsg_on_auth_user_created after insert on auth.users
  for each row execute function public.vsg_handle_new_user();
insert into public.vsg_members(user_id, display_name, email)
  select id, left(coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),'Участник'),60),coalesce(email,'')
  from auth.users on conflict (user_id) do nothing;

alter table public.vsg_reports add column if not exists latitude double precision;
alter table public.vsg_reports add column if not exists longitude double precision;

-- Intentionally owner-executed views: only approved, non-personal fields.
-- Direct table reads still require authentication and pass RLS above.
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
create or replace view public.vsg_public_stats with (security_barrier = true) as
  select
    (select count(distinct store_id) from public.vsg_reports where moderation_state = 'approved') as stores,
    (select count(*) from public.vsg_reports where moderation_state = 'approved' and result = 'violation') as violations,
    (select count(*) from public.vsg_reports where moderation_state = 'approved') as reports,
    (select count(*) from public.vsg_members where role in ('member','admin')) as members;
revoke all on public.vsg_public_reports, public.vsg_public_stats from public, anon, authenticated;
grant select on public.vsg_public_reports, public.vsg_public_stats to anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('vsg-report-photos','vsg-report-photos',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=8388608, allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.vsg_can_read_photo(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vsg_report_photos p join public.vsg_reports r on r.id=p.report_id
    where p.storage_path=object_path and (r.moderation_state='approved' or r.author_id=auth.uid() or public.vsg_is_admin()));
$$;
create or replace function public.vsg_photo_attached(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vsg_report_photos where storage_path=object_path);
$$;
revoke all on function public.vsg_can_read_photo(text), public.vsg_photo_attached(text) from public;
grant execute on function public.vsg_can_read_photo(text), public.vsg_photo_attached(text) to anon, authenticated;

drop policy if exists vsg_storage_read on storage.objects;
create policy vsg_storage_read on storage.objects for select to anon, authenticated using (
  bucket_id='vsg-report-photos' and (public.vsg_can_read_photo(name)
    or (public.vsg_is_member() and (storage.foldername(name))[1]=auth.uid()::text))
);
drop policy if exists vsg_storage_upload on storage.objects;
create policy vsg_storage_upload on storage.objects for insert to authenticated with check (
  bucket_id='vsg-report-photos' and public.vsg_is_member()
  and (storage.foldername(name))[1]=auth.uid()::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
);
drop policy if exists vsg_storage_cleanup on storage.objects;
create policy vsg_storage_cleanup on storage.objects for delete to authenticated using (
  bucket_id='vsg-report-photos' and public.vsg_is_member()
  and (storage.foldername(name))[1]=auth.uid()::text and not public.vsg_photo_attached(name)
);

create or replace function public.vsg_submit_report(
  p_report_id uuid, p_store_id uuid, p_store_name text, p_store_address text,
  p_result text, p_description text, p_photos jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target uuid;
  photo jsonb;
  path text;
  position smallint := 0;
begin
  if caller is null or not public.vsg_is_member() then raise exception 'Доступ к отправке открывает администратор команды.' using errcode='42501'; end if;
  if p_report_id is null then raise exception 'Не указан номер отчёта.'; end if;
  if exists(select 1 from public.vsg_reports where id=p_report_id and author_id=caller) then return p_report_id; end if;
  if p_result is null or p_result not in ('clean','violation') or p_description is null or char_length(btrim(p_description)) not between 10 and 1000 then
    raise exception 'Проверьте результат и описание (10–1000 символов).';
  end if;
  if jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Добавьте фотографии.'; end if;
  if jsonb_array_length(p_photos) not between 1 and 6 then raise exception 'Нужно от 1 до 6 фотографий.'; end if;
  if (select count(distinct value->>'path') from jsonb_array_elements(p_photos)) <> jsonb_array_length(p_photos) then raise exception 'Фотографии не должны повторяться.'; end if;
  for photo in select value from jsonb_array_elements(p_photos) loop
    path := photo->>'path';
    if path is null or path not like caller::text||'/'||p_report_id::text||'/%'
      or path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
      or not exists(select 1 from storage.objects where bucket_id='vsg-report-photos' and name=path)
      or coalesce(char_length(photo->>'filename'),0) not between 1 and 150 then
      raise exception 'Фотография не загружена или не принадлежит этому отчёту.' using errcode='42501';
    end if;
  end loop;
  if p_store_id is not null then
    select id into target from public.vsg_stores where id=p_store_id;
    if target is null then raise exception 'Магазин не найден. Обновите список.'; end if;
  else
    if p_store_name is null or p_store_address is null or char_length(btrim(p_store_name)) not between 1 and 80
      or char_length(btrim(p_store_address)) not between 1 and 160 then raise exception 'Укажите название и адрес магазина.'; end if;
    insert into public.vsg_stores(name,address,created_by) values(btrim(p_store_name),btrim(p_store_address),caller)
      on conflict do nothing returning id into target;
    if target is null then
      select id into target from public.vsg_stores where lower(btrim(name))=lower(btrim(p_store_name))
        and lower(btrim(address))=lower(btrim(p_store_address)) and city='Астана';
    end if;
  end if;
  insert into public.vsg_reports(id,store_id,author_id,result,description)
    values(p_report_id,target,caller,p_result,btrim(p_description));
  for photo in select value from jsonb_array_elements(p_photos) loop
    insert into public.vsg_report_photos(report_id,storage_path,filename,sort_order)
      values(p_report_id,photo->>'path',photo->>'filename',position);
    position := position+1;
  end loop;
  return p_report_id;
end;
$$;

create or replace function public.vsg_moderate_report(p_report_id uuid,p_decision text,p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.vsg_is_admin() then raise exception 'Только администратор может публиковать отчёты.' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or char_length(coalesce(p_note,''))>500 then raise exception 'Неверный результат проверки.'; end if;
  update public.vsg_reports set moderation_state=p_decision, moderation_note=coalesce(p_note,''), moderated_by=auth.uid(),moderated_at=now()
    where id=p_report_id;
  if not found then raise exception 'Отчёт не найден.'; end if;
end;
$$;

create or replace function public.vsg_set_member_role(p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.vsg_is_admin() then raise exception 'Только администратор управляет участниками.' using errcode='42501'; end if;
  if p_role is null or p_role not in ('member','blocked') then raise exception 'Недопустимая роль.'; end if;
  if p_role='member' and not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then
    raise exception 'Участник должен сначала подтвердить почту.';
  end if;
  update public.vsg_members set role=p_role where user_id=p_user_id and role<>'admin';
  if not found then raise exception 'Участник не найден или является администратором.'; end if;
end;
$$;
revoke all on function public.vsg_submit_report(uuid,uuid,text,text,text,text,jsonb), public.vsg_moderate_report(uuid,text,text), public.vsg_set_member_role(uuid,text) from public, anon, authenticated;
grant execute on function public.vsg_submit_report(uuid,uuid,text,text,text,text,jsonb), public.vsg_moderate_report(uuid,text,text), public.vsg_set_member_role(uuid,text) to authenticated;

notify pgrst, 'reload schema';

-- Real map coordinates (also available separately for existing projects).

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

-- Public history of all approved checks.
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
