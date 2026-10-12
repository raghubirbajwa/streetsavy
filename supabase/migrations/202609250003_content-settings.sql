begin;
-- Existing collection columns are the published snapshot; draft edits stay private.
alter table public.collections add column draft_payload jsonb;

create function public.content_exact_keys(p_value jsonb, p_keys text[]) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value)<>'object' then return false; end if;
  return p_value ?& p_keys and not exists(select 1 from jsonb_object_keys(p_value) k where not k = any(p_keys));
end;
$$;

create function public.content_validate_collection(p_value jsonb) returns void
language plpgsql set search_path = '' as $$
declare ids uuid[];
begin
  if not coalesce(public.content_exact_keys(p_value, array['title','slug','description','coverMediaId','productIds','sortOrder','active']),false) then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(p_value->'title') <> 'string' or length(btrim(p_value->>'title')) not between 1 and 120
    or jsonb_typeof(p_value->'slug') <> 'string' or length(p_value->>'slug') > 100 or (p_value->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or jsonb_typeof(p_value->'description') <> 'string' or length(p_value->>'description') > 2000
    or jsonb_typeof(p_value->'active') <> 'boolean' or jsonb_typeof(p_value->'sortOrder')<>'number' or (p_value->>'sortOrder') !~ '^\d{1,4}$'
    or jsonb_typeof(p_value->'coverMediaId') not in ('string','null')
    or jsonb_typeof(p_value->'productIds') <> 'array' then raise exception 'INVALID_PAYLOAD'; end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_value->'productIds');
  if coalesce(cardinality(ids),0) > 100 or cardinality(ids) <> (select count(distinct x) from unnest(ids) x)
    or exists(select 1 from unnest(ids) x where not exists(select 1 from public.products where id=x))
    or (p_value->>'coverMediaId' is not null and not exists(select 1 from public.media_assets where id=(p_value->>'coverMediaId')::uuid)) then raise exception 'INVALID_REFERENCE'; end if;
exception when invalid_text_representation then raise exception 'INVALID_PAYLOAD';
end;
$$;

create function public.admin_collections_read(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin_actor(p_actor);
  return jsonb_build_object(
    'collections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'version',c.version,'title',c.title,'active',c.active,
      'draft',coalesce(c.draft_payload,jsonb_build_object('title',c.title,'slug',c.slug,'description',c.description,'coverMediaId',c.cover_media_id,'active',c.active,'sortOrder',c.sort_order,
        'productIds',coalesce((select jsonb_agg(cp.product_id order by cp.sort_order,cp.product_id) from public.collection_products cp where cp.collection_id=c.id),'[]'::jsonb)))) order by c.sort_order,c.id) from public.collections c),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status) order by title) from public.products),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',id,'alt',alt,'status',status) order by created_at desc) from public.media_assets where status in ('ready','publishing','published')),'[]'::jsonb));
end;
$$;

create function public.admin_save_collection(p_actor uuid,p_id uuid,p_expected_version integer,p_draft jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.collections;
begin
  perform public.require_admin_actor(p_actor);
  perform public.content_validate_collection(p_draft);
  if p_expected_version is null then raise exception 'INVALID_PAYLOAD'; end if;
  if p_id is null then
    if p_expected_version <> 0 then raise exception 'VERSION_CONFLICT'; end if;
    insert into public.collections(title,slug,draft_payload) values(p_draft->>'title',p_draft->>'slug',p_draft) returning * into c;
  else
    select * into c from public.collections where id=p_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if c.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',c.version)::text; end if;
    update public.collections set draft_payload=p_draft where id=p_id returning * into c;
  end if;
  perform public.record_audit('admin','collection.draft_saved','collections',c.id::text,jsonb_build_object('version',c.version),null,null,p_actor);
  return c.id;
end;
$$;

-- Called only by the final content publication transaction, after its version lock.
-- Copies are prepared by the server; unpublished objects are invisible until this commit.
create function public.content_publish_media(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.media_assets; all_ids uuid[];
begin
  select array_agg(distinct id) into all_ids from (
    select unnest(p_ids) as id union select poster_media_id from public.media_assets where id=any(p_ids) and poster_media_id is not null
  ) refs where id is not null;
  if exists(select 1 from unnest(p_ids) wanted where wanted is not null and not exists(select 1 from public.media_assets where id=wanted)) then raise exception 'INVALID_REFERENCE'; end if;
  for m in select * from public.media_assets where id=any(all_ids) order by id for update loop
    if m.status not in ('publishing','published') or m.public_key is null or m.width is null or m.height is null then raise exception 'MEDIA_NOT_READY'; end if;
    if m.status='publishing' and (m.checksum is null or length(btrim(m.alt))=0
      or coalesce(nullif(btrim(m.source_details->>'source'),''),nullif(btrim(m.source_details->>'creator'),'')) is null
      or length(btrim(coalesce(m.license_details->>'license','')))=0) then raise exception 'MEDIA_NOT_READY'; end if;
    if m.type='video' and (m.duration_seconds is null or m.duration_seconds>30 or m.poster_media_id is null) then raise exception 'MEDIA_POSTER_REQUIRED'; end if;
  end loop;
  update public.media_assets set status='published',version=version+1,updated_at=now() where id=any(all_ids) and status='publishing';
end $$;

-- Called inside the final entity publication transaction; copies alone remain private.
create function public.content_commit_media(p_actor uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare m public.media_assets;
begin
  perform public.require_admin_actor(p_actor);
  for m in select * from public.media_assets where id=any(p_ids) or id in(select poster_media_id from public.media_assets where id=any(p_ids)) order by id for update loop
    if m.status not in ('publishing','published') or m.public_key is null then raise exception 'MEDIA_NOT_READY'; end if;
    if m.status='publishing' then update public.media_assets set status='published' where id=m.id; end if;
  end loop;
end $$;

create function public.admin_publish_collection(p_actor uuid,p_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.collections; d jsonb;
begin
  perform public.require_admin_actor(p_actor);
  select * into c from public.collections where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_expected_version is null or c.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',c.version)::text; end if;
  d:=c.draft_payload;
  if d is null then raise exception 'SAVE_DRAFT_FIRST'; end if;
  perform public.content_validate_collection(d);
  if (d->>'active')::boolean then
    perform public.content_commit_media(p_actor,array[(d->>'coverMediaId')::uuid]);
    perform public.content_publish_media(array[(d->>'coverMediaId')::uuid]);
    if jsonb_array_length(d->'productIds')=0 or exists(select 1 from jsonb_array_elements_text(d->'productIds') x
      where not exists(select 1 from public.products p join public.categories cat on cat.id=p.category_id and cat.active where p.id=x::uuid and p.status='published'))
      or (d->>'coverMediaId' is not null and not exists(select 1 from public.media_assets where id=(d->>'coverMediaId')::uuid and status='published' and public_key is not null)) then raise exception 'INVALID_REFERENCE'; end if;
  end if;
  update public.collections set title=d->>'title',slug=d->>'slug',description=d->>'description',cover_media_id=(d->>'coverMediaId')::uuid,
    active=(d->>'active')::boolean,sort_order=(d->>'sortOrder')::integer where id=p_id returning * into c;
  delete from public.collection_products where collection_id=p_id;
  insert into public.collection_products(collection_id,product_id,sort_order)
    select p_id,value::uuid,ordinality::integer-1 from jsonb_array_elements_text(d->'productIds') with ordinality;
  perform public.record_audit('admin','collection.published','collections',c.id::text,jsonb_build_object('version',c.version,'active',c.active),null,null,p_actor);
end;
$$;

create function public.content_validate_home(p_value jsonb,p_publishing boolean) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; ref uuid; ids uuid[];
begin
  if not coalesce(public.content_exact_keys(p_value - 'story',array['hero','announcement','navigation','featuredProductIds','lookbook']),false)
    or not coalesce(public.content_exact_keys(p_value->'hero',array['eyebrow','heading','body','ctaLabel','collectionId','mediaId']),false)
    or not coalesce(public.content_exact_keys(p_value->'announcement',array['text','collectionId']),false) then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(p_value#>'{hero,heading}') <> 'string' or length(btrim(p_value#>>'{hero,heading}')) not between 1 and 120
    or jsonb_typeof(p_value#>'{hero,eyebrow}') <> 'string' or length(p_value#>>'{hero,eyebrow}')>80
    or jsonb_typeof(p_value#>'{hero,body}') <> 'string' or length(p_value#>>'{hero,body}')>300
    or jsonb_typeof(p_value#>'{hero,ctaLabel}') <> 'string' or length(btrim(p_value#>>'{hero,ctaLabel}')) not between 1 and 60
    or jsonb_typeof(p_value#>'{announcement,text}') <> 'string' or length(p_value#>>'{announcement,text}')>160
    or jsonb_typeof(p_value->'navigation')<>'array' or jsonb_typeof(p_value->'featuredProductIds')<>'array' or jsonb_typeof(p_value->'lookbook')<>'array' then raise exception 'INVALID_PAYLOAD'; end if;
  if p_value ? 'story' and (not public.content_exact_keys(p_value->'story',array['heading','body']) or jsonb_typeof(p_value#>'{story,heading}')<>'string' or length(p_value#>>'{story,heading}')>120 or jsonb_typeof(p_value#>'{story,body}')<>'string' or length(p_value#>>'{story,body}')>2000) then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_array_length(p_value->'navigation')>8 or jsonb_array_length(p_value->'lookbook')>8 or jsonb_array_length(p_value->'featuredProductIds')>100 then raise exception 'INVALID_PAYLOAD'; end if;
  if p_publishing and (p_value#>>'{hero,collectionId}' is null or p_value#>>'{hero,mediaId}' is null
    or (length(p_value#>>'{announcement,text}')>0 and p_value#>>'{announcement,collectionId}' is null)) then raise exception 'INVALID_REFERENCE'; end if;
  for item in select jsonb_build_object('collectionId',p_value#>'{hero,collectionId}') union all
    select jsonb_build_object('collectionId',p_value#>'{announcement,collectionId}') union all select value from jsonb_array_elements(p_value->'navigation') loop
    if item ? 'label' and (not public.content_exact_keys(item,array['label','collectionId']) or jsonb_typeof(item->'label')<>'string' or length(btrim(item->>'label')) not between 1 and 60) then raise exception 'INVALID_PAYLOAD'; end if;
    ref:=(item->>'collectionId')::uuid;
    if ref is not null and not exists(select 1 from public.collections where id=ref and (not p_publishing or active)) then raise exception 'INVALID_REFERENCE'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_value->'navigation') loop
    if not public.content_exact_keys(item,array['label','collectionId']) or item->>'collectionId' is null then raise exception 'INVALID_PAYLOAD'; end if;
  end loop;
  for item in select jsonb_build_object('mediaId',p_value#>'{hero,mediaId}') union all select value from jsonb_array_elements(p_value->'lookbook') loop
    ref:=(item->>'mediaId')::uuid;
    if ref is not null and not exists(select 1 from public.media_assets where id=ref and (not p_publishing or (status='published' and public_key is not null))) then raise exception 'INVALID_REFERENCE'; end if;
  end loop;
  for item in select jsonb_build_object('productIds',p_value->'featuredProductIds') union all select value from jsonb_array_elements(p_value->'lookbook') loop
    if item ? 'title' and (not public.content_exact_keys(item,array['title','mediaId','productIds']) or jsonb_typeof(item->'title')<>'string' or length(btrim(item->>'title')) not between 1 and 120) then raise exception 'INVALID_PAYLOAD'; end if;
    if jsonb_typeof(item->'productIds')<>'array' then raise exception 'INVALID_PAYLOAD'; end if;
    select array_agg(value::uuid) into ids from jsonb_array_elements_text(item->'productIds');
    if coalesce(cardinality(ids),0)>100 or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
      or exists(select 1 from unnest(ids) x where not exists(select 1 from public.products p join public.categories c on c.id=p.category_id where p.id=x and (not p_publishing or (p.status='published' and c.active)))) then raise exception 'INVALID_REFERENCE'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_value->'lookbook') loop
    if not public.content_exact_keys(item,array['title','mediaId','productIds']) or item->>'mediaId' is null or jsonb_array_length(item->'productIds')=0 then raise exception 'INVALID_PAYLOAD'; end if;
  end loop;
exception when invalid_text_representation then raise exception 'INVALID_PAYLOAD';
end;
$$;

create function public.admin_content_read(p_actor uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.site_content;
begin
  perform public.require_admin_actor(p_actor);
  select * into c from public.site_content where key='home';
  return jsonb_build_object('version',coalesce(c.version,0),'draft',c.draft_payload,'published',c.published_payload,'publishedAt',c.published_at,
    'collections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'active',active) order by sort_order,id) from public.collections),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status) order by title) from public.products),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',id,'alt',alt,'status',status) order by created_at desc) from public.media_assets where status in ('ready','publishing','published')),'[]'::jsonb));
end $$;
create function public.admin_save_content(p_actor uuid,p_expected_version integer,p_draft jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare c public.site_content;
begin
  perform public.require_admin_actor(p_actor);
  perform public.content_validate_home(p_draft,false);
  perform pg_advisory_xact_lock(hashtextextended('admin:home',0));
  select * into c from public.site_content where key='home' for update;
  if p_expected_version is null or coalesce(c.version,0)<>p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',coalesce(c.version,0))::text; end if;
  insert into public.site_content(key,draft_payload) values('home',p_draft) on conflict(key) do update set draft_payload=excluded.draft_payload returning * into c;
  perform public.record_audit('admin','content.draft_saved','site_content','home',jsonb_build_object('version',c.version),null,null,p_actor);
end $$;
create function public.admin_publish_content(p_actor uuid,p_expected_version integer) returns void language plpgsql security definer set search_path = '' as $$
declare c public.site_content;
begin
  perform public.require_admin_actor(p_actor);
  select * into c from public.site_content where key='home' for update;
  if not found then raise exception 'SAVE_DRAFT_FIRST'; end if;
  if p_expected_version is null or c.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',c.version)::text; end if;
  perform public.content_publish_media(array(select distinct id from (select (c.draft_payload#>>'{hero,mediaId}')::uuid as id union select (item->>'mediaId')::uuid from jsonb_array_elements(c.draft_payload->'lookbook') item) refs where id is not null));
  perform public.content_commit_media(p_actor,array[(c.draft_payload#>>'{hero,mediaId}')::uuid] || array(select (value->>'mediaId')::uuid from jsonb_array_elements(c.draft_payload->'lookbook')));
  perform public.content_validate_home(c.draft_payload,true);
  update public.site_content set published_payload=draft_payload,published_at=clock_timestamp() where key='home' returning * into c;
  perform public.record_audit('admin','content.published','site_content','home',jsonb_build_object('version',c.version),null,null,p_actor);
end $$;
create function public.public_home_content() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare payload jsonb;
begin
  select published_payload into payload from public.site_content where key='home';
  if payload is null then return null; end if;
  -- References may have been archived since publication. Never return unavailable links.
  perform public.content_validate_home(payload,true);
  return payload;
exception when raise_exception then return null;
end $$;

create function public.content_validate_settings(p_value jsonb) returns void language plpgsql set search_path = '' as $$
declare k text;
begin
  if not coalesce(public.content_exact_keys(p_value,array['shippingMode','shippingFeePaise','freeShippingThresholdPaise','taxInclusive','taxRatePercent','returnWindowDays','shippingPolicy','returnPolicy','privacyPolicy','termsPolicy','supportEmail','supportPhone','policiesPublished','contactPublished']),false) then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(p_value->'shippingMode')<>'string' or p_value->>'shippingMode' not in ('flat','free_above','provider') or p_value->'taxInclusive'<>'true'::jsonb
    or jsonb_typeof(p_value->'policiesPublished')<>'boolean' or jsonb_typeof(p_value->'contactPublished')<>'boolean'
    or jsonb_typeof(p_value->'shippingFeePaise')<>'number' or (p_value->>'shippingFeePaise') !~ '^\d+$' or (p_value->>'shippingFeePaise')::numeric>10000000
    or jsonb_typeof(p_value->'freeShippingThresholdPaise')<>'number' or (p_value->>'freeShippingThresholdPaise') !~ '^\d+$' or (p_value->>'freeShippingThresholdPaise')::numeric>100000000
    or jsonb_typeof(p_value->'returnWindowDays')<>'number' or (p_value->>'returnWindowDays') !~ '^\d+$' or (p_value->>'returnWindowDays')::integer>365
    or (p_value->>'taxRatePercent' is not null and (jsonb_typeof(p_value->'taxRatePercent')<>'number' or (p_value->>'taxRatePercent')::numeric not between 0 and 100)) then raise exception 'INVALID_PAYLOAD'; end if;
  foreach k in array array['shippingPolicy','returnPolicy','privacyPolicy','termsPolicy'] loop
    if jsonb_typeof(p_value->k)<>'string' or length(p_value->>k)>10000 or ((p_value->>'policiesPublished')::boolean and length(btrim(p_value->>k))=0) then raise exception 'INVALID_PAYLOAD'; end if;
  end loop;
  if jsonb_typeof(p_value->'supportEmail')<>'string' or length(p_value->>'supportEmail')>254 or (length(p_value->>'supportEmail')>0 and p_value->>'supportEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or jsonb_typeof(p_value->'supportPhone')<>'string' or length(p_value->>'supportPhone')>30
    or ((p_value->>'contactPublished')::boolean and length(p_value->>'supportEmail')=0 and length(p_value->>'supportPhone')=0) then raise exception 'INVALID_PAYLOAD'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_PAYLOAD';
end $$;

create function public.admin_settings_read(p_actor uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.store_settings;
begin
  perform public.require_admin_actor(p_actor,true);
  select * into s from public.store_settings where key='commerce';
  return jsonb_build_object('version',coalesce(s.version,0),'value',s.value,
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'version',w.version,'value',jsonb_build_object('name',w.name,'pickupLocation',w.pickup_location,
      'contactName',w.contact->>'name','email',w.contact->>'email','phone',w.contact->>'phone','line1',w.address->>'line1','line2',w.address->>'line2','city',w.address->>'city','state',w.address->>'state','pincode',w.address->>'pincode','country',w.address->>'country','active',w.active)) order by w.created_at) from public.warehouse w),'[]'::jsonb),
    'packaging',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'value',jsonb_build_object('label',p.label,'lengthCm',p.length_cm,'widthCm',p.width_cm,'heightCm',p.height_cm,'tareWeightG',p.tare_weight_g,'maxContentsWeightG',p.max_contents_weight_g,'maxItems',p.max_items,'priority',p.priority,'active',p.active)) order by p.priority,p.id) from public.packaging_presets p),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'entityType',a.entity_type,'createdAt',a.created_at,'diff',a.diff) order by a.created_at desc) from (select * from public.audit_logs where entity_type in ('store_settings','warehouse','packaging_presets') order by created_at desc limit 20) a),'[]'::jsonb));
end $$;

create function public.admin_save_settings(p_actor uuid,p_expected_version integer,p_value jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare s public.store_settings;
begin
  perform public.require_admin_actor(p_actor,true);
  perform public.content_validate_settings(p_value);
  perform pg_advisory_xact_lock(hashtextextended('admin:commerce',0));
  select * into s from public.store_settings where key='commerce' for update;
  if p_expected_version is null or coalesce(s.version,0)<>p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',coalesce(s.version,0))::text; end if;
  insert into public.store_settings(key,value) values('commerce',p_value) on conflict(key) do update set value=excluded.value returning * into s;
  perform public.record_audit('admin','settings.saved','store_settings','commerce',jsonb_build_object('version',s.version,'shippingMode',p_value->>'shippingMode','taxInclusive',true,'policiesPublished',p_value->'policiesPublished','contactPublished',p_value->'contactPublished'),null,null,p_actor);
end $$;

create function public.admin_save_warehouse(p_actor uuid,p_id uuid,p_expected_version integer,p_value jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare w public.warehouse; k text;
begin
  perform public.require_admin_actor(p_actor,true);
  if not coalesce(public.content_exact_keys(p_value,array['name','pickupLocation','contactName','email','phone','line1','line2','city','state','pincode','country','active']),false) then raise exception 'INVALID_PAYLOAD'; end if;
  foreach k in array array['name','pickupLocation','contactName','email','phone','line1','city','state','pincode'] loop
    if jsonb_typeof(p_value->k)<>'string' or length(btrim(p_value->>k)) not between 1 and 254 then raise exception 'INVALID_PAYLOAD'; end if;
  end loop;
  if jsonb_typeof(p_value->'line2')<>'string' or length(p_value->>'line2')>200 or p_value->>'country'<>'IN' or p_value->>'pincode' !~ '^\d{6}$'
    or jsonb_typeof(p_value->'country')<>'string'
    or length(p_value->>'name')>120 or length(p_value->>'contactName')>120 or length(p_value->>'pickupLocation')>100
    or length(p_value->>'line1')>200 or length(p_value->>'city')>100 or length(p_value->>'state')>100 or length(p_value->>'phone') not between 5 and 30
    or p_value->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or jsonb_typeof(p_value->'active')<>'boolean' then raise exception 'INVALID_PAYLOAD'; end if;
  -- Serialize the one-active-warehouse invariant without silently disabling another row.
  perform pg_advisory_xact_lock(hashtextextended('admin:warehouse',0));
  if p_id is not null then select * into w from public.warehouse where id=p_id for update; if not found then raise exception 'NOT_FOUND'; end if; end if;
  if p_expected_version is null or coalesce(w.version,0)<>p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',coalesce(w.version,0))::text; end if;
  if (p_value->>'active')::boolean and exists(select 1 from public.warehouse where active and id is distinct from p_id) then raise exception 'ACTIVE_WAREHOUSE_EXISTS'; end if;
  if p_id is null then
    insert into public.warehouse(name,pickup_location,contact,address,active) values(p_value->>'name',p_value->>'pickupLocation',jsonb_build_object('name',p_value->>'contactName','email',p_value->>'email','phone',p_value->>'phone'),
      jsonb_build_object('line1',p_value->>'line1','line2',p_value->>'line2','city',p_value->>'city','state',p_value->>'state','pincode',p_value->>'pincode','country','IN'),(p_value->>'active')::boolean) returning * into w;
  else
    update public.warehouse set name=p_value->>'name',pickup_location=p_value->>'pickupLocation',contact=jsonb_build_object('name',p_value->>'contactName','email',p_value->>'email','phone',p_value->>'phone'),
      address=jsonb_build_object('line1',p_value->>'line1','line2',p_value->>'line2','city',p_value->>'city','state',p_value->>'state','pincode',p_value->>'pincode','country','IN'),active=(p_value->>'active')::boolean where id=p_id returning * into w;
  end if;
  perform public.record_audit('admin','warehouse.saved','warehouse',w.id::text,jsonb_build_object('version',w.version,'active',w.active),null,null,p_actor);
end $$;

create function public.admin_save_packaging(p_actor uuid,p_id uuid,p_expected_version integer,p_value jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare p public.packaging_presets; k text;
begin
  perform public.require_admin_actor(p_actor,true);
  if not coalesce(public.content_exact_keys(p_value,array['label','lengthCm','widthCm','heightCm','tareWeightG','maxContentsWeightG','maxItems','priority','active']),false) then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(p_value->'label')<>'string' or length(btrim(p_value->>'label')) not between 1 and 100 or jsonb_typeof(p_value->'active')<>'boolean' then raise exception 'INVALID_PAYLOAD'; end if;
  foreach k in array array['lengthCm','widthCm','heightCm'] loop
    if jsonb_typeof(p_value->k)<>'number' or (p_value->>k)::numeric <=0 or (p_value->>k)::numeric>300 then raise exception 'INVALID_PAYLOAD'; end if;
  end loop;
  foreach k in array array['tareWeightG','maxContentsWeightG','maxItems','priority'] loop
    if jsonb_typeof(p_value->k)<>'number' or (p_value->>k) !~ '^\d+$' or (p_value->>k)::numeric>100000 then raise exception 'INVALID_PAYLOAD'; end if;
  end loop;
  if (p_value->>'tareWeightG')::integer=0 or (p_value->>'maxContentsWeightG')::integer=0 or (p_value->>'maxItems')::integer not between 1 and 1000 or (p_value->>'priority')::integer>9999 then raise exception 'INVALID_PAYLOAD'; end if;
  if p_id is not null then select * into p from public.packaging_presets where id=p_id for update; if not found then raise exception 'NOT_FOUND'; end if; end if;
  if p_expected_version is null or coalesce(p.version,0)<>p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('currentVersion',coalesce(p.version,0))::text; end if;
  if p_id is null then
    insert into public.packaging_presets(label,length_cm,width_cm,height_cm,tare_weight_g,max_contents_weight_g,max_items,priority,active) values(p_value->>'label',(p_value->>'lengthCm')::numeric,(p_value->>'widthCm')::numeric,(p_value->>'heightCm')::numeric,
      (p_value->>'tareWeightG')::integer,(p_value->>'maxContentsWeightG')::integer,(p_value->>'maxItems')::integer,(p_value->>'priority')::integer,(p_value->>'active')::boolean) returning * into p;
  else
    update public.packaging_presets set label=p_value->>'label',length_cm=(p_value->>'lengthCm')::numeric,width_cm=(p_value->>'widthCm')::numeric,height_cm=(p_value->>'heightCm')::numeric,
      tare_weight_g=(p_value->>'tareWeightG')::integer,max_contents_weight_g=(p_value->>'maxContentsWeightG')::integer,max_items=(p_value->>'maxItems')::integer,priority=(p_value->>'priority')::integer,active=(p_value->>'active')::boolean where id=p_id returning * into p;
  end if;
  perform public.record_audit('admin','packaging.saved','packaging_presets',p.id::text,jsonb_build_object('version',p.version,'active',p.active,'lengthCm',p.length_cm,'widthCm',p.width_cm,'heightCm',p.height_cm,'maxContentsWeightG',p.max_contents_weight_g),null,null,p_actor);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_PAYLOAD';
end $$;

create function public.public_store_settings() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shippingMode',value->'shippingMode','shippingFeePaise',value->'shippingFeePaise','freeShippingThresholdPaise',value->'freeShippingThresholdPaise','taxInclusive',true,
    'policies',case when value->'policiesPublished'='true'::jsonb then jsonb_build_object('returnWindowDays',value->'returnWindowDays','shipping',value->'shippingPolicy','returns',value->'returnPolicy','privacy',value->'privacyPolicy','terms',value->'termsPolicy') else null end,
    'contact',case when value->'contactPublished'='true'::jsonb then jsonb_build_object('email',value->'supportEmail','phone',value->'supportPhone') else null end)
  from public.store_settings where key='commerce';
$$;

do $$ declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
    (p.proname like 'content_%' or p.proname in ('admin_collections_read','admin_save_collection','admin_publish_collection','admin_content_read','admin_save_content','admin_publish_content','admin_settings_read','admin_save_settings','admin_save_warehouse','admin_save_packaging','public_home_content','public_store_settings')) loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end $$;
grant execute on function public.public_home_content(),public.public_store_settings() to anon,authenticated;
commit;
