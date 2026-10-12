-- M5 one-parcel forward dispatch. All business mutations lock order before shipment.
begin;
alter table public.shipments add column fixture boolean not null default false, add column next_sync_at timestamptz not null default now(), add column fixture_controls jsonb not null default '{}';
create table public.shipping_operations(operation_id uuid primary key references public.external_operations(id),shipment_id uuid not null references public.shipments(id),action text not null check(action in('create','assign-awb','label','pickup','cancel','sync')));
create table public.shipping_private_labels(shipment_id uuid primary key references public.shipments(id),content_base64 text not null check(length(content_base64) between 1 and 7000000),created_at timestamptz not null default now());
create table public.shipping_fixture_controls(order_id uuid primary key references public.orders(id),controls jsonb not null default '{}');
alter table public.shipping_operations enable row level security;
alter table public.shipping_private_labels enable row level security;
alter table public.shipping_fixture_controls enable row level security;
revoke all on public.shipping_operations,public.shipping_private_labels,public.shipping_fixture_controls from public,anon,authenticated;
grant all on public.shipping_operations,public.shipping_private_labels,public.shipping_fixture_controls to service_role;
create index shipping_operations_shipment on public.shipping_operations(shipment_id,action);
create index shipments_due on public.shipments(next_sync_at);

create function public.shipping_eligible(p_order public.orders) returns void language plpgsql set search_path='' as $$
begin
 if p_order.order_status<>'confirmed' or p_order.payment_status not in('captured','partially_refunded') or p_order.captured_paise<>p_order.total_paise or p_order.refunded_paise>=p_order.captured_paise or p_order.fulfillment_status<>'ready' or p_order.attention_reason is not null or exists(select 1 from public.refunds where order_id=p_order.id and status in('requested','processing','unknown')) or exists(select 1 from public.provider_refund_observations where order_id=p_order.id and status='pending') or not exists(select 1 from public.inventory_reservations where order_id=p_order.id and status='committed') or exists(select 1 from public.inventory_reservations where order_id=p_order.id and status<>'committed') then raise exception 'DISPATCH_INELIGIBLE'; end if;
end; $$;
create function public.shipping_json(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'orderId',s.order_id,'version',s.version,'bookingStatus',s.booking_status,'pickupStatus',s.pickup_status,'transitStatus',s.transit_status,'awb',s.awb,'courierName',s.courier_name,'costPaise',coalesce(s.final_cost_paise,s.quoted_cost_paise),'parcel',jsonb_build_object('weightG',s.actual_weight_g,'lengthCm',s.length_cm,'widthCm',s.width_cm,'heightCm',s.height_cm),'labelReady',s.private_label_key is not null,'lastSyncedAt',s.last_synced_at,'fixture',s.fixture,
 'operations',coalesce((select jsonb_agg(jsonb_build_object('id',op.id,'action',m.action,'status',op.status,'attempts',op.attempts,'error',op.last_error) order by op.created_at) from public.shipping_operations m join public.external_operations op on op.id=m.operation_id where m.shipment_id=s.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'status',e.normalized_status,'rawStatus',e.raw_status,'occurredAt',e.occurred_at,'source',e.source) order by e.occurred_at,e.received_at) from public.shipment_events e where e.shipment_id=s.id),'[]'::jsonb)) from public.shipments s where s.id=p_id;
$$;
create function public.shipping_context(p_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; w public.warehouse;
begin
 select * into o from public.orders where id=p_order_id; if not found then raise exception 'NOT_FOUND'; end if;
 select * into w from public.warehouse where active;
 return jsonb_build_object('order',to_jsonb(o),'warehouse',to_jsonb(w),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb));
end; $$;
create function public.shipping_admin(p_actor uuid,p_action text,p_id uuid,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; s public.shipments; q public.fulfillment_quotes; op public.external_operations; other_op public.external_operations; w public.warehouse; item jsonb; parcel jsonb; result jsonb:='[]'; target uuid; act text; hashed text; minimum_weight integer; actual_sides numeric[]; approved_sides numeric[];
begin
 perform public.require_admin_actor(p_actor);
 if p_action in('context','quotes','book','forOrder','fixtureOrder') then target:=p_id; else select order_id into target from public.shipments where id=p_id; end if;
 select * into o from public.orders where id=target for update; if not found then raise exception 'NOT_FOUND'; end if;
 if p_action='forOrder' then return coalesce((select jsonb_agg(public.shipping_json(id) order by created_at) from public.shipments where order_id=o.id),'[]'); end if;
 if p_action='context' then perform public.shipping_eligible(o); return public.shipping_context(o.id); end if;
 if p_action='fixtureOrder' then if not o.fixture then raise exception 'FORBIDDEN'; end if; insert into public.shipping_fixture_controls(order_id,controls) values(o.id,jsonb_build_object('createTimeout',true)) on conflict(order_id) do update set controls=excluded.controls; perform public.record_audit(p_actor::text,'shipping.fixture','order',o.id::text,jsonb_build_object('createTimeout',true),null,null,p_actor); return '{}'; end if;
 if p_action='quotes' then
  perform public.shipping_eligible(o);
  if o.version<>(p_data->>'orderVersion')::integer then raise exception 'VERSION_CONFLICT'; end if;
  select * into w from public.warehouse where active for share; if not found or to_jsonb(w) is distinct from p_data->'warehouse' then raise exception 'QUOTE_STALE'; end if;
  parcel:=p_data->'parcel'; select sum(quantity*unit_weight_g)::integer+coalesce((o.packaging_snapshot->>'tare_weight_g')::integer,0) into minimum_weight from public.order_items where order_id=o.id;
  if jsonb_typeof(parcel)<>'object' or not(parcel ?& array['weightG','lengthCm','widthCm','heightCm']) or (parcel->>'weightG')::integer<minimum_weight or (parcel->>'weightG')::integer>500000 or (parcel->>'lengthCm')::numeric not between 0.1 and 300 or (parcel->>'widthCm')::numeric not between 0.1 and 300 or (parcel->>'heightCm')::numeric not between 0.1 and 300 then raise exception 'PACKAGING_UNSUPPORTED'; end if;
  select array_agg(v order by v) into actual_sides from unnest(array[(parcel->>'lengthCm')::numeric,(parcel->>'widthCm')::numeric,(parcel->>'heightCm')::numeric]) v;
  select array_agg(v order by v) into approved_sides from unnest(array[(o.packaging_snapshot->>'length_cm')::numeric,(o.packaging_snapshot->>'width_cm')::numeric,(o.packaging_snapshot->>'height_cm')::numeric]) v;
  if actual_sides[1]<approved_sides[1] or actual_sides[2]<approved_sides[2] or actual_sides[3]<approved_sides[3] then raise exception 'PACKAGING_UNSUPPORTED'; end if;
  if jsonb_array_length(p_data->'quotes') not between 1 and 30 then raise exception 'UNSERVICEABLE_PIN'; end if;
  for item in select value from jsonb_array_elements(p_data->'quotes') loop
   if length(item->>'courierId') not between 1 and 100 or length(item->>'courierName') not between 1 and 150 or (item->>'costPaise')::bigint<0 then raise exception 'INVALID_PAYLOAD'; end if;
   insert into public.fulfillment_quotes(order_id,order_version,parcel_fingerprint,warehouse_id,actual_parcel_snapshot,courier_id,courier_service,quoted_cost_paise,provider_quote_payload) values(o.id,o.version,md5(parcel::text),w.id,parcel,item->>'courierId',item->>'courierName',(item->>'costPaise')::bigint,jsonb_build_object('warehouseVersion',w.version,'warehouse',to_jsonb(w))) returning * into q;
   result:=result||jsonb_build_array(jsonb_build_object('id',q.id,'courierId',q.courier_id,'courierName',q.courier_service,'costPaise',q.quoted_cost_paise,'expiresAt',q.expires_at,'parcel',parcel));
  end loop;
  perform public.record_audit(p_actor::text,'shipping.quote','order',o.id::text,jsonb_build_object('parcel',parcel),null,null,p_actor);
  return jsonb_build_object('quotes',result,'orderVersion',o.version);
 end if;
 if p_action='book' then
  hashed:=md5((p_data->>'shippingQuoteId')||':'||(p_data->>'orderVersion'))||md5('quote:'||(p_data->>'shippingQuoteId')||':'||(p_data->>'orderVersion'));
  select * into op from public.external_operations where scope='shipping.create' and actor_or_session_key=o.id::text and idempotency_key=p_data->>'key';
  if found then if op.request_hash<>hashed then raise exception 'IDEMPOTENCY_CONFLICT'; end if; select shipment_id into target from public.shipping_operations where operation_id=op.id; return jsonb_build_object('shipmentId',target,'operationId',op.id); end if;
  perform public.shipping_eligible(o);
  if o.version<>(p_data->>'orderVersion')::integer then raise exception 'VERSION_CONFLICT'; end if;
  if exists(select 1 from public.shipments where order_id=o.id and direction='forward' and booking_status<>'cancelled') then raise exception 'SHIPMENT_EXISTS'; end if;
  select * into q from public.fulfillment_quotes where id=(p_data->>'shippingQuoteId')::uuid and order_id=o.id for update;
  if not found or q.status<>'ready' or q.expires_at<=now() or q.order_version<>o.version then raise exception 'QUOTE_STALE'; end if;
  select * into w from public.warehouse where id=q.warehouse_id and active for share;
  if not found or w.version<>(q.provider_quote_payload->>'warehouseVersion')::integer then raise exception 'QUOTE_STALE'; end if;
  insert into public.shipments(order_id,fulfillment_quote_id,direction,courier_id,courier_name,booking_status,actual_weight_g,length_cm,width_cm,height_cm,quoted_cost_paise,fixture,fixture_controls) values(o.id,q.id,'forward',q.courier_id,q.courier_service,'creating',(q.actual_parcel_snapshot->>'weightG')::int,(q.actual_parcel_snapshot->>'lengthCm')::numeric,(q.actual_parcel_snapshot->>'widthCm')::numeric,(q.actual_parcel_snapshot->>'heightCm')::numeric,q.quoted_cost_paise,o.fixture or o.mode='test',coalesce((select controls from public.shipping_fixture_controls where order_id=o.id),'{}')) returning * into s;
  op:=public.begin_operation('shipping.create',o.id::text,p_data->>'key',hashed);
  insert into public.shipping_operations values(op.id,s.id,'create');
  update public.fulfillment_quotes set status='consumed' where id=q.id;
  update public.orders set version=version+1,updated_at=now() where id=o.id;
  perform public.enqueue_job('shipping.operation','shipping-operation:'||op.id,jsonb_build_object('operationId',op.id),8);
  perform public.record_audit(p_actor::text,'shipping.create','shipment',s.id::text,jsonb_build_object('orderId',o.id,'quoteId',q.id),null,null,p_actor);
  return jsonb_build_object('shipmentId',s.id,'operationId',op.id);
 end if;
 select * into s from public.shipments where id=p_id for update;
 if p_action='detail' then return public.shipping_json(s.id); end if;
 if p_action='label' then return jsonb_build_object('contentBase64',(select content_base64 from public.shipping_private_labels where shipment_id=s.id)); end if;
 if p_action='fixture' then
  if not s.fixture then raise exception 'FORBIDDEN'; end if;
  update public.shipments set fixture_controls=fixture_controls||p_data,version=version+1 where id=s.id;
  perform public.record_audit(p_actor::text,'shipping.fixture','shipment',s.id::text,p_data,null,null,p_actor);
  return public.shipping_json(s.id);
 end if;
 if p_action<>'reserve' then raise exception 'INVALID_PAYLOAD'; end if;
 act:=p_data->>'action'; if act not in('assign-awb','label','pickup','cancel','sync') then raise exception 'INVALID_PAYLOAD'; end if;
 hashed:=md5(s.id::text||act||':'||(p_data->>'version'))||md5(act||s.id::text||':'||(p_data->>'version'));
 select eo.* into op from public.external_operations eo where scope='shipping.'||replace(act,'-','_') and actor_or_session_key=s.id::text and idempotency_key=p_data->>'key';
 if found then if op.request_hash<>hashed then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return jsonb_build_object('operationId',op.id,'shipmentId',s.id); end if;
 if s.version<>(p_data->>'version')::int then raise exception 'VERSION_CONFLICT'; end if;
 select eo.* into other_op from public.shipping_operations m join public.external_operations eo on eo.id=m.operation_id where m.shipment_id=s.id and eo.status in('queued','running','unknown') order by eo.created_at limit 1;
 if found and act<>'sync' then raise exception 'SHIPMENT_UNKNOWN'; end if;
 if act in('assign-awb','pickup','label') then perform public.shipping_eligible(o); end if;
 if act='assign-awb' and (s.booking_status<>'created' or s.awb is not null) then raise exception 'SHIPMENT_STATE_CONFLICT'; end if;
 if act='label' and (s.awb is null or s.booking_status='cancelled') then raise exception 'SHIPMENT_STATE_CONFLICT'; end if;
 if act='pickup' and (s.awb is null or s.private_label_key is null or s.pickup_status not in('not_requested','failed') or s.booking_status='cancelled') then raise exception 'SHIPMENT_STATE_CONFLICT'; end if;
 if act='cancel' and (s.pickup_status='picked_up' or s.transit_status not in('not_shipped','cancelled')) then raise exception 'ALREADY_COLLECTED'; end if;
 op:=public.begin_operation('shipping.'||replace(act,'-','_'),s.id::text,p_data->>'key',hashed);
 insert into public.shipping_operations values(op.id,s.id,act);
 update public.shipments set version=version+1 where id=s.id;
 perform public.enqueue_job('shipping.operation','shipping-operation:'||op.id,jsonb_build_object('operationId',op.id),8);
 perform public.record_audit(p_actor::text,'shipping.'||replace(act,'-','_'),'shipment',s.id::text,jsonb_build_object('operationId',op.id),null,null,p_actor);
 return jsonb_build_object('operationId',op.id,'shipmentId',s.id);
end; $$;

create function public.shipping_internal(p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shipments; o public.orders; op public.external_operations; m public.shipping_operations; ts timestamptz; status text; k text;
begin
 if p_action='due' then return coalesce((select jsonb_agg(id) from(select id from public.shipments where direction='forward' and next_sync_at<=now() and transit_status not in('delivered','rto_delivered','cancelled') order by next_sync_at limit 30)x),'[]'); end if;
 if p_action='lookup' then return (select to_jsonb(id) from public.shipments where (p_data->>'shipmentId' is null or provider_shipment_id=p_data->>'shipmentId') and (p_data->>'awb' is null or awb=p_data->>'awb') and (p_data ? 'shipmentId' or p_data ? 'awb') limit 1); end if;
 if p_action='webhook' then return (select to_jsonb(e) from public.webhook_events e where id=p_id and provider='shiprocket'); end if;
 if p_action='orderShipments' then return coalesce((select jsonb_agg(public.shipping_json(id)) from public.shipments where order_id=p_id and direction='forward'),'[]'); end if;
 if p_action='operation' then
  select * into m from public.shipping_operations where operation_id=p_id; select * into s from public.shipments where id=m.shipment_id; select * into op from public.external_operations where id=p_id;
  return jsonb_build_object('action',m.action,'operation',to_jsonb(op),'shipment',to_jsonb(s),'context',jsonb_set(public.shipping_context(s.order_id),'{warehouse}',coalesce((select provider_quote_payload->'warehouse' from public.fulfillment_quotes where id=s.fulfillment_quote_id),'null'::jsonb)));
 end if;
 if p_action='shipment' then select * into s from public.shipments where id=p_id; if not found then raise exception 'NOT_FOUND'; end if; return jsonb_build_object('shipment',to_jsonb(s),'context',jsonb_set(public.shipping_context(s.order_id),'{warehouse}',coalesce((select provider_quote_payload->'warehouse' from public.fulfillment_quotes where id=s.fulfillment_quote_id),'null'::jsonb))); end if;
 select order_id into k from public.shipments where id=p_id;
 select * into o from public.orders where id=k::uuid for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into s from public.shipments where id=p_id for update;
 if p_action='cancelReserve' then
  if o.attention_reason is distinct from 'CANCELLATION_REQUESTED' then raise exception 'FORBIDDEN'; end if;
  if s.pickup_status='picked_up' or s.transit_status not in('not_shipped','cancelled') then raise exception 'ALREADY_COLLECTED'; end if;
  if exists(select 1 from public.shipping_operations so join public.external_operations eo on eo.id=so.operation_id where so.shipment_id=s.id and so.action<>'cancel' and eo.status in('queued','running','unknown')) then raise exception 'SHIPMENT_UNKNOWN'; end if;
  op:=public.begin_operation('shipping.cancel',s.id::text,'order-cancel',md5(s.id::text)||md5('cancel:'||s.id::text));
  insert into public.shipping_operations values(op.id,s.id,'cancel') on conflict do nothing;
  perform public.enqueue_job('shipping.operation','shipping-operation:'||op.id,jsonb_build_object('operationId',op.id),8);
  return to_jsonb(op.id);
 elsif p_action='checked' then update public.shipments set next_sync_at=now()+interval '30 minutes',last_synced_at=now() where id=s.id; return '{}';
 elsif p_action='fixtureControls' then update public.shipments set fixture_controls=fixture_controls||p_data where id=s.id and fixture; return '{}';
 elsif p_action='failure' then
  if p_data->>'action'='create' then update public.shipments set booking_status=case when p_data->>'status'='failed' then 'failed' else 'unknown' end,version=version+1 where id=s.id; end if;
  if p_data->>'action'='pickup' and p_data->>'status'='failed' then update public.shipments set pickup_status='failed',version=version+1 where id=s.id; end if;
  if p_data->>'status'='unknown' then update public.orders set attention_reason=coalesce(attention_reason,'SHIPMENT_UNKNOWN'),fulfillment_status='held' where id=o.id; end if;
  return '{}';
 elsif p_action='complete' then
  select so.* into m from public.shipping_operations so where so.operation_id=(p_data->>'operationId')::uuid and so.shipment_id=s.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into op from public.external_operations where id=m.operation_id for update;
  if op.status='succeeded' then return public.shipping_json(s.id); end if;
  if op.status='running' and (op.lease_token::text is distinct from p_data->>'leaseToken' or op.locked_until<=clock_timestamp()) then raise exception 'LEASE_LOST'; end if;
  if op.status not in('running','unknown') then raise exception 'SHIPMENT_STATE_CONFLICT'; end if;
  if m.action='create' then
   if length(p_data->>'providerOrderId') not between 1 and 100 or length(p_data->>'providerShipmentId') not between 1 and 100 then raise exception 'INVALID_PAYLOAD'; end if;
   update public.shipments set provider_order_id=p_data->>'providerOrderId',provider_shipment_id=p_data->>'providerShipmentId',booking_status='created' where id=s.id;
  elsif m.action='assign-awb' then
   if length(p_data->>'awb') not between 1 and 100 then raise exception 'INVALID_PAYLOAD'; end if;
   update public.shipments set awb=p_data->>'awb',booking_status='awb_assigned' where id=s.id;
  elsif m.action='label' then
   insert into public.shipping_private_labels values(s.id,p_data->>'contentBase64',now()) on conflict(shipment_id) do update set content_base64=excluded.content_base64;
   update public.shipments set private_label_key='db:'||s.id where id=s.id;
  elsif m.action='pickup' then update public.shipments set pickup_status='scheduled' where id=s.id and pickup_status<>'picked_up';
  elsif m.action='cancel' then
   if s.pickup_status='picked_up' or s.transit_status not in('not_shipped','cancelled') then raise exception 'ALREADY_COLLECTED'; end if;
   update public.shipments set booking_status='cancelled',transit_status='cancelled' where id=s.id;
  end if;
  update public.shipments set version=version+1 where id=s.id;
  update public.external_operations set status='succeeded',provider_reference=coalesce(p_data->>'providerShipmentId',s.provider_shipment_id),result_json=jsonb_build_object('shipmentId',s.id),lease_token=null,locked_until=null,last_error=null,updated_at=now() where id=op.id;
  if o.attention_reason='SHIPMENT_UNKNOWN' and not exists(select 1 from public.shipping_operations so join public.external_operations eo on eo.id=so.operation_id where so.shipment_id=s.id and eo.status='unknown') then update public.orders set attention_reason=null,fulfillment_status=case (select transit_status from public.shipments where id=s.id) when 'delivered' then 'delivered' when 'in_transit' then 'shipped' when 'out_for_delivery' then 'shipped' when 'exception' then 'held' when 'rto_in_transit' then 'held' when 'rto_delivered' then 'held' else 'ready' end where id=o.id; end if;
  return public.shipping_json(s.id);
 elsif p_action='event' then
  status:=p_data->>'status'; ts:=(p_data->>'occurredAt')::timestamptz;
  if status not in('not_shipped','in_transit','out_for_delivery','delivered','exception','rto_in_transit','rto_delivered','cancelled','unknown') or ts>now()+interval '5 minutes' or length(p_data->>'rawStatus')>150 then raise exception 'INVALID_PAYLOAD'; end if;
  insert into public.shipment_events(shipment_id,environment,provider_event_key,raw_status,normalized_status,occurred_at,source,sanitized_details) values(s.id,o.mode,s.id||':'||md5(status||':'||(p_data->>'rawStatus')||':'||ts::text),p_data->>'rawStatus',status,ts,p_data->>'source','{}') on conflict do nothing;
  -- History is append-only. Unknown and older events never make fulfillment progress.
  if (s.provider_updated_at is null or ts>=s.provider_updated_at) and s.transit_status not in('delivered','rto_delivered','cancelled') then
   if status='unknown' then update public.orders set attention_reason=coalesce(attention_reason,'SHIPMENT_STATUS_UNKNOWN'),fulfillment_status='held' where id=o.id;
   else
    if status='not_shipped' and s.transit_status<>'not_shipped' then return '{}'; end if;
    if s.transit_status='rto_in_transit' and status not in('rto_in_transit','rto_delivered') then return '{}'; end if;
    if status='cancelled' and (s.pickup_status='picked_up' or s.transit_status<>'not_shipped') then update public.orders set attention_reason=coalesce(attention_reason,'SHIPMENT_STATUS_UNKNOWN'),fulfillment_status='held' where id=o.id; return '{}'; end if;
    update public.shipments set transit_status=status,pickup_status=case when status in('in_transit','out_for_delivery','delivered','exception','rto_in_transit','rto_delivered') then 'picked_up' when p_data->>'pickupScheduled'='true' and pickup_status<>'picked_up' then 'scheduled' else pickup_status end,booking_status=case when status='cancelled' then 'cancelled' else booking_status end,provider_status=p_data->>'rawStatus',provider_updated_at=ts,version=version+1 where id=s.id;
    update public.orders set fulfillment_status=case when status='delivered' then 'delivered' when status in('exception','rto_in_transit','rto_delivered') then 'held' when status in('in_transit','out_for_delivery') then 'shipped' when status='not_shipped' and attention_reason='SHIPMENT_STATUS_UNKNOWN' and order_status='confirmed' and captured_paise>refunded_paise then 'ready' else fulfillment_status end,attention_reason=case when status in('exception','rto_in_transit','rto_delivered') then coalesce(attention_reason,'DELIVERY_EXCEPTION') when attention_reason='SHIPMENT_STATUS_UNKNOWN' or (attention_reason='DELIVERY_EXCEPTION' and status in('in_transit','out_for_delivery','delivered')) then null else attention_reason end,version=version+1 where id=o.id;
   end if;
  end if;
  return '{}';
 end if;
 raise exception 'INVALID_PAYLOAD';
end; $$;
create function public.shipping_claim_jobs() returns setof public.jobs language plpgsql security definer set search_path='' as $$
begin
 perform public.reclaim_expired_jobs(100);
 return query with ready as(select j.id from public.jobs j where j.state in('queued','retry') and j.run_after<=now() and j.attempts<j.max_attempts and (j.type in('shipping.operation','shipping.sync') or (j.type in('webhook.process','webhook.reconcile') and exists(select 1 from public.webhook_events e where e.id::text=j.payload->>'webhookEventId' and e.provider='shiprocket'))) order by j.run_after,j.created_at for update skip locked limit 1) update public.jobs j set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),locked_until=now()+interval '5 minutes',updated_at=now() from ready where j.id=ready.id returning j.*;
end; $$;
create function public.shipping_claim_operation(p_id uuid) returns public.external_operations language plpgsql security definer set search_path='' as $$
declare m public.shipping_operations; s public.shipments; o public.orders; op public.external_operations;
begin
 select * into m from public.shipping_operations where operation_id=p_id; if not found then raise exception 'NOT_FOUND'; end if;
 select ord.* into o from public.orders ord join public.shipments sh on sh.order_id=ord.id where sh.id=m.shipment_id for update of ord;
 select * into s from public.shipments where id=m.shipment_id for update;
 select * into op from public.external_operations where id=p_id for update;
 if op.status='queued' and m.action in('create','assign-awb','pickup','label') then
  if o.attention_reason='CANCELLATION_REQUESTED' then
   update public.external_operations set status='failed',last_error='UPSTREAM_REJECTED',updated_at=now() where id=p_id returning * into op;
   if m.action='create' and s.provider_order_id is null then update public.shipments set booking_status='cancelled',transit_status='cancelled',version=version+1 where id=s.id; end if;
   return op;
  end if;
  perform public.shipping_eligible(o);
 end if;
 return public.claim_operation(p_id,300);
end; $$;
create function public.shipping_tracking(p_order_id uuid,p_token_hash text,p_user_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.checkout_order_access(p_order_id,p_token_hash,p_user_id) then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('orderId',p_order_id,'shipments',coalesce((select jsonb_agg(public.shipping_json(s.id)-array['orderId','version','costPaise','parcel','labelReady','operations'] order by s.created_at) from public.shipments s where s.order_id=p_order_id and direction='forward'),'[]'::jsonb));
end; $$;
create function public.shipping_retry(p_actor uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare so public.shipping_operations; eo public.external_operations; o public.orders;
begin
 perform public.require_admin_actor(p_actor);
 select * into so from public.shipping_operations where operation_id=p_id; if not found then raise exception 'NOT_FOUND'; end if;
 select ord.* into o from public.orders ord join public.shipments s on s.order_id=ord.id where s.id=so.shipment_id for update of ord;
 select * into eo from public.external_operations where id=p_id for update;
 if eo.status='failed' then
  if so.action in('create','assign-awb','pickup','label') then perform public.shipping_eligible(o); end if;
  update public.external_operations set status='queued',last_error=null where id=eo.id;
 end if;
 perform public.enqueue_job('shipping.operation','shipping-retry:'||eo.id||':'||eo.attempts,jsonb_build_object('operationId',eo.id),8);
 perform public.record_audit(p_actor::text,'shipping.retry','shipment',so.shipment_id::text,jsonb_build_object('operationId',eo.id),null,null,p_actor);
 return jsonb_build_object('operationId',eo.id,'shipmentId',so.shipment_id);
end; $$;
do $$ declare fn regprocedure; begin for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'shipping_%' loop execute format('revoke all on function %s from public,anon,authenticated',fn); execute format('grant execute on function %s to service_role',fn); end loop; end; $$;
commit;
