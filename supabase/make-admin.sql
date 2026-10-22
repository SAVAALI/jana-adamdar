-- First register on the website, confirm the email, then replace the email below.
-- Run only in YOUR project's SQL Editor; never in the browser console.
do $$
declare target uuid;
begin
  select id into target from auth.users
    where lower(email)=lower('ВАША_ПОЧТА') and email_confirmed_at is not null;
  if target is null then raise exception 'Аккаунт не найден. Сначала зарегистрируйтесь и подтвердите почту.'; end if;
  update public.vsg_members set role='admin' where user_id=target;
  if not found then raise exception 'Сначала выполните setup.sql.'; end if;
end;
$$;
