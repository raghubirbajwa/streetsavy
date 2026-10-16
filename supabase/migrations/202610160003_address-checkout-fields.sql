-- Checkout and the account address book share one India delivery address.
alter table public.customer_addresses drop constraint customer_addresses_line1_check;
alter table public.customer_addresses drop constraint customer_addresses_city_check;
alter table public.customer_addresses
  add constraint customer_addresses_line1_check check (char_length(btrim(line1)) between 1 and 200),
  add constraint customer_addresses_city_check check (char_length(btrim(city)) between 1 and 100),
  add column full_name text,
  add column email text,
  add column phone text,
  add column line2 text not null default '',
  add column state_code text,
  add constraint customer_addresses_full_name_check check (full_name is null or char_length(btrim(full_name)) between 1 and 120),
  add constraint customer_addresses_email_check check (email is null or (char_length(email) between 3 and 254 and position('@' in email) > 1)),
  add constraint customer_addresses_phone_check check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  add constraint customer_addresses_line2_check check (char_length(line2) <= 200),
  add constraint customer_addresses_state_code_check check (state_code is null or state_code in ('AN','AP','AR','AS','BR','CH','CG','DH','DL','GA','GJ','HR','HP','JK','JH','KA','KL','LA','LD','MP','MH','MN','ML','MZ','NL','OD','PB','PY','RJ','SK','TN','TS','TR','UP','UK','WB'));

drop function public.save_customer_address(text, text, text, text, uuid);

create function public.save_customer_address(
  p_full_name text,
  p_email text,
  p_phone text,
  p_line1 text,
  p_city text,
  p_postcode text,
  p_state_code text,
  p_line2 text default '',
  p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  given text := btrim(p_full_name);
  mail text := lower(btrim(p_email));
  mobile text := btrim(p_phone);
  street text := btrim(p_line1);
  extra text := btrim(coalesce(p_line2, ''));
  town text := btrim(p_city);
  code text := btrim(p_postcode);
  state text := btrim(p_state_code);
  saved uuid;
  make_default boolean;
begin
  if owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(given) not between 1 and 120
     or char_length(mail) not between 3 and 254
     or position('@' in mail) < 2
     or mobile !~ '^[6-9][0-9]{9}$'
     or char_length(street) not between 1 and 200
     or char_length(extra) > 200
     or char_length(town) not between 1 and 100
     or code !~ '^[1-9][0-9]{5}$'
     or state not in ('AN','AP','AR','AS','BR','CH','CG','DH','DL','GA','GJ','HR','HP','JK','JH','KA','KL','LA','LD','MP','MH','MN','ML','MZ','NL','OD','PB','PY','RJ','SK','TN','TS','TR','UP','UK','WB') then
    raise exception 'invalid address' using errcode = '22023';
  end if;
  if p_id is null then
    make_default := not exists (select 1 from public.customer_addresses where user_id = owner);
    insert into public.customer_addresses (user_id, full_name, email, phone, line1, line2, city, postcode, state_code, country, is_default)
    values (owner, given, mail, mobile, street, extra, town, code, state, 'IN', make_default)
    returning id into saved;
  else
    update public.customer_addresses
    set full_name = given, email = mail, phone = mobile, line1 = street, line2 = extra, city = town,
        postcode = code, state_code = state, country = 'IN', updated_at = now()
    where id = p_id and user_id = owner
    returning id into saved;
    if saved is null then
      raise exception 'address not found' using errcode = '42501';
    end if;
  end if;
  return saved;
end $$;

revoke all on function public.save_customer_address(text, text, text, text, text, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.save_customer_address(text, text, text, text, text, text, text, text, uuid) to authenticated;
