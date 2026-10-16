-- Shopper shipping addresses for /account. Reads use row level security.
-- Saves go through save_customer_address so authenticated has no table write grant.
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  line1 text not null check (char_length(btrim(line1)) between 1 and 120),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  postcode text not null check (char_length(btrim(postcode)) between 1 and 16),
  country text not null check (char_length(btrim(country)) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_addresses_user on public.customer_addresses (user_id);
create unique index customer_addresses_one_default on public.customer_addresses (user_id) where is_default;

alter table public.customer_addresses enable row level security;
revoke all on public.customer_addresses from public, anon, authenticated;
grant select on public.customer_addresses to authenticated;
grant select, insert, update, delete on public.customer_addresses to service_role;

create policy customer_address_read on public.customer_addresses
  for select to authenticated
  using (user_id = (select auth.uid()));

create function public.save_customer_address(
  p_line1 text,
  p_city text,
  p_postcode text,
  p_country text,
  p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  street text := btrim(p_line1);
  town text := btrim(p_city);
  code text := btrim(p_postcode);
  nation text := btrim(p_country);
  saved uuid;
  make_default boolean;
begin
  if owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(street) not between 1 and 120
     or char_length(town) not between 1 and 80
     or char_length(code) not between 1 and 16
     or char_length(nation) not between 1 and 80 then
    raise exception 'invalid address' using errcode = '22023';
  end if;
  if p_id is null then
    make_default := not exists (select 1 from public.customer_addresses where user_id = owner);
    insert into public.customer_addresses (user_id, line1, city, postcode, country, is_default)
    values (owner, street, town, code, nation, make_default)
    returning id into saved;
  else
    update public.customer_addresses
    set line1 = street, city = town, postcode = code, country = nation, updated_at = now()
    where id = p_id and user_id = owner
    returning id into saved;
    if saved is null then
      raise exception 'address not found' using errcode = '42501';
    end if;
  end if;
  return saved;
end $$;

revoke all on function public.save_customer_address(text, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.save_customer_address(text, text, text, text, uuid) to authenticated;
