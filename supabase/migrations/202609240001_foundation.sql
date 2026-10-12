-- M1 foundation. Run as the trusted migration owner in a fresh Supabase project.
-- Browser roles receive no base-table writes: later business RPCs enforce transactions.
begin;
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create table public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','staff')), enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(), token_hash text not null unique check (length(token_hash) >= 64),
  expires_at timestamptz not null default (now() + interval '30 days'), revoked_at timestamptz,
  created_at timestamptz not null default now(), check (expires_at > created_at)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0), sort_order integer not null default 0 check (sort_order >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1 check (version > 0)
);
create table public.size_guides (
  id uuid primary key default gen_random_uuid(), title text not null, measurement_type text not null check (measurement_type in ('garment','body')),
  instructions text not null default '', values_cm jsonb not null,
  is_demo boolean not null default false, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(values_cm) = 'object' and jsonb_typeof(values_cm->'columns') = 'array' and jsonb_typeof(values_cm->'rows') = 'array' and values_cm ?& array['columns','rows'])
);
create table public.products (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) > 0), description text not null default '', category_id uuid not null references public.categories(id),
  tags text[] not null default '{}', status text not null default 'draft' check (status in ('draft','published','archived')),
  fit text not null default 'regular', material text, care text[] not null default '{}', size_guide_id uuid references public.size_guides(id),
  featured_rank integer not null default 0 check (featured_rank >= 0), published_at timestamptz, is_demo boolean not null default false,
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id), sku text not null unique check (length(btrim(sku)) > 0),
  color_key text not null check (color_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), color_label text not null, color_hex text check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  size text not null check (size in ('XS','S','M','L','XL','XXL','ONE_SIZE')),
  price_paise bigint not null check (price_paise between 0 and 9007199254740991), compare_at_paise bigint check (compare_at_paise <= 9007199254740991 and compare_at_paise > price_paise),
  tax_category_key text, unit_weight_g integer not null check (unit_weight_g > 0), enabled boolean not null default true,
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(product_id,color_key,size)
);
create table public.inventory (
  variant_id uuid primary key references public.product_variants(id), on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand), version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.media_assets (
  id uuid primary key default gen_random_uuid(), stage_key text not null unique, public_key text unique,
  type text not null check (type in ('image','video')), status text not null default 'uploading' check (status in ('uploading','validating','ready','publishing','published','rejected','deleting')),
  content_type text not null, size_bytes bigint not null check (size_bytes > 0), width integer check (width > 0), height integer check (height > 0),
  duration_seconds numeric check (duration_seconds > 0), poster_media_id uuid references public.media_assets(id), checksum text,
  alt text not null default '', focal_x numeric not null default 0.5 check (focal_x between 0 and 1), focal_y numeric not null default 0.5 check (focal_y between 0 and 1),
  source_details jsonb not null default '{}', license_details jsonb not null default '{}', uploaded_by uuid references auth.users(id), last_error text, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'published' or (public_key is not null and width is not null and height is not null)),
  check (public_key is null or (public_key !~ '(^/|\.\.|[?#])'))
);
create table public.product_media (
  product_id uuid not null references public.products(id), media_id uuid not null references public.media_assets(id),
  color_key text, sort_order integer not null default 0 check (sort_order >= 0), is_cover boolean not null default false,
  primary key (product_id,media_id), check (color_key is null or color_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create unique index product_media_one_cover on public.product_media(product_id,coalesce(color_key,'')) where is_cover;
create table public.collections (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), title text not null,
  description text not null default '', cover_media_id uuid references public.media_assets(id), active boolean not null default false, sort_order integer not null default 0 check (sort_order >= 0),
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.collection_products (
  collection_id uuid not null references public.collections(id), product_id uuid not null references public.products(id), sort_order integer not null default 0 check (sort_order >= 0),
  primary key (collection_id,product_id)
);
create table public.site_content (
  key text primary key, draft_payload jsonb not null default '{}', published_payload jsonb,
  schema_version integer not null default 1 check (schema_version > 0), version integer not null default 1 check (version > 0), published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(draft_payload) = 'object'), check (published_payload is null or (jsonb_typeof(published_payload) = 'object' and published_at is not null))
);
create table public.warehouse (
  id uuid primary key default gen_random_uuid(), name text not null, pickup_location text not null unique,
  contact jsonb not null, address jsonb not null, active boolean not null default false,
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(contact) = 'object' and jsonb_typeof(address) = 'object')
);
create unique index warehouse_one_active on public.warehouse(active) where active;
create table public.packaging_presets (
  id uuid primary key default gen_random_uuid(), label text not null, length_cm numeric not null check (length_cm > 0), width_cm numeric not null check (width_cm > 0), height_cm numeric not null check (height_cm > 0),
  tare_weight_g integer not null check (tare_weight_g > 0), max_contents_weight_g integer not null check (max_contents_weight_g > 0), max_items integer not null check (max_items > 0),
  priority integer not null default 0, active boolean not null default false, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.product_packaging (
  product_id uuid not null references public.products(id), preset_id uuid not null references public.packaging_presets(id), primary key (product_id,preset_id)
);
create table public.store_settings (
  key text primary key check (key !~* '(secret|password|credential|api_key|access_key|token)'), value jsonb not null,
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.carts (
  id uuid primary key default gen_random_uuid(), guest_session_id uuid not null references public.guest_sessions(id),
  version integer not null default 1 check (version > 0), currency text not null default 'INR' check (currency = 'INR'), expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open','converted','expired')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index carts_one_open_per_session on public.carts(guest_session_id) where status = 'open';
create table public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade, variant_id uuid not null references public.product_variants(id), quantity integer not null check (quantity > 0), primary key (cart_id,variant_id)
);
create table public.shipping_quotes (
  id uuid primary key default gen_random_uuid(), cart_id uuid not null references public.carts(id), cart_version integer not null check (cart_version > 0),
  address_fingerprint text not null, address_snapshot jsonb not null, warehouse_id uuid not null references public.warehouse(id), packaging_snapshot jsonb not null,
  eligible_services jsonb not null, selected_service_key text not null, courier_cost_paise bigint not null check (courier_cost_paise >= 0), shipping_fee_paise bigint not null check (shipping_fee_paise >= 0),
  item_subtotal_paise bigint not null check (item_subtotal_paise >= 0), tax_breakdown jsonb not null default '[]', total_paise bigint not null check (total_paise between 0 and 9007199254740991),
  currency text not null default 'INR' check (currency = 'INR'), pricing_version integer not null check (pricing_version > 0),
  expires_at timestamptz not null default (now() + interval '10 minutes'), status text not null default 'ready' check (status in ('ready','consumed','expired')),
  created_at timestamptz not null default now(), check (total_paise = item_subtotal_paise + shipping_fee_paise), check (expires_at > created_at)
);
create table public.orders (
  id uuid primary key default gen_random_uuid(), order_number text not null unique, guest_session_id uuid not null references public.guest_sessions(id), customer_user_id uuid references auth.users(id),
  customer_email text not null check (customer_email = lower(btrim(customer_email)) and customer_email like '%@%'), customer_phone text not null, shipping_address_snapshot jsonb not null,
  order_status text not null default 'pending_payment' check (order_status in ('pending_payment','confirmed','cancelled','closed')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','authorized','captured','partially_refunded','refunded')),
  fulfillment_status text not null default 'unfulfilled' check (fulfillment_status in ('unfulfilled','held','ready','shipped','delivered','cancelled','returned')), attention_reason text,
  currency text not null default 'INR' check (currency = 'INR'), items_payable_paise bigint not null check (items_payable_paise >= 0), shipping_fee_paise bigint not null check (shipping_fee_paise >= 0),
  tax_breakdown jsonb not null default '[]', total_paise bigint not null check (total_paise between 0 and 9007199254740991), captured_paise bigint not null default 0 check (captured_paise >= 0), refunded_paise bigint not null default 0 check (refunded_paise >= 0),
  quote_id uuid not null unique references public.shipping_quotes(id), source_cart_id uuid not null references public.carts(id), source_cart_version integer not null check (source_cart_version > 0),
  shipping_snapshot jsonb not null, packaging_snapshot jsonb not null, mode text not null check (mode in ('test','live')),
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (total_paise = items_payable_paise + shipping_fee_paise), check (refunded_paise <= captured_paise), check (captured_paise <= 9007199254740991)
);
create unique index orders_one_active_payment_cart on public.orders(source_cart_id) where order_status = 'pending_payment';
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), variant_id uuid references public.product_variants(id),
  product_title text not null, sku text not null, color text not null, size text not null check (size in ('XS','S','M','L','XL','XXL','ONE_SIZE')),
  quantity integer not null check (quantity > 0), unit_price_paise bigint not null check (unit_price_paise >= 0), line_payable_paise bigint not null check (line_payable_paise between 0 and 9007199254740991),
  tax_breakdown jsonb not null default '[]', unit_weight_g integer not null check (unit_weight_g > 0), image_key text, created_at timestamptz not null default now(),
  check (line_payable_paise = unit_price_paise * quantity)
);
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0), status text not null default 'held' check (status in ('held','committed','released')),
  expires_at timestamptz not null default (now() + interval '15 minutes'), committed_at timestamptz, released_at timestamptz, reason text,
  created_at timestamptz not null default now(), unique (order_id,variant_id),
  check ((status = 'held' and committed_at is null and released_at is null) or (status = 'committed' and committed_at is not null and released_at is null) or (status = 'released' and released_at is not null and committed_at is null))
);
create table public.external_operations (
  id uuid primary key default gen_random_uuid(), scope text not null, actor_or_session_key text not null, idempotency_key text not null, request_hash text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','unknown')), provider_reference text, result_json jsonb, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(scope,actor_or_session_key,idempotency_key)
);
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), provider_order_id text unique, provider_payment_id text unique,
  status text not null default 'creating' check (status in ('creating','pending','authorized','captured','failed','unknown')),
  amount_paise bigint not null check (amount_paise between 0 and 9007199254740991), currency text not null default 'INR' check (currency = 'INR'),
  provider_status text, last_checked_at timestamptz, safe_error text, idempotency_operation_id uuid not null references public.external_operations(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.fulfillment_quotes (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), order_version integer not null check (order_version > 0), parcel_fingerprint text not null,
  warehouse_id uuid not null references public.warehouse(id), actual_parcel_snapshot jsonb not null, courier_id text not null, courier_service text not null,
  quoted_cost_paise bigint not null check (quoted_cost_paise >= 0), estimated_delivery_at timestamptz, provider_quote_payload jsonb not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'), status text not null default 'ready' check (status in ('ready','consumed','expired')),
  created_at timestamptz not null default now(), check (expires_at > created_at)
);
create table public.return_requests (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), status text not null default 'requested' check (status in ('requested','approved','rejected','pickup_pending','in_transit','received','inspected','closed')),
  reason text not null, requested_at timestamptz not null default now(), reviewed_by uuid references auth.users(id), inspection_notes text,
  version integer not null default 1 check (version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.return_items (
  id uuid primary key default gen_random_uuid(), return_request_id uuid not null references public.return_requests(id), order_item_id uuid not null references public.order_items(id),
  quantity integer not null check (quantity > 0), accepted_quantity integer not null default 0 check (accepted_quantity >= 0 and accepted_quantity <= quantity),
  restock_quantity integer not null default 0 check (restock_quantity >= 0 and restock_quantity <= accepted_quantity), disposition text check (disposition in ('pending','sellable','damaged','discard')),
  unique(return_request_id,order_item_id)
);
create table public.shipments (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), fulfillment_quote_id uuid references public.fulfillment_quotes(id),
  direction text not null check (direction in ('forward','return')), return_request_id uuid references public.return_requests(id), provider text not null default 'shiprocket' check (provider = 'shiprocket'),
  provider_order_id text unique, provider_shipment_id text unique, courier_id text, courier_name text, awb text unique,
  booking_status text not null default 'not_started' check (booking_status in ('not_started','creating','created','awb_assigned','unknown','failed','cancelled')),
  pickup_status text not null default 'not_requested' check (pickup_status in ('not_requested','requested','scheduled','failed','picked_up')),
  transit_status text not null default 'not_shipped' check (transit_status in ('not_shipped','in_transit','out_for_delivery','delivered','exception','rto_in_transit','rto_delivered','cancelled')),
  actual_weight_g integer not null check (actual_weight_g > 0), length_cm numeric not null check (length_cm > 0), width_cm numeric not null check (width_cm > 0), height_cm numeric not null check (height_cm > 0),
  quoted_cost_paise bigint not null check (quoted_cost_paise >= 0), final_cost_paise bigint check (final_cost_paise >= 0), estimated_delivery_at timestamptz,
  private_label_key text, provider_status text, provider_updated_at timestamptz, last_synced_at timestamptz, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check ((direction = 'forward' and return_request_id is null) or (direction = 'return' and return_request_id is not null))
);
create unique index shipments_one_forward on public.shipments(order_id) where direction = 'forward' and booking_status <> 'cancelled';
create table public.shipment_events (
  id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments(id), provider text not null default 'shiprocket', environment text not null check (environment in ('test','live')),
  provider_event_key text, raw_status text not null, normalized_status text not null, occurred_at timestamptz not null, received_at timestamptz not null default now(), source text not null, sanitized_details jsonb not null default '{}',
  unique(provider,environment,provider_event_key)
);
create table public.refunds (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), payment_attempt_id uuid not null references public.payment_attempts(id), return_request_id uuid references public.return_requests(id),
  amount_paise bigint not null check (amount_paise between 1 and 9007199254740991), status text not null default 'requested' check (status in ('requested','processing','processed','failed','unknown')),
  provider_refund_id text unique, reason text not null, requested_by uuid not null references auth.users(id), operation_key text not null unique,
  processed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (status <> 'processed' or processed_at is not null)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), variant_id uuid not null references public.product_variants(id), kind text not null check (kind in ('receive','adjust','sale','restock')),
  on_hand_delta integer not null check (on_hand_delta <> 0), reason text not null check (length(btrim(reason)) > 0), actor_user_id uuid references auth.users(id),
  order_id uuid references public.orders(id), return_item_id uuid references public.return_items(id), operation_key text not null unique, created_at timestamptz not null default now(),
  check ((kind in ('receive','restock') and on_hand_delta > 0) or (kind = 'sale' and on_hand_delta < 0) or kind = 'adjust')
);
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(), provider text not null, environment text not null check (environment in ('test','live')),
  provider_event_id text, dedupe_hash text, dedupe_key text not null, received_at timestamptz not null default now(),
  verification_result text not null check (verification_result in ('verified','rejected','hint')), payload jsonb not null default '{}',
  processing_status text not null default 'pending' check (processing_status in ('pending','processing','processed','failed','ignored')),
  attempts integer not null default 0 check (attempts >= 0), error text, unique(provider,environment,dedupe_key),
  check (provider_event_id is not null or dedupe_hash is not null)
);
create table public.jobs (
  id uuid primary key default gen_random_uuid(), type text not null, dedupe_key text not null unique, payload jsonb not null default '{}',
  state text not null default 'queued' check (state in ('queued','running','retry','done','dead')), run_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0), max_attempts integer not null default 5 check (max_attempts between 1 and 25),
  locked_until timestamptz, lease_token uuid, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), type text not null, channel text not null check (channel = 'email'), recipient text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','unconfigured')), provider_id text, dedupe_key text not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid references auth.users(id), actor text not null, action text not null,
  entity_type text not null, entity_id text, diff jsonb not null default '{}', reason text, request_id text, created_at timestamptz not null default now()
);

-- Query-driven indexes; unique constraints already provide their own indexes.
create index products_public_listing on public.products(category_id,featured_rank,published_at desc,id) where status = 'published';
create index product_variants_product on public.product_variants(product_id,color_key,size) where enabled;
create index collection_products_order on public.collection_products(collection_id,sort_order,product_id);
create index product_media_order on public.product_media(product_id,sort_order,media_id);
create index orders_email_time on public.orders(customer_email,created_at desc);
create index orders_customer_time on public.orders(customer_user_id,created_at desc) where customer_user_id is not null;
create index orders_session_time on public.orders(guest_session_id,created_at desc);
create index orders_operations on public.orders(payment_status,fulfillment_status,created_at desc);
create index orders_attention on public.orders(created_at) where attention_reason is not null;
create index order_items_order on public.order_items(order_id);
create index jobs_due on public.jobs(state,run_after,id) where state in ('queued','retry','running');
create index reservations_expiry on public.inventory_reservations(status,expires_at);
create index reservations_variant on public.inventory_reservations(variant_id) where status = 'held';
create index shipments_sync on public.shipments(last_synced_at) where transit_status not in ('delivered','rto_delivered','cancelled');
create index shipments_order on public.shipments(order_id);
create index shipment_events_timeline on public.shipment_events(shipment_id,occurred_at,received_at);
create index payment_attempts_order on public.payment_attempts(order_id,created_at desc);
create index returns_order on public.return_requests(order_id);
create index return_items_order_item on public.return_items(order_item_id);
create index refunds_order_status on public.refunds(order_id,status);
create index movements_variant_time on public.inventory_movements(variant_id,created_at desc);
create index external_operations_status on public.external_operations(status,created_at);
create index webhook_events_pending on public.webhook_events(processing_status,received_at);
create index audit_logs_entity on public.audit_logs(entity_type,entity_id,created_at desc);

-- Every check reads the current membership; JWT user metadata is never a role source.
create function public.has_admin_role(required_role text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.enabled
    and (required_role is null or m.role = required_role));
$$;
revoke all on function public.has_admin_role(text) from public, anon, authenticated;
grant execute on function public.has_admin_role(text) to authenticated, service_role;

-- Updating a mutable entity always advances its concurrency token.
create function public.touch_entity() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'version' then new := jsonb_populate_record(new, jsonb_build_object('version', (to_jsonb(old)->>'version')::integer + 1)); end if;
  return new;
end $$;
create function public.reject_history_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Append-only history cannot be updated or deleted' using errcode = '23514'; end $$;
revoke all on function public.touch_entity(), public.reject_history_mutation() from public, anon, authenticated, service_role;

do $$ declare table_name text; begin
  foreach table_name in array array['admin_memberships','categories','size_guides','products','product_variants','inventory','media_assets','collections','site_content','warehouse','packaging_presets','store_settings','carts','orders','external_operations','payment_attempts','return_requests','shipments','refunds','jobs','notifications'] loop
    execute format('create trigger touch_entity before update on public.%I for each row execute function public.touch_entity()',table_name);
  end loop;
  foreach table_name in array array['inventory_movements','audit_logs','shipment_events','order_items'] loop
    execute format('create trigger append_only before update or delete on public.%I for each row execute function public.reject_history_mutation()',table_name);
  end loop;
end $$;

-- A colour-specific attachment must match a product variant. This is deferred so a
-- single trusted transaction may create its variants and media in either order.
create function public.check_product_media_color() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.product_media pm where pm.color_key is not null and not exists
    (select 1 from public.product_variants v where v.product_id = pm.product_id and v.color_key = pm.color_key)) then
    raise exception 'Media colour must match a product variant' using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function public.check_product_media_color() from public, anon, authenticated, service_role;
create constraint trigger product_media_valid_color after insert or update on public.product_media deferrable initially deferred for each row execute function public.check_product_media_color();
create constraint trigger variant_retains_media_color after update or delete on public.product_variants deferrable initially deferred for each row execute function public.check_product_media_color();

-- No browser can read a guest capability hash or write base tables. Server code
-- must authorize before using service_role. Future transactional RPCs stay restricted.
do $$ declare table_name text; begin
  for table_name in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated',table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role',table_name);
  end loop;
  foreach table_name in array array['categories','size_guides','products','product_variants','inventory','media_assets','product_media','collections','collection_products','site_content','product_packaging','orders','order_items','inventory_reservations','payment_attempts','fulfillment_quotes','return_requests','return_items','shipments','shipment_events','refunds','inventory_movements','external_operations','webhook_events','jobs','notifications','audit_logs'] loop
    execute format('grant select on table public.%I to authenticated',table_name);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.has_admin_role()))',table_name);
  end loop;
  foreach table_name in array array['warehouse','packaging_presets','store_settings'] loop
    execute format('grant select on table public.%I to authenticated',table_name);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select public.has_admin_role(''owner'')))',table_name);
  end loop;
end $$;
grant select on public.admin_memberships to authenticated;
create policy membership_read on public.admin_memberships for select to authenticated using (user_id = (select auth.uid()) or (select public.has_admin_role('owner')));
create policy customer_order_read on public.orders for select to authenticated using (customer_user_id = (select auth.uid()));
create policy customer_order_items_read on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id = order_items.order_id and o.customer_user_id = (select auth.uid())));

-- The only public read entry is an explicit allowlist. No definer views or raw-row
-- JSON projections expose drafts, stock counts, weights, private keys or provider data.
create function public.public_catalog() returns jsonb language sql stable security definer set search_path = '' as $$
with visible_products as (
  select p.* from public.products p join public.categories c on c.id = p.category_id and c.active where p.status = 'published'
), visible_media as (
  select m.* from public.media_assets m where m.status = 'published' and m.public_key is not null
)
select jsonb_build_object(
  'categories', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,'sortOrder',c.sort_order) order by c.sort_order,c.id) from public.categories c where c.active),'[]'::jsonb),
  'products', coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'slug',p.slug,'title',p.title,'description',p.description,'categoryId',p.category_id,'tags',p.tags,'fit',p.fit,'material',p.material,'care',p.care,
    'sizeGuideId',p.size_guide_id,'featuredRank',p.featured_rank,'publishedAt',to_char(p.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'isDemo',p.is_demo,
    'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'colorKey',v.color_key,'colorLabel',v.color_label,'colorHex',v.color_hex,'size',v.size,
      'pricePaise',v.price_paise,'compareAtPaise',v.compare_at_paise,'available',coalesce(i.on_hand > i.reserved,false)) order by v.color_key,v.size,v.id)
      from public.product_variants v left join public.inventory i on i.variant_id = v.id where v.product_id = p.id and v.enabled),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'publicKey',m.public_key,'type',m.type,'contentType',m.content_type,'width',m.width,'height',m.height,
      'alt',m.alt,'colorKey',pm.color_key,'sortOrder',pm.sort_order,'isCover',pm.is_cover) order by pm.sort_order,m.id)
      from public.product_media pm join visible_media m on m.id = pm.media_id where pm.product_id = p.id),'[]'::jsonb)
    ) order by p.featured_rank,p.id) from visible_products p),'[]'::jsonb),
  'collections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'title',c.title,'description',c.description,
    'coverMediaId',(select m.id from visible_media m where m.id = c.cover_media_id),'sortOrder',c.sort_order,
    'productIds',coalesce((select jsonb_agg(cp.product_id order by cp.sort_order,cp.product_id) from public.collection_products cp join visible_products p on p.id = cp.product_id where cp.collection_id = c.id),'[]'::jsonb)) order by c.sort_order,c.id)
    from public.collections c where c.active),'[]'::jsonb),
  'sizeGuides',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'measurementType',g.measurement_type,'instructions',g.instructions,'valuesCm',g.values_cm,'isDemo',g.is_demo) order by g.id)
    from public.size_guides g where exists(select 1 from visible_products p where p.size_guide_id = g.id)),'[]'::jsonb)
);
$$;
revoke all on function public.public_catalog() from public, anon, authenticated;
grant execute on function public.public_catalog() to anon, authenticated, service_role;

commit;
