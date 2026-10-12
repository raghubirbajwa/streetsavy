begin;

-- Guest capabilities and cart writes are available only through the trusted server.
-- Prices and availability are resolved on every call; a cart never reserves stock.
create function public.guest_cart_empty() returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',null,'version',0,'currency','INR','lines','[]'::jsonb,'itemCount',0,'subtotalPaise',0,'hasUnavailableItems',false,'pendingCheckout',null)
$$;

create function public.guest_cart_resolve(p_cart_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cart public.carts; v_lines jsonb; v_count integer; v_subtotal numeric; v_unavailable boolean; v_pending jsonb;
begin
  select * into v_cart from public.carts where id=p_cart_id;
  if not found then return public.guest_cart_empty(); end if;
  with resolved as (
    select ci.variant_id,ci.quantity,v.product_id,v.color_key,v.color_label,v.size,
      case when p.status='published' and c.active then p.slug else null end as slug,
      case when p.status='published' and c.active then p.title else 'Unavailable item' end as title,
      case when p.status='published' and c.active and v.enabled then v.price_paise else null end as price,
      case when p.status<>'published' or not c.active then 'product_unavailable'
        when not v.enabled then 'variant_unavailable'
        when coalesce(i.on_hand-i.reserved,0)<=0 then 'out_of_stock'
        when coalesce(i.on_hand-i.reserved,0)<ci.quantity then 'insufficient_stock' else null end as reason,
      case when p.status='published' and c.active then (
        select jsonb_build_object('publicKey',m.public_key,'alt',m.alt,'width',m.width,'height',m.height)
        from public.product_media pm join public.media_assets m on m.id=pm.media_id
        where pm.product_id=p.id and m.status='published' and m.type='image' and (pm.color_key=v.color_key or pm.color_key is null)
        order by (pm.color_key=v.color_key) desc nulls last,pm.is_cover desc,pm.sort_order,m.id limit 1
      ) else null end as image
    from public.cart_items ci join public.product_variants v on v.id=ci.variant_id
      join public.products p on p.id=v.product_id join public.categories c on c.id=p.category_id
      left join public.inventory i on i.variant_id=v.id where ci.cart_id=p_cart_id
  ) select coalesce(jsonb_agg(jsonb_build_object(
      'variantId',variant_id,'productId',product_id,'slug',slug,'title',title,'colorKey',color_key,'colorLabel',color_label,'size',size,
      'quantity',quantity,'unitPricePaise',price,'lineSubtotalPaise',coalesce(price::numeric*quantity,0),'available',reason is null,'unavailableReason',reason,'image',image
    ) order by variant_id),'[]'::jsonb),coalesce(sum(quantity),0)::integer,coalesce(sum(price::numeric*quantity),0),coalesce(bool_or(reason is not null),false)
    into v_lines,v_count,v_subtotal,v_unavailable from resolved;
  if v_subtotal>9007199254740991 then raise exception 'INVALID_PAYLOAD'; end if;
  select jsonb_build_object('orderId',id,'status','pending_payment','href','/orders/'||id::text) into v_pending
    from public.orders where source_cart_id=p_cart_id and guest_session_id=v_cart.guest_session_id and order_status='pending_payment' order by created_at,id limit 1;
  return jsonb_build_object('id',v_cart.id,'version',v_cart.version,'currency',v_cart.currency,'lines',v_lines,'itemCount',v_count,
    'subtotalPaise',v_subtotal,'hasUnavailableItems',v_unavailable,'pendingCheckout',v_pending);
end $$;

create function public.guest_cart(p_action text,p_token_hash text,p_new_token_hash text default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.guest_sessions; v_cart public.carts; v_created boolean:=false; v_variant uuid; v_quantity integer; v_previous integer;
  v_version integer; v_available integer; v_product_status text; v_enabled boolean; v_category_active boolean; v_price bigint; v_result jsonb;
begin
  if p_action not in ('get','create','add','set','remove') or p_action is null or p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$'
    or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD'; end if;
  if p_action in ('get','create') and p_payload<>'{}'::jsonb then raise exception 'INVALID_PAYLOAD'; end if;
  select * into v_session from public.guest_sessions where token_hash=p_token_hash and revoked_at is null and expires_at>now() for update;
  if not found then
    if p_action<>'create' then return jsonb_build_object('cart',public.guest_cart_empty()) || case when p_action='get' then '{}'::jsonb else '{"error":"SESSION_REQUIRED"}'::jsonb end; end if;
    if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PAYLOAD'; end if;
    insert into public.guest_sessions(token_hash) values(p_new_token_hash) returning * into v_session;
    v_created:=true;
  end if;
  select * into v_cart from public.carts where guest_session_id=v_session.id and status='open' for update;
  if found and v_cart.expires_at<=now() then
    if p_action='create' then update public.carts set status='expired' where id=v_cart.id; end if;
    v_cart:=null;
  end if;
  if v_cart.id is null then
    if p_action='create' then insert into public.carts(guest_session_id,expires_at) values(v_session.id,v_session.expires_at) returning * into v_cart;
    else return jsonb_build_object('cart',public.guest_cart_empty()) || case when p_action='get' then '{}'::jsonb else '{"error":"SESSION_REQUIRED"}'::jsonb end; end if;
  end if;
  if p_action in ('get','create') then return jsonb_build_object('cart',public.guest_cart_resolve(v_cart.id),'sessionExpiresAt',v_session.expires_at,'createdSession',v_created); end if;
  if p_payload - array['variantId','quantity','cartVersion'] <> '{}'::jsonb
    or jsonb_typeof(p_payload->'cartVersion') is distinct from 'number' or (p_payload->>'cartVersion') !~ '^[1-9][0-9]{0,9}$'
    or (p_payload->>'cartVersion')::numeric>2147483647 or jsonb_typeof(p_payload->'variantId') is distinct from 'string'
    or (p_payload->>'variantId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_action='remove' and p_payload ? 'quantity'
    or p_action<>'remove' and (jsonb_typeof(p_payload->'quantity') is distinct from 'number' or (p_payload->>'quantity') !~ '^([1-9]|10)$')
    then raise exception 'INVALID_PAYLOAD'; end if;
  v_variant:=(p_payload->>'variantId')::uuid; v_version:=(p_payload->>'cartVersion')::integer;
  v_result:=public.guest_cart_resolve(v_cart.id);
  if v_result->'pendingCheckout'<>'null'::jsonb then return jsonb_build_object('error','CHECKOUT_IN_PROGRESS','cart',v_result); end if;
  if v_version<>v_cart.version then return jsonb_build_object('error','VERSION_CONFLICT','cart',v_result); end if;
  select quantity into v_previous from public.cart_items where cart_id=v_cart.id and variant_id=v_variant;
  if p_action='remove' then
    if v_previous is null then return jsonb_build_object('error','NOT_FOUND','cart',v_result); end if;
    delete from public.cart_items where cart_id=v_cart.id and variant_id=v_variant;
  else
    v_quantity:=(p_payload->>'quantity')::integer + case when p_action='add' then coalesce(v_previous,0) else 0 end;
    if p_action='set' and v_previous is null then return jsonb_build_object('error','NOT_FOUND','cart',v_result); end if;
    if v_quantity>10 then return jsonb_build_object('error','QUANTITY_LIMIT','cart',v_result); end if;
    if v_previous is null and jsonb_array_length(v_result->'lines')>=50 then return jsonb_build_object('error','CART_LIMIT','cart',v_result); end if;
    select p.status,v.enabled,c.active,coalesce(i.on_hand-i.reserved,0),v.price_paise into v_product_status,v_enabled,v_category_active,v_available,v_price
      from public.product_variants v join public.products p on p.id=v.product_id join public.categories c on c.id=p.category_id
      left join public.inventory i on i.variant_id=v.id where v.id=v_variant;
    if not found or v_product_status<>'published' or not v_enabled or not v_category_active then return jsonb_build_object('error','PRODUCT_UNAVAILABLE','cart',v_result); end if;
    if v_available<=0 then return jsonb_build_object('error','OUT_OF_STOCK','cart',v_result); end if;
    if v_available<v_quantity then return jsonb_build_object('error','STOCK_CONFLICT','cart',v_result); end if;
    if (v_result->>'subtotalPaise')::numeric+v_price::numeric*(v_quantity-coalesce(v_previous,0))>9007199254740991 then return jsonb_build_object('error','INVALID_PAYLOAD','cart',v_result); end if;
    insert into public.cart_items(cart_id,variant_id,quantity) values(v_cart.id,v_variant,v_quantity)
      on conflict(cart_id,variant_id) do update set quantity=excluded.quantity;
  end if;
  update public.carts set updated_at=now() where id=v_cart.id;
  update public.shipping_quotes set status='expired' where cart_id=v_cart.id and status='ready';
  return jsonb_build_object('cart',public.guest_cart_resolve(v_cart.id));
end $$;

revoke all on function public.guest_cart_empty(),public.guest_cart_resolve(uuid),public.guest_cart(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.guest_cart(text,text,text,jsonb) to service_role;
commit;
