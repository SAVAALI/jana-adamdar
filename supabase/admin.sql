-- Run in SQL Editor of jana-adamdar. Safe to rerun; preserves data and roles.
begin;
create or replace function public.vsg_admin_dashboard(
  p_tab text default 'reports', p_state text default 'pending',
  p_query text default '', p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare counts jsonb; items jsonb := '[]'::jsonb; total bigint := 0;
  needle text := lower(btrim(coalesce(p_query,'')));
begin
  if not public.vsg_is_admin() then raise exception 'Кабинет доступен только администратору.' using errcode='42501'; end if;
  if p_tab is null or p_tab not in ('reports','members','summary') or p_offset is null or p_offset < 0 or p_offset > 1000000 or char_length(needle)>160 then raise exception 'Проверьте параметры поиска.'; end if;
  select jsonb_build_object(
    'reports_pending',count(*) filter(where moderation_state='pending'),
    'reports_approved',count(*) filter(where moderation_state='approved'),
    'reports_rejected',count(*) filter(where moderation_state='rejected')
  ) into counts from public.vsg_reports;
  select counts || jsonb_build_object(
    'members_pending',count(*) filter(where role='pending'),
    'members_active',count(*) filter(where role in ('member','admin')),
    'members_blocked',count(*) filter(where role='blocked')
  ) into counts from public.vsg_members;
  if p_tab='reports' then
    if p_state is null or p_state not in ('all','pending','approved','rejected') then raise exception 'Неизвестный статус отчёта.'; end if;
    select count(*) into total from public.vsg_reports r
      join public.vsg_stores s on s.id=r.store_id left join public.vsg_members m on m.user_id=r.author_id
      where (p_state='all' or r.moderation_state=p_state)
      and (needle='' or strpos(lower(concat_ws(' ',s.name,s.address,m.display_name)),needle)>0);
    select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id desc),'[]'::jsonb) into items from (
      select r.*,jsonb_build_object('name',s.name,'address',s.address,'city',s.city) as store,
        coalesce(m.display_name,'Участник') as author_name,
        coalesce((select jsonb_agg(jsonb_build_object('storage_path',p.storage_path,'filename',p.filename,'sort_order',p.sort_order) order by p.sort_order)
          from public.vsg_report_photos p where p.report_id=r.id),'[]'::jsonb) as photos
      from public.vsg_reports r join public.vsg_stores s on s.id=r.store_id left join public.vsg_members m on m.user_id=r.author_id
      where (p_state='all' or r.moderation_state=p_state)
      and (needle='' or strpos(lower(concat_ws(' ',s.name,s.address,m.display_name)),needle)>0)
      order by r.created_at desc,r.id desc limit 20 offset p_offset
    ) page;
  elsif p_tab='members' then
    if p_state is null or p_state not in ('all','pending','member','admin','blocked') then raise exception 'Неизвестный статус участника.'; end if;
    select count(*) into total from public.vsg_members m where (p_state='all' or m.role=p_state)
      and (needle='' or strpos(lower(concat_ws(' ',m.display_name,m.email)),needle)>0);
    select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc,page.user_id desc),'[]'::jsonb) into items from (
      select user_id,display_name,email,role,created_at from public.vsg_members m
      where (p_state='all' or m.role=p_state) and (needle='' or strpos(lower(concat_ws(' ',m.display_name,m.email)),needle)>0)
      order by created_at desc,user_id desc limit 20 offset p_offset
    ) page;
  end if;
  return jsonb_build_object('counts',counts,'total',total,'items',items);
end;
$$;
revoke all on function public.vsg_admin_dashboard(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.vsg_admin_dashboard(text,text,text,integer) to authenticated;

create or replace function public.vsg_moderate_report(p_report_id uuid,p_decision text,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.vsg_is_admin() then raise exception 'Только администратор может публиковать отчёты.' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or char_length(coalesce(p_note,''))>500 then raise exception 'Неверный результат проверки.'; end if;
  if p_decision='rejected' and char_length(btrim(coalesce(p_note,'')))<5 then raise exception 'Укажите понятную причину отклонения (от 5 символов).'; end if;
  update public.vsg_reports set moderation_state=p_decision,moderation_note=case when p_decision='approved' then '' else btrim(p_note) end,
    moderated_by=auth.uid(),moderated_at=now() where id=p_report_id;
  if not found then raise exception 'Отчёт не найден.'; end if;
end;
$$;
revoke all on function public.vsg_moderate_report(uuid,text,text) from public,anon,authenticated;
grant execute on function public.vsg_moderate_report(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
