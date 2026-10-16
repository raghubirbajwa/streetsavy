-- Shopper accounts created from /account. Auth still lives in auth.users.
-- This row keeps the name and marketing choice where the store can read it.
create table public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from public, anon, authenticated;
grant select on public.customer_profiles to authenticated;
grant select, insert, update, delete on public.customer_profiles to service_role;

create policy customer_profile_read on public.customer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create function public.create_customer_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := to_jsonb(new);
  given text;
  family text;
  opted text;
begin
  given := nullif(btrim(coalesce(meta->'raw_user_meta_data'->>'first_name', meta->>'first_name', '')), '');
  family := btrim(coalesce(meta->'raw_user_meta_data'->>'last_name', meta->>'last_name', ''));
  opted := coalesce(meta->'raw_user_meta_data'->>'marketing_opt_in', meta->>'marketing_opt_in', 'false');
  insert into public.customer_profiles(user_id, first_name, last_name, marketing_opt_in)
  values (new.id, coalesce(given, 'Customer'), family, opted in ('true', 't', '1'))
  on conflict (user_id) do nothing;
  return new;
end $$;

revoke all on function public.create_customer_profile() from public, anon, authenticated, service_role;
create trigger customer_profile_on_signup
  after insert on auth.users
  for each row execute function public.create_customer_profile();

insert into public.customer_profiles(user_id, first_name, last_name, marketing_opt_in)
select users.id,
  coalesce(nullif(btrim(coalesce(to_jsonb(users)->'raw_user_meta_data'->>'first_name', '')), ''), 'Customer'),
  btrim(coalesce(to_jsonb(users)->'raw_user_meta_data'->>'last_name', '')),
  coalesce(to_jsonb(users)->'raw_user_meta_data'->>'marketing_opt_in', 'false') in ('true', 't', '1')
from auth.users as users
on conflict (user_id) do nothing;
