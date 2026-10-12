-- M4. All monetary/stock writes use service-only transactions. Provider I/O is outside them.
alter table public.shipping_quotes add column pricing_snapshot jsonb not null default '{}';
alter table public.orders add column fixture boolean not null default false;
alter table public.orders add column next_payment_check_at timestamptz not null default now();
create index orders_payment_check on public.orders(next_payment_check_at);
alter table public.payment_attempts add column fixture_state text not null default 'created' check(fixture_state in('created','authorized','captured','failed','refunded'));
alter table public.notifications add column first_attempt_at timestamptz, add column safe_error text;
create table public.order_access_grants (
  order_id uuid not null references public.orders(id), guest_session_id uuid not null references public.guest_sessions(id),
  created_at timestamptz not null default now(), primary key(order_id,guest_session_id)
);
alter table public.order_access_grants enable row level security;
revoke all on public.order_access_grants from public,anon,authenticated;
grant select,insert,delete on public.order_access_grants to service_role;
create table public.payment_observations (
  mode text not null check(mode in('test','live')),provider_payment_id text not null,order_id uuid not null references public.orders(id),
  provider_order_id text not null,amount_paise bigint not null check(amount_paise between 0 and 9007199254740991),currency text not null,
  status text not null,observed_at timestamptz not null default now(),primary key(mode,provider_payment_id)
);
create table public.provider_refund_observations (
  mode text not null check(mode in('test','live')),provider_refund_id text not null,provider_payment_id text not null,order_id uuid not null references public.orders(id),
  amount_paise bigint not null check(amount_paise between 1 and 9007199254740991),status text not null check(status in('pending','processed','failed')),
  observed_at timestamptz not null default now(),primary key(mode,provider_refund_id)
);
alter table public.payment_observations enable row level security;
alter table public.provider_refund_observations enable row level security;
revoke all on public.payment_observations,public.provider_refund_observations from public,anon,authenticated;
grant select,insert,update on public.payment_observations,public.provider_refund_observations to service_role;

create function public.checkout_session(p_token_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
  select id into s from public.guest_sessions where token_hash=p_token_hash and revoked_at is null and expires_at>now();
  if s is null then raise exception 'SESSION_REQUIRED'; end if;
  return s;
end $$;

create function public.checkout_context(p_token_hash text,p_cart_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.carts; w public.warehouse; pack public.packaging_presets; s public.store_settings; items jsonb; units integer; weight bigint; subtotal bigint;
begin
  select * into c from public.carts where guest_session_id=public.checkout_session(p_token_hash) and status='open' for update;
  if not found or not exists(select 1 from public.cart_items where cart_id=c.id) then raise exception 'CART_EMPTY'; end if;
  if c.version is distinct from p_cart_version or c.expires_at<=now() then raise exception 'QUOTE_STALE'; end if;
  if exists(select 1 from public.orders where source_cart_id=c.id and order_status='pending_payment') then raise exception 'CHECKOUT_IN_PROGRESS'; end if;
  -- Lock catalogue rows in a stable order while constructing the immutable input.
  perform v.id from public.product_variants v join public.cart_items ci on ci.variant_id=v.id where ci.cart_id=c.id order by v.id for share of v;
  perform p.id from public.products p where p.id in(select v.product_id from public.cart_items ci join public.product_variants v on v.id=ci.variant_id where ci.cart_id=c.id) order by p.id for share;
  if exists(select 1 from public.cart_items ci join public.product_variants v on v.id=ci.variant_id join public.products p on p.id=v.product_id join public.categories cat on cat.id=p.category_id left join public.inventory i on i.variant_id=v.id where ci.cart_id=c.id and (not v.enabled or p.status<>'published' or not cat.active or coalesce(i.on_hand-i.reserved,0)<ci.quantity or ci.quantity>10)) then raise exception 'STOCK_CONFLICT'; end if;
  select sum(ci.quantity)::int,sum(ci.quantity::bigint*v.unit_weight_g),sum(ci.quantity::numeric*v.price_paise)::bigint,
    jsonb_agg(jsonb_build_object('variantId',v.id,'productId',p.id,'productVersion',p.version,'variantVersion',v.version,'title',p.title,'sku',v.sku,'color',v.color_label,'size',v.size,'quantity',ci.quantity,'unitPricePaise',v.price_paise,'weightG',v.unit_weight_g) order by v.id)
    into units,weight,subtotal,items from public.cart_items ci join public.product_variants v on v.id=ci.variant_id join public.products p on p.id=v.product_id where ci.cart_id=c.id;
  if units>500 or subtotal not between 100 and 9007199254740000 then raise exception 'PRICE_UNAVAILABLE'; end if;
  select * into w from public.warehouse where active for share;
  if not found then raise exception 'INTEGRATION_UNCONFIGURED'; end if;
  select * into pack from public.packaging_presets pp where pp.active and pp.max_items>=units and pp.max_contents_weight_g>=weight
    and not exists(select 1 from public.cart_items ci join public.product_variants v on v.id=ci.variant_id where ci.cart_id=c.id and not exists(select 1 from public.product_packaging x where x.product_id=v.product_id and x.preset_id=pp.id))
    order by pp.priority,pp.id limit 1 for share;
  if not found then raise exception 'PACKAGING_UNSUPPORTED'; end if;
  select * into s from public.store_settings where key='commerce' for share;
  if not found or s.value->>'taxInclusive' is distinct from 'true' or s.value->>'taxRatePercent' is null then raise exception 'TAX_UNCONFIGURED'; end if;
  return jsonb_build_object('cartId',c.id,'cartVersion',c.version,'items',items,'itemSubtotalPaise',subtotal,'weightG',weight+pack.tare_weight_g,'warehouse',to_jsonb(w),'packaging',to_jsonb(pack),'settings',s.value,'pricingVersion',s.version);
end $$;

create function public.checkout_quote(p_token_hash text,p_cart_version integer,p_address jsonb,p_context jsonb,p_shipping jsonb,p_fixture boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; q public.shipping_quotes; fee bigint; subtotal bigint; rate numeric; taxes jsonb;
begin
  if p_address is null or jsonb_typeof(p_address)<>'object' or not(p_address ?& array['fullName','email','phone','line1','city','stateCode','pincode','country']) or p_address-array['fullName','email','phone','line1','line2','city','stateCode','pincode','country']<>'{}'::jsonb or octet_length(p_address::text)>4096 or p_address::text ~ '\\u00(0[0-9a-f]|1[0-9a-f]|7f)' then raise exception 'INVALID_PAYLOAD'; end if;
  if p_address->>'email' is null or p_address->>'email' <> lower(btrim(p_address->>'email')) or p_address->>'email' not like '%@%' or coalesce(p_address->>'phone','') !~ '^[6-9][0-9]{9}$' or coalesce(p_address->>'pincode','') !~ '^[1-9][0-9]{5}$' or p_address->>'country' is distinct from 'IN' or coalesce(length(p_address->>'fullName'),0) not between 1 and 120 or coalesce(length(p_address->>'line1'),0) not between 1 and 200 or coalesce(length(p_address->>'city'),0) not between 1 and 100 or coalesce(p_address->>'stateCode','') !~ '^(AN|AP|AR|AS|BR|CH|CG|DH|DL|GA|GJ|HR|HP|JK|JH|KA|KL|LA|LD|MP|MH|MN|ML|MZ|NL|OD|PB|PY|RJ|SK|TN|TS|TR|UP|UK|WB)$' then raise exception 'INVALID_PAYLOAD'; end if;
  ctx:=public.checkout_context(p_token_hash,p_cart_version);
  if ctx is distinct from p_context then raise exception 'QUOTE_STALE'; end if;
  if p_shipping->>'serviceable' is distinct from 'true' then raise exception 'UNSERVICEABLE_PIN'; end if;
  if (p_shipping->>'costPaise')::bigint not between 0 and 10000000 or length(p_shipping->>'serviceKey') not between 1 and 200 then raise exception 'INVALID_PAYLOAD'; end if;
  subtotal:=(ctx->>'itemSubtotalPaise')::bigint;
  fee:=case ctx->'settings'->>'shippingMode' when 'provider' then (p_shipping->>'costPaise')::bigint when 'flat' then (ctx->'settings'->>'shippingFeePaise')::bigint when 'free_above' then case when subtotal >= (ctx->'settings'->>'freeShippingThresholdPaise')::bigint then 0 else (ctx->'settings'->>'shippingFeePaise')::bigint end else null end;
  rate:=(ctx->'settings'->>'taxRatePercent')::numeric;
  if fee is null or fee<0 or rate not between 0 and 100 or subtotal+fee>9007199254740991 then raise exception 'PRICE_UNAVAILABLE'; end if;
  taxes:=jsonb_build_array(jsonb_build_object('label',case when p_fixture then 'Fixture inclusive tax' else 'Included tax' end,'ratePercent',rate,'includedPaise',((select sum(round((x->>'quantity')::numeric*(x->>'unitPricePaise')::numeric*rate/(100+rate))) from jsonb_array_elements(ctx->'items') x)+round(fee*rate/(100+rate)))::bigint));
  insert into public.shipping_quotes(cart_id,cart_version,address_fingerprint,address_snapshot,warehouse_id,packaging_snapshot,eligible_services,selected_service_key,courier_cost_paise,shipping_fee_paise,item_subtotal_paise,tax_breakdown,total_paise,pricing_version,pricing_snapshot)
    values((ctx->>'cartId')::uuid,p_cart_version,md5((p_address||ctx)::text),p_address,(ctx->'warehouse'->>'id')::uuid,ctx->'packaging',jsonb_build_array(p_shipping),p_shipping->>'serviceKey',(p_shipping->>'costPaise')::bigint,fee,subtotal,taxes,subtotal+fee,(ctx->>'pricingVersion')::int,ctx) returning * into q;
  return jsonb_build_object('quoteId',q.id,'cartVersion',q.cart_version,'expiresAt',q.expires_at,'itemsPayablePaise',subtotal,'shippingFeePaise',fee,'taxBreakdown',taxes,'totalPaise',q.total_paise,'currency','INR','deliveryLabel',p_shipping->>'label','fixture',p_fixture);
end $$;

create function public.checkout_quote_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'IMMUTABLE_QUOTE'; end if;
  return new;
end $$;
create trigger immutable_quote before update on public.shipping_quotes for each row execute function public.checkout_quote_immutable();

create function public.reserve_checkout(p_token_hash text,p_quote_id uuid,p_key text,p_mode text,p_fixture boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; q public.shipping_quotes; ctx jsonb; o public.orders; op public.external_operations; a uuid; x jsonb; r record;
begin
  sid:=public.checkout_session(p_token_hash);
  if p_mode not in('test','live') or (p_fixture and p_mode<>'test') or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' then raise exception 'INVALID_PAYLOAD'; end if;
  -- Cart lock is the shared serialization point for checkout and cart mutation.
  perform c.id from public.carts c join public.shipping_quotes sq on sq.cart_id=c.id where sq.id=p_quote_id and c.guest_session_id=sid for update of c;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into op from public.external_operations where scope='checkout.create' and actor_or_session_key=sid::text and idempotency_key=p_key for update;
  if found then
    if op.request_hash<>md5(p_quote_id::text)||md5('quote:'||p_quote_id) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into o from public.orders where quote_id=p_quote_id;
    if o.id is null then raise exception 'RECONCILIATION_REQUIRED'; end if;
    return o.id;
  end if;
  select * into q from public.shipping_quotes where id=p_quote_id for update;
  if q.status<>'ready' or q.expires_at<=now() then raise exception 'QUOTE_STALE'; end if;
  ctx:=public.checkout_context(p_token_hash,q.cart_version);
  if p_mode='live' and (ctx->'settings'->>'policiesPublished' is distinct from 'true' or ctx->'settings'->>'contactPublished' is distinct from 'true') then raise exception 'INTEGRATION_UNCONFIGURED'; end if;
  if ctx is distinct from q.pricing_snapshot or md5((q.address_snapshot||ctx)::text)<>q.address_fingerprint then raise exception 'QUOTE_STALE'; end if;
  for r in select i.* from public.inventory i join public.cart_items ci on ci.variant_id=i.variant_id where ci.cart_id=q.cart_id order by i.variant_id for update of i loop
    if r.on_hand-r.reserved < (select quantity from public.cart_items where cart_id=q.cart_id and variant_id=r.variant_id) then raise exception 'STOCK_CONFLICT'; end if;
  end loop;
  insert into public.external_operations(scope,actor_or_session_key,idempotency_key,request_hash) values('checkout.create',sid::text,p_key,md5(p_quote_id::text)||md5('quote:'||p_quote_id)) returning * into op;
  insert into public.orders(order_number,guest_session_id,customer_email,customer_phone,shipping_address_snapshot,items_payable_paise,shipping_fee_paise,tax_breakdown,total_paise,quote_id,source_cart_id,source_cart_version,shipping_snapshot,packaging_snapshot,mode,fixture)
    values('YB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)),sid,q.address_snapshot->>'email',q.address_snapshot->>'phone',q.address_snapshot,q.item_subtotal_paise,q.shipping_fee_paise,q.tax_breakdown,q.total_paise,q.id,q.cart_id,q.cart_version,(q.eligible_services->0)-'costPaise',q.packaging_snapshot,p_mode,p_fixture) returning * into o;
  for x in select value from jsonb_array_elements(ctx->'items') loop
    insert into public.order_items(order_id,variant_id,product_title,sku,color,size,quantity,unit_price_paise,line_payable_paise,unit_weight_g,tax_breakdown)
      values(o.id,(x->>'variantId')::uuid,x->>'title',x->>'sku',x->>'color',x->>'size',(x->>'quantity')::int,(x->>'unitPricePaise')::bigint,(x->>'quantity')::bigint*(x->>'unitPricePaise')::bigint,(x->>'weightG')::int,jsonb_build_array(jsonb_build_object('label',q.tax_breakdown->0->>'label','ratePercent',(ctx->'settings'->>'taxRatePercent')::numeric,'includedPaise',round((x->>'quantity')::numeric*(x->>'unitPricePaise')::numeric*(ctx->'settings'->>'taxRatePercent')::numeric/(100+(ctx->'settings'->>'taxRatePercent')::numeric))::bigint)));
    insert into public.inventory_reservations(order_id,variant_id,quantity) values(o.id,(x->>'variantId')::uuid,(x->>'quantity')::int);
    update public.inventory set reserved=reserved+(x->>'quantity')::int where variant_id=(x->>'variantId')::uuid;
  end loop;
  insert into public.payment_attempts(order_id,amount_paise,idempotency_operation_id) values(o.id,o.total_paise,op.id) returning id into a;
  update public.shipping_quotes set status='consumed' where id=q.id;
  update public.external_operations set result_json=jsonb_build_object('orderId',o.id) where id=op.id;
  perform public.enqueue_job('payment.create','payment-create:'||o.id,jsonb_build_object('orderId',o.id),8);
  return o.id;
end $$;

create function public.checkout_order_access(p_order_id uuid,p_token_hash text,p_user_id uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.orders o where o.id=p_order_id and (
  (p_user_id is not null and o.customer_user_id=p_user_id) or exists(select 1 from public.guest_sessions s where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and (o.guest_session_id=s.id or exists(select 1 from public.order_access_grants g where g.order_id=o.id and g.guest_session_id=s.id)))
));
$$;

create function public.checkout_receipt(p_order_id uuid,p_token_hash text,p_user_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; expiry timestamptz;
begin
  if not public.checkout_order_access(p_order_id,p_token_hash,p_user_id) then raise exception 'NOT_FOUND'; end if;
  select * into o from public.orders where id=p_order_id;
  select min(expires_at) into expiry from public.inventory_reservations where order_id=o.id and status='held';
  return jsonb_build_object('id',o.id,'orderNumber',o.order_number,'orderStatus',o.order_status,'paymentStatus',o.payment_status,'fulfillmentStatus',o.fulfillment_status,'attentionReason',o.attention_reason,'address',o.shipping_address_snapshot,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',product_title,'color',color,'size',size,'quantity',quantity,'unitPricePaise',unit_price_paise,'linePayablePaise',line_payable_paise) order by id) from public.order_items where order_id=o.id),'[]'::jsonb),
    'itemsPayablePaise',o.items_payable_paise,'shippingFeePaise',o.shipping_fee_paise,'taxBreakdown',o.tax_breakdown,'totalPaise',o.total_paise,'capturedPaise',o.captured_paise,'refundedPaise',o.refunded_paise,'currency',o.currency,'reservationExpiresAt',expiry,'createdAt',o.created_at,
    'notificationStatus',(select status from public.notifications where order_id=o.id order by created_at desc limit 1),
    'canPay',coalesce(o.order_status='pending_payment' and o.payment_status='unpaid' and o.attention_reason is null and expiry>now() and exists(select 1 from public.payment_attempts where order_id=o.id and provider_order_id is not null and status in('pending','failed')),false),
    'canCancel',o.order_status='pending_payment' and o.captured_paise=0,'fixture',o.fixture);
end $$;

create function public.checkout_payment_context(p_order_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('order',to_jsonb(o),'attempt',to_jsonb(a),'operation',to_jsonb(op),'reservationExpiresAt',(select min(expires_at) from public.inventory_reservations where order_id=o.id),'hasHeld',exists(select 1 from public.inventory_reservations where order_id=o.id and status='held'))
from public.orders o join public.payment_attempts a on a.order_id=o.id join public.external_operations op on op.id=a.idempotency_operation_id where o.id=p_order_id;
$$;

create function public.checkout_bind_provider(p_order_id uuid,p_provider_order_id text,p_amount bigint,p_currency text,p_mode text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.payment_attempts;
begin
  select * into o from public.orders where id=p_order_id for update;
  select * into a from public.payment_attempts where order_id=o.id for update;
  if o.id is null or p_amount is distinct from o.total_paise or p_currency is distinct from o.currency or p_mode is distinct from o.mode or p_provider_order_id !~ '^(order_|fixture_order_)[A-Za-z0-9_-]+$' then raise exception 'PAYMENT_MISMATCH'; end if;
  if a.provider_order_id is not null and a.provider_order_id<>p_provider_order_id then raise exception 'PAYMENT_MISMATCH'; end if;
  update public.payment_attempts set provider_order_id=p_provider_order_id,status=case when status in('creating','unknown') then 'pending' else status end,last_checked_at=now() where id=a.id;
  update public.external_operations set status='succeeded',provider_reference=p_provider_order_id,lease_token=null,locked_until=null,last_error=null where id=a.idempotency_operation_id;
  update public.orders set attention_reason=null,fulfillment_status='unfulfilled' where id=o.id and order_status='pending_payment' and captured_paise=0 and attention_reason='PAYMENT_RECONCILIATION_REQUIRED' and exists(select 1 from public.inventory_reservations where order_id=o.id and status='held' and expires_at>now());
end $$;

-- Multiple captures cannot be reduced to a single allocation. Save every observation and
-- the review hold together, without changing reservations, stock, or customer money totals.
create function public.checkout_hold_payment_conflict(p_order_id uuid,p_payments jsonb,p_mode text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; payment jsonb;
begin
  select * into o from public.orders where id=p_order_id for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if p_mode is distinct from o.mode or jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'PAYMENT_MISMATCH'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_payments) where value->>'status' in('captured','refunded'))<2 then raise exception 'PAYMENT_MISMATCH'; end if;
  for payment in select value from jsonb_array_elements(p_payments) loop
    if payment->>'id' is null or payment->>'order_id' is null or payment->>'currency' is null or payment->>'status' is null or payment->>'status' not in('authorized','captured','failed','refunded','created') then raise exception 'PAYMENT_MISMATCH'; end if;
    insert into public.payment_observations(mode,provider_payment_id,order_id,provider_order_id,amount_paise,currency,status)
      values(p_mode,payment->>'id',o.id,payment->>'order_id',(payment->>'amount')::bigint,payment->>'currency',payment->>'status')
      on conflict(mode,provider_payment_id) do update set observed_at=now(),status=case when public.payment_observations.status='refunded' then 'refunded' when excluded.status='refunded' then 'refunded' when public.payment_observations.status='captured' then 'captured' else excluded.status end
      where public.payment_observations.order_id=excluded.order_id and public.payment_observations.provider_order_id=excluded.provider_order_id and public.payment_observations.amount_paise=excluded.amount_paise and public.payment_observations.currency=excluded.currency;
  end loop;
  update public.orders set fulfillment_status='held',attention_reason='PAYMENT_MISMATCH' where id=o.id;
end $$;

create function public.apply_verified_payment(p_order_id uuid,p_payment jsonb,p_mode text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.payment_attempts; r public.inventory_reservations; ok boolean:=true; n uuid; incoming_status text:=p_payment->>'status'; refunded bigint:=0; refund jsonb;
begin
  select * into o from public.orders where id=p_order_id for update;
  select * into a from public.payment_attempts where order_id=o.id for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if p_mode is distinct from o.mode or p_payment->>'id' is null or p_payment->>'order_id' is null or incoming_status not in('authorized','captured','failed','refunded','created') then raise exception 'PAYMENT_MISMATCH'; end if;
  insert into public.payment_observations(mode,provider_payment_id,order_id,provider_order_id,amount_paise,currency,status)
    values(p_mode,p_payment->>'id',o.id,p_payment->>'order_id',(p_payment->>'amount')::bigint,p_payment->>'currency',incoming_status)
    on conflict(mode,provider_payment_id) do update set observed_at=now(),status=case when public.payment_observations.status in('captured','refunded') then public.payment_observations.status else excluded.status end;
  if p_mode is distinct from o.mode or p_payment->>'order_id' is distinct from a.provider_order_id or p_payment->>'currency' is distinct from o.currency or (p_payment->>'amount')::bigint is distinct from o.total_paise or incoming_status not in('authorized','captured','failed','refunded','created') or p_payment->>'id' is null then
    update public.orders set fulfillment_status='held',attention_reason='PAYMENT_MISMATCH' where id=o.id;
    return;
  end if;
  if a.provider_payment_id is not null and a.provider_payment_id<>p_payment->>'id' and a.status in('captured','authorized') and incoming_status in('captured','authorized','refunded') then
    update public.orders set fulfillment_status='held',attention_reason='PAYMENT_MISMATCH' where id=o.id; return;
  end if;
  if exists(select 1 from public.payment_attempts where provider_payment_id=p_payment->>'id' and id<>a.id) then raise exception 'PAYMENT_MISMATCH'; end if;
  if incoming_status in('captured','refunded') then
    for refund in select value from jsonb_array_elements(coalesce(p_payment->'refunds','[]')) loop
      if refund->>'payment_id' is distinct from p_payment->>'id' or refund->>'currency' is distinct from 'INR' or (refund->>'amount')::bigint not between 1 and o.total_paise or refund->>'status' not in('pending','processed','failed') then raise exception 'PAYMENT_MISMATCH'; end if;
      if exists(select 1 from public.provider_refund_observations x where x.mode=p_mode and x.provider_refund_id=refund->>'id' and (x.order_id<>o.id or x.provider_payment_id<>p_payment->>'id' or x.amount_paise<>(refund->>'amount')::bigint)) then raise exception 'PAYMENT_MISMATCH'; end if;
      insert into public.provider_refund_observations(mode,provider_refund_id,provider_payment_id,order_id,amount_paise,status)
        values(p_mode,refund->>'id',p_payment->>'id',o.id,(refund->>'amount')::bigint,refund->>'status')
        on conflict(mode,provider_refund_id) do update set observed_at=now(),status=case when public.provider_refund_observations.status='processed' then 'processed' else excluded.status end;
      update public.refunds set status=case when refund->>'status'='pending' then 'processing' else refund->>'status' end,processed_at=case when refund->>'status'='processed' then coalesce(processed_at,now()) else processed_at end
        where provider_refund_id=refund->>'id' and order_id=o.id and amount_paise=(refund->>'amount')::bigint and public.refunds.status<>'processed';
    end loop;
    select coalesce(sum(amount_paise),0) into refunded from public.provider_refund_observations where order_id=o.id and mode=p_mode and provider_refund_observations.status='processed';
    if refunded<0 or refunded>o.total_paise then raise exception 'PAYMENT_MISMATCH'; end if;
    if o.captured_paise>0 and o.attention_reason='PAYMENT_RECONCILIATION_REQUIRED' then
      update public.orders set attention_reason=null,fulfillment_status=case when refunded_paise>0 then 'held' else 'ready' end where id=o.id and order_status='confirmed' and exists(select 1 from public.inventory_reservations where order_id=o.id and status='committed');
    end if;
    if o.captured_paise=0 then
      -- Capture serializes with expiry/cancel on the order, then inventory by variant.
      perform i.variant_id from public.inventory i join public.inventory_reservations rr on rr.variant_id=i.variant_id where rr.order_id=o.id order by i.variant_id for update of i;
      if o.order_status='cancelled' or o.attention_reason='PAYMENT_MISMATCH' or exists(select 1 from public.inventory_reservations rr join public.inventory i on i.variant_id=rr.variant_id where rr.order_id=o.id and rr.status='released' and i.on_hand-i.reserved<rr.quantity) then ok:=false; end if;
      if ok then
        for r in select * from public.inventory_reservations where order_id=o.id order by variant_id for update loop
          if r.status<>'committed' then
            update public.inventory set on_hand=on_hand-r.quantity,reserved=reserved-case when r.status='held' then r.quantity else 0 end where variant_id=r.variant_id;
            update public.inventory_reservations set status='committed',committed_at=now(),released_at=null,reason='VERIFIED_CAPTURE' where id=r.id;
            insert into public.inventory_movements(variant_id,kind,on_hand_delta,reason,order_id,operation_key) values(r.variant_id,'sale',-r.quantity,'Verified payment capture',o.id,'capture:'||o.id||':'||r.variant_id);
          end if;
        end loop;
      end if;
      update public.orders set captured_paise=o.total_paise,order_status=case when ok then 'confirmed' else order_status end,fulfillment_status=case when ok then 'ready' else 'held' end,attention_reason=case when ok then null when o.attention_reason='PAYMENT_MISMATCH' then o.attention_reason else 'LATE_CAPTURE_REVIEW' end where id=o.id;
      -- Remove only the purchased snapshot once, preserving unrelated additions.
      delete from public.cart_items ci using public.order_items oi where oi.order_id=o.id and ci.cart_id=o.source_cart_id and ci.variant_id=oi.variant_id and ci.quantity<=oi.quantity;
      update public.cart_items ci set quantity=ci.quantity-oi.quantity from public.order_items oi where oi.order_id=o.id and ci.cart_id=o.source_cart_id and ci.variant_id=oi.variant_id;
      update public.carts set version=version+1 where id=o.source_cart_id;
      insert into public.notifications(order_id,type,channel,recipient,dedupe_key) values(o.id,'payment_received','email',o.customer_email,'payment-received:'||o.id) on conflict(dedupe_key) do nothing returning id into n;
      if n is not null then perform public.enqueue_job('notification.send','notification:'||n,jsonb_build_object('notificationId',n),8); end if;
    end if;
    -- Authoritative cumulative refunds are monotonic. Refunds never restock inventory.
    update public.orders set refunded_paise=greatest(refunded_paise,refunded),payment_status=case when greatest(refunded_paise,refunded)=total_paise then 'refunded' when greatest(refunded_paise,refunded)>0 then 'partially_refunded' else 'captured' end,
      fulfillment_status=case when refunded>0 and fulfillment_status in('ready','unfulfilled') then 'held' else fulfillment_status end,
      attention_reason=case when refunded>0 and attention_reason is null then 'REFUND_REVIEW' else attention_reason end where id=o.id;
    update public.payment_attempts set provider_payment_id=p_payment->>'id',status='captured',provider_status=incoming_status,last_checked_at=now(),safe_error=null where id=a.id;
  elsif o.captured_paise=0 and a.status<>'captured' then
    if incoming_status='authorized' then
      update public.orders set payment_status='authorized' where id=o.id;
      update public.payment_attempts set provider_payment_id=p_payment->>'id',status='authorized',provider_status=incoming_status,last_checked_at=now() where id=a.id;
    elsif a.status<>'authorized' then
      update public.payment_attempts set status=case when incoming_status='failed' then 'failed' else 'pending' end,provider_status=incoming_status,last_checked_at=now() where id=a.id;
    end if;
  end if;
end $$;

create function public.release_reservation(p_order_id uuid,p_provider_clear boolean,p_cancel boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; r public.inventory_reservations;
begin
  select * into o from public.orders where id=p_order_id for update;
  if o.id is null then raise exception 'NOT_FOUND'; end if;
  if o.captured_paise>0 then
    if p_cancel then update public.orders set fulfillment_status='held',attention_reason='REFUND_REVIEW' where id=o.id and fulfillment_status not in('shipped','delivered'); end if;
    return;
  end if;
  if not p_provider_clear or o.payment_status='authorized' then
    update public.orders set fulfillment_status='held',attention_reason=coalesce(attention_reason,'PAYMENT_RECONCILIATION_REQUIRED') where id=o.id;
    return;
  end if;
  if exists(select 1 from public.shipments where order_id=o.id and booking_status<>'cancelled') then raise exception 'CHECKOUT_IN_PROGRESS'; end if;
  if not p_cancel and exists(select 1 from public.inventory_reservations where order_id=o.id and status='held' and expires_at>now()) then return; end if;
  perform i.variant_id from public.inventory i join public.inventory_reservations rr on rr.variant_id=i.variant_id where rr.order_id=o.id order by i.variant_id for update of i;
  for r in select * from public.inventory_reservations where order_id=o.id and status='held' order by variant_id for update loop
    update public.inventory set reserved=reserved-r.quantity where variant_id=r.variant_id;
    update public.inventory_reservations set status='released',released_at=now(),reason=case when p_cancel then 'CUSTOMER_CANCEL' else 'EXPIRED_AFTER_RECONCILIATION' end where id=r.id;
  end loop;
  update public.orders set order_status=case when p_cancel then 'cancelled' else 'closed' end,fulfillment_status='cancelled',attention_reason=null where id=o.id;
end $$;

create function public.checkout_recover(p_order_number text,p_email text,p_token_hash text,p_user_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders; sid uuid;
begin
  -- Caller must have verified the email through Supabase (or explicit local fixture OTP).
  sid:=public.checkout_session(p_token_hash);
  select * into o from public.orders where order_number=p_order_number and customer_email=lower(btrim(p_email)) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_user_id is not null then
    if not exists(select 1 from auth.users where id=p_user_id and lower(email)=o.customer_email) then raise exception 'FORBIDDEN'; end if;
    update public.orders set customer_user_id=p_user_id where id=o.id;
  elsif not o.fixture then raise exception 'FORBIDDEN'; end if;
  insert into public.order_access_grants(order_id,guest_session_id) values(o.id,sid) on conflict do nothing;
  return o.id;
end $$;

-- Internal read/write gateway accepts named, closed operations chosen by trusted code.
create function public.checkout_internal(p_action text,p_id uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare notification_row public.notifications;
begin
  if p_action='due' then return coalesce((select jsonb_agg(id) from (select id from public.orders where next_payment_check_at<=now() and (captured_paise=0 or refunded_paise<captured_paise or attention_reason is not null) order by next_payment_check_at,id limit 50) x),'[]'::jsonb);
  elsif p_action='checked' then update public.orders set next_payment_check_at=now()+case when order_status='pending_payment' or attention_reason is not null then interval '1 minute' when captured_paise>0 then interval '15 minutes' else interval '1 hour' end where id=p_id; return '{}';
  elsif p_action='webhook' then return (select to_jsonb(w) from public.webhook_events w where id=p_id);
  elsif p_action='lookupPayment' then return (select to_jsonb(a) from public.payment_attempts a where provider_order_id=p_payload->>'providerOrderId' or provider_payment_id=p_payload->>'providerPaymentId' limit 1);
  elsif p_action='notification' then return (select to_jsonb(n)||jsonb_build_object('orderNumber',o.order_number,'totalPaise',o.total_paise,'fixture',o.fixture) from public.notifications n join public.orders o on o.id=n.order_id where n.id=p_id);
  elsif p_action='notificationStart' then update public.notifications set status='sending',first_attempt_at=coalesce(first_attempt_at,now()) where id=p_id and status not in('sent','unconfigured') returning * into notification_row; return to_jsonb(notification_row);
  elsif p_action='notificationFinish' then
    if p_payload->>'status' not in('sent','failed','unconfigured') then raise exception 'INVALID_PAYLOAD'; end if;
    update public.notifications set status=p_payload->>'status',provider_id=p_payload->>'providerId',safe_error=p_payload->>'error' where id=p_id and status<>'sent'; return '{}';
  elsif p_action='fixturePayment' then
    if not exists(select 1 from public.orders where id=p_id and fixture) or p_payload->>'state' not in('created','authorized','captured','failed','refunded') then raise exception 'FORBIDDEN'; end if;
    update public.payment_attempts set fixture_state=p_payload->>'state' where order_id=p_id and fixture_state not in('captured','refunded'); return '{}';
  elsif p_action='operation' then return (select jsonb_build_object('orderId',a.order_id,'operationId',op.id) from public.external_operations op join public.payment_attempts a on a.idempotency_operation_id=op.id where op.id=p_id);
  elsif p_action='attention' then
    if p_payload->>'reason' not in('PAYMENT_RECONCILIATION_REQUIRED','PAYMENT_MISMATCH','REFUND_REVIEW') then raise exception 'INVALID_PAYLOAD'; end if;
    update public.orders set attention_reason=case when p_payload->>'reason'='PAYMENT_RECONCILIATION_REQUIRED' then coalesce(attention_reason,p_payload->>'reason') else p_payload->>'reason' end,fulfillment_status='held' where id=p_id; return '{}';
  else raise exception 'INVALID_PAYLOAD'; end if;
end $$;

create function public.checkout_claim_jobs(p_limit integer default 5) returns setof public.jobs language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 10 then raise exception 'INVALID_PAYLOAD'; end if;
  perform public.reclaim_expired_jobs(100);
  perform public.reclaim_expired_operations(100);
  return query with ready as(select id from public.jobs where state in('queued','retry') and run_after<=now() and attempts<max_attempts and type in('payment.create','payment.reconcile','notification.send','webhook.process','webhook.reconcile') order by run_after,id for update skip locked limit p_limit)
  update public.jobs j set state='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),locked_until=now()+interval '300 seconds' from ready where j.id=ready.id returning j.*;
end $$;

create function public.checkout_admin_review(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.admin_memberships where user_id=p_actor and enabled) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'orders',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderNumber',order_number,'paymentStatus',payment_status,'fulfillmentStatus',fulfillment_status,'attentionReason',attention_reason,'totalPaise',total_paise,'capturedPaise',captured_paise,'refundedPaise',refunded_paise,'createdAt',created_at) order by created_at desc) from (select * from public.orders order by created_at desc limit 50) x),'[]'::jsonb),
    'operations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'error',last_error)) from public.external_operations where scope='checkout.create' and status in('unknown','failed')),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',type,'state',state,'error',last_error)) from (select * from public.jobs where state in('dead','retry') and type in('payment.create','payment.reconcile','notification.send','webhook.process','webhook.reconcile') order by updated_at desc limit 50) x),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderId',order_id,'status',status,'error',safe_error)) from (select * from public.notifications order by created_at desc limit 50) x),'[]'::jsonb));
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'checkout_%' or p.proname in('reserve_checkout','apply_verified_payment','release_reservation')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
