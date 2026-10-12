begin;
create function public.require_admin_actor(p_actor uuid,p_owner_only boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null or not exists(select 1 from public.admin_memberships where user_id=p_actor and enabled and (not p_owner_only or role='owner')) then
  raise exception using errcode='P0001',message='FORBIDDEN';
 end if;
end $$;

create function public.product_publication_missing(p_product uuid,p_mode text default 'fixture') returns text[]
language plpgsql stable security definer set search_path='' as $$
declare p public.products; missing text[]:='{}';
begin
 select * into p from public.products where id=p_product;
 if not found then return array['product']; end if;
 if length(btrim(p.title))=0 then missing:=array_append(missing,'title'); end if;
 if length(btrim(p.description))=0 then missing:=array_append(missing,'description'); end if;
 if not exists(select 1 from public.categories where id=p.category_id and active) then missing:=array_append(missing,'category'); end if;
 if not exists(select 1 from public.product_variants where product_id=p.id and enabled) then missing:=array_append(missing,'variants'); end if;
 if exists(select 1 from public.product_variants where product_id=p.id and enabled and size<>'ONE_SIZE') and p.size_guide_id is null then missing:=array_append(missing,'sizeGuide'); end if;
 if p.size_guide_id is not null and exists(select 1 from public.product_variants v where v.product_id=p.id and v.enabled and v.size<>'ONE_SIZE' and not exists(select 1 from public.size_guides g, jsonb_array_elements(g.values_cm->'rows') r where g.id=p.size_guide_id and r->>'size'=v.size)) then missing:=array_append(missing,'sizeGuideCoverage'); end if;
 if not exists(select 1 from public.product_packaging pp join public.packaging_presets ps on ps.id=pp.preset_id where pp.product_id=p.id and ps.active
   and ps.max_contents_weight_g >= coalesce((select max(unit_weight_g) from public.product_variants where product_id=p.id and enabled),0)) then missing:=array_append(missing,'packaging'); end if;
 if not exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p.id and m.status in ('ready','publishing','published')) then missing:=array_append(missing,'media'); end if;
 if exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p.id and (m.status not in ('ready','publishing','published') or length(btrim(m.alt))=0 or m.width is null or m.height is null)) then missing:=array_append(missing,'mediaValidation'); end if;
 if exists(select 1 from public.product_variants v where v.product_id=p.id and v.enabled and not exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p.id and (pm.color_key=v.color_key or pm.color_key is null) and pm.is_cover and m.status in ('ready','publishing','published'))) then missing:=array_append(missing,'colourCovers'); end if;
 if p_mode='live' then
   if p.is_demo then missing:=array_append(missing,'realProduct'); end if;
   if exists(select 1 from public.size_guides where id=p.size_guide_id and is_demo) then missing:=array_append(missing,'approvedSizeGuide'); end if;
   if exists(select 1 from public.product_variants where product_id=p.id and enabled and tax_category_key is null) then missing:=array_append(missing,'taxCategories'); end if;
   if exists(select 1 from public.product_variants where product_id=p.id and enabled and compare_at_paise is not null) then missing:=array_append(missing,'truthfulCompareAtBasis'); end if;
 end if;
 if exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p.id and (coalesce(nullif(btrim(m.source_details->>'source'),''),nullif(btrim(m.source_details->>'creator'),'')) is null or coalesce(length(btrim(m.license_details->>'license')),0)=0)) then missing:=array_append(missing,'mediaRights'); end if;
 if exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id left join public.media_assets poster on poster.id=m.poster_media_id where pm.product_id=p.id and m.type='video' and (poster.id is null or poster.type<>'image' or poster.status not in ('ready','publishing','published'))) then missing:=array_append(missing,'videoPoster'); end if;
 return missing;
end $$;

create function public.admin_product_json(p_product uuid,p_mode text default 'fixture') returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'slug',p.slug,'title',p.title,'description',p.description,'categoryId',p.category_id,'tags',p.tags,'status',p.status,
 'fit',p.fit,'material',p.material,'care',p.care,'sizeGuideId',p.size_guide_id,'featuredRank',p.featured_rank,'publishedAt',case when p.published_at is null then null else to_char(p.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,'isDemo',p.is_demo,'version',p.version,
 'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'colorKey',v.color_key,'colorLabel',v.color_label,'colorHex',v.color_hex,'size',v.size,'pricePaise',v.price_paise,'compareAtPaise',v.compare_at_paise,'taxCategoryKey',v.tax_category_key,'unitWeightG',v.unit_weight_g,'enabled',v.enabled,'version',v.version,
   'inventory',jsonb_build_object('onHand',coalesce(i.on_hand,0),'reserved',coalesce(i.reserved,0),'available',coalesce(i.on_hand-i.reserved,0),'version',coalesce(i.version,1))) order by v.color_key,v.size,v.id)
   from public.product_variants v left join public.inventory i on i.variant_id=v.id where v.product_id=p.id),'[]'::jsonb),
 'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,'status',m.status,'contentType',m.content_type,'width',m.width,'height',m.height,'alt',m.alt,'colorKey',pm.color_key,'sortOrder',pm.sort_order,'isCover',pm.is_cover,'version',m.version) order by pm.sort_order,m.id) from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p.id),'[]'::jsonb),
 'packagingPresetIds',coalesce((select jsonb_agg(pp.preset_id order by pp.preset_id) from public.product_packaging pp where pp.product_id=p.id),'[]'::jsonb),
 'publicationMissing',public.product_publication_missing(p.id,p_mode),
 'inventoryMovements',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'variantId',q.variant_id,'kind',q.kind,'delta',q.on_hand_delta,'reason',q.reason,'actorUserId',q.actor_user_id,'operationKey',q.operation_key,'createdAt',to_char(q.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by q.created_at desc,q.id) from (select m.* from public.inventory_movements m join public.product_variants v on v.id=m.variant_id where v.product_id=p.id order by m.created_at desc,m.id limit 100) q),'[]'::jsonb))
 from public.products p where p.id=p_product;
$$;

create function public.admin_catalog(p_actor uuid,p_mode text default 'fixture') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_admin_actor(p_actor);
 return jsonb_build_object(
 'products',coalesce((select jsonb_agg(public.admin_product_json(p.id,p_mode) order by p.updated_at desc,p.id) from public.products p),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'sortOrder',sort_order,'active',active,'version',version) order by sort_order,id) from public.categories),'[]'::jsonb),
 'sizeGuides',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'measurementType',measurement_type,'instructions',instructions,'valuesCm',values_cm,'isDemo',is_demo,'version',version) order by title,id) from public.size_guides),'[]'::jsonb),
 'packagingPresets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'lengthCm',length_cm,'widthCm',width_cm,'heightCm',height_cm,'tareWeightG',tare_weight_g,'maxContentsWeightG',max_contents_weight_g,'maxItems',max_items,'priority',priority,'active',active,'version',version) order by priority,id) from public.packaging_presets),'[]'::jsonb));
end $$;

create function public.admin_get_product(p_actor uuid,p_id uuid,p_mode text default 'fixture') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin perform public.require_admin_actor(p_actor); result:=public.admin_product_json(p_id,p_mode);
 if result is null then raise exception using errcode='P0001',message='NOT_FOUND'; end if; return result; end $$;

create function public.admin_save_product(p_actor uuid,p_id uuid,p_version integer,p_data jsonb,p_mode text default 'fixture') returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_row public.products; new_id uuid; key text;
begin
 perform public.require_admin_actor(p_actor);
 if p_mode not in ('fixture','test','live') or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 for key in select jsonb_object_keys(p_data) loop
  if key not in ('title','slug','description','categoryId','tags','fit','material','care','sizeGuideId','featuredRank') then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 end loop;
 if coalesce(length(btrim(p_data->>'title')),0) not between 1 and 200 or coalesce(p_data->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_data->>'slug')>120 or length(coalesce(p_data->>'description',''))>10000 or coalesce(length(btrim(p_data->>'fit')),0) not between 1 and 200
 or jsonb_typeof(p_data->'tags') is distinct from 'array' or jsonb_typeof(p_data->'care') is distinct from 'array' then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 if p_id is not null then
  select * into old_row from public.products where id=p_id for update;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if p_version is distinct from old_row.version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',old_row.version)::text; end if;
  update public.products set title=p_data->>'title',slug=p_data->>'slug',description=coalesce(p_data->>'description',''),category_id=(p_data->>'categoryId')::uuid,tags=array(select jsonb_array_elements_text(p_data->'tags')),fit=p_data->>'fit',material=p_data->>'material',care=array(select jsonb_array_elements_text(p_data->'care')),size_guide_id=(p_data->>'sizeGuideId')::uuid,featured_rank=(p_data->>'featuredRank')::integer,status='draft' where id=p_id;
  new_id:=p_id;
 else
  if p_version is not null then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
  insert into public.products(title,slug,description,category_id,tags,fit,material,care,size_guide_id,featured_rank,is_demo)
   values(p_data->>'title',p_data->>'slug',coalesce(p_data->>'description',''),(p_data->>'categoryId')::uuid,array(select jsonb_array_elements_text(p_data->'tags')),p_data->>'fit',p_data->>'material',array(select jsonb_array_elements_text(p_data->'care')),(p_data->>'sizeGuideId')::uuid,(p_data->>'featuredRank')::integer,p_mode<>'live') returning id into new_id;
 end if;
 perform public.record_audit('admin','catalog.product.save','product',new_id::text,jsonb_build_object('previousVersion',old_row.version,'status','draft'),null,null,p_actor);
 return public.admin_product_json(new_id,p_mode);
end $$;

create function public.admin_replace_variants(p_actor uuid,p_id uuid,p_version integer,p_variants jsonb,p_mode text default 'fixture') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.products; v jsonb; variant_id uuid; key text; seen uuid[]:='{}';
begin
 perform public.require_admin_actor(p_actor);
 if p_variants is null or jsonb_typeof(p_variants)<>'array' or jsonb_array_length(p_variants)>200 then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 select * into p from public.products where id=p_id for update;
 if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 if p.version is distinct from p_version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',p.version)::text; end if;
 if exists(select 1 from jsonb_array_elements(p_variants) a group by a->>'sku' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_variants) a group by a->>'colorKey',a->>'size' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_variants) a where a->>'id' is not null group by a->>'id' having count(*)>1) then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 for v in select value from jsonb_array_elements(p_variants) loop
  if jsonb_typeof(v)<>'object' then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
  for key in select jsonb_object_keys(v) loop if key not in ('id','sku','colorKey','colorLabel','colorHex','size','pricePaise','compareAtPaise','taxCategoryKey','unitWeightG','enabled') then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if; end loop;
  if coalesce(length(btrim(v->>'sku')),0) not between 1 and 100 or coalesce(length(btrim(v->>'colorLabel')),0) not between 1 and 200 or jsonb_typeof(v->'enabled') is distinct from 'boolean' then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
  variant_id:=(v->>'id')::uuid;
  if variant_id is null then
   insert into public.product_variants(product_id,sku,color_key,color_label,color_hex,size,price_paise,compare_at_paise,tax_category_key,unit_weight_g,enabled)
    values(p_id,v->>'sku',v->>'colorKey',v->>'colorLabel',v->>'colorHex',v->>'size',(v->>'pricePaise')::bigint,(v->>'compareAtPaise')::bigint,v->>'taxCategoryKey',(v->>'unitWeightG')::integer,(v->>'enabled')::boolean) returning id into variant_id;
   insert into public.inventory(variant_id) values(variant_id);
  else
   if not exists(select 1 from public.product_variants where id=variant_id and product_id=p_id) then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
   update public.product_variants set sku=v->>'sku',color_key=v->>'colorKey',color_label=v->>'colorLabel',color_hex=v->>'colorHex',size=v->>'size',price_paise=(v->>'pricePaise')::bigint,compare_at_paise=(v->>'compareAtPaise')::bigint,tax_category_key=v->>'taxCategoryKey',unit_weight_g=(v->>'unitWeightG')::integer,enabled=(v->>'enabled')::boolean where id=variant_id;
  end if;
  seen:=array_append(seen,variant_id);
 end loop;
 update public.product_variants set enabled=false where product_id=p_id and not(id=any(seen)) and enabled;
 update public.products set status='draft' where id=p_id;
 perform public.record_audit('admin','catalog.variants.save','product',p_id::text,jsonb_build_object('variantCount',jsonb_array_length(p_variants)),null,null,p_actor);
 return public.admin_product_json(p_id,p_mode);
end $$;

create function public.admin_set_product_packaging(p_actor uuid,p_id uuid,p_version integer,p_preset_ids uuid[],p_mode text default 'fixture') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.products;
begin
 perform public.require_admin_actor(p_actor);
 if p_preset_ids is null or cardinality(p_preset_ids)>50 or exists(select 1 from unnest(p_preset_ids) as input(id) where input.id is null or not exists(select 1 from public.packaging_presets ps where ps.id=input.id)) then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 select * into p from public.products where id=p_id for update;
 if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 if p.version is distinct from p_version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',p.version)::text; end if;
 delete from public.product_packaging where product_id=p_id;
 insert into public.product_packaging(product_id,preset_id) select p_id,id from unnest(p_preset_ids) id;
 update public.products set status='draft' where id=p_id;
 perform public.record_audit('admin','catalog.packaging.save','product',p_id::text,jsonb_build_object('presetIds',p_preset_ids),null,null,p_actor);
 return public.admin_product_json(p_id,p_mode);
end $$;

create function public.admin_save_size_guide(p_actor uuid,p_id uuid,p_version integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_row public.size_guides; new_id uuid; values_data jsonb; key text;
begin
 perform public.require_admin_actor(p_actor);
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 for key in select jsonb_object_keys(p_data) loop if key not in ('title','measurementType','instructions','valuesCm','isDemo') then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if; end loop;
 values_data:=p_data->'valuesCm';
 if coalesce(length(btrim(p_data->>'title')),0) not between 1 and 200 or coalesce(length(btrim(p_data->>'instructions')),0) not between 1 and 5000 or (p_data->>'measurementType') not in ('garment','body') or jsonb_typeof(p_data->'isDemo') is distinct from 'boolean'
 or jsonb_typeof(values_data->'columns') is distinct from 'array' or jsonb_typeof(values_data->'rows') is distinct from 'array' then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 if jsonb_array_length(values_data->'columns') not between 1 and 30 or jsonb_array_length(values_data->'rows') not between 1 and 7 then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 if exists(select 1 from jsonb_array_elements(values_data->'columns') c where coalesce(c->>'key','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or coalesce(length(btrim(c->>'label')),0)=0)
 or exists(select 1 from jsonb_array_elements(values_data->'columns') c group by c->>'key' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(values_data->'rows') r group by r->>'size' having count(*)>1) then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 for values_data in select value from jsonb_array_elements(p_data#>'{valuesCm,rows}') loop
  if coalesce(values_data->>'size','') not in ('XS','S','M','L','XL','XXL','ONE_SIZE') or jsonb_typeof(values_data->'values') is distinct from 'object' then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
  if (select count(*) from jsonb_object_keys(values_data->'values'))<>(select jsonb_array_length(p_data#>'{valuesCm,columns}')) or exists(select 1 from jsonb_array_elements(p_data#>'{valuesCm,columns}') c where not(values_data->'values' ? (c->>'key'))) or exists(select 1 from jsonb_each(values_data->'values') x where jsonb_typeof(x.value)<>'number' or (x.value::text)::numeric<=0) then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 end loop;
 if p_id is not null then
  select * into old_row from public.size_guides where id=p_id for update;
  if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
  if old_row.version is distinct from p_version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',old_row.version)::text; end if;
  update public.size_guides set title=p_data->>'title',measurement_type=p_data->>'measurementType',instructions=p_data->>'instructions',values_cm=p_data->'valuesCm',is_demo=(p_data->>'isDemo')::boolean where id=p_id;
  new_id:=p_id;
 else
  if p_version is not null then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
  insert into public.size_guides(title,measurement_type,instructions,values_cm,is_demo) values(p_data->>'title',p_data->>'measurementType',p_data->>'instructions',p_data->'valuesCm',(p_data->>'isDemo')::boolean) returning id into new_id;
 end if;
 perform public.record_audit('admin','catalog.size_guide.save','size_guide',new_id::text,jsonb_build_object('previousVersion',old_row.version),null,null,p_actor);
 return (select jsonb_build_object('id',id,'title',title,'measurementType',measurement_type,'instructions',instructions,'valuesCm',values_cm,'isDemo',is_demo,'version',version) from public.size_guides where id=new_id);
end $$;

create function public.admin_adjust_inventory(p_actor uuid,p_variant_id uuid,p_delta integer,p_expected_version integer,p_reason text,p_operation_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.inventory; previous public.inventory_movements; result jsonb; scoped_key text; operation public.external_operations; request_hash text;
begin
 perform public.require_admin_actor(p_actor);
 if p_delta is null or p_delta=0 or p_expected_version is null or p_expected_version<1 or coalesce(length(btrim(p_reason)),0) not between 1 and 500 or coalesce(length(p_operation_key),0) not between 1 and 150 then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 scoped_key:='admin:'||p_actor::text||':'||p_operation_key;
 perform pg_advisory_xact_lock(hashtextextended(scoped_key,0));
 request_hash:=encode(sha256(convert_to(jsonb_build_object('variantId',p_variant_id,'delta',p_delta,'expectedVersion',p_expected_version,'reason',p_reason)::text,'UTF8')),'hex');
 operation:=public.begin_operation('inventory.adjust',p_actor::text,p_operation_key,request_hash);
 if operation.status='succeeded' then return operation.result_json||jsonb_build_object('replayed',true); end if;
 select * into i from public.inventory where variant_id=p_variant_id for update;
 if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 if i.version is distinct from p_expected_version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',i.version)::text; end if;
 if i.on_hand::bigint+p_delta<i.reserved or i.on_hand::bigint+p_delta>2147483647 then raise exception using errcode='P0001',message='STOCK_CONFLICT'; end if;
 update public.inventory set on_hand=on_hand+p_delta where variant_id=p_variant_id returning * into i;
 insert into public.inventory_movements(variant_id,kind,on_hand_delta,reason,actor_user_id,operation_key) values(p_variant_id,'adjust',p_delta,p_reason,p_actor,scoped_key) returning * into previous;
 perform public.record_audit('admin','inventory.adjust','variant',p_variant_id::text,jsonb_build_object('delta',p_delta,'onHand',i.on_hand,'version',i.version),p_reason,null,p_actor);
 result:=jsonb_build_object('movementId',previous.id,'replayed',false);
 update public.external_operations set status='succeeded',result_json=result where id=operation.id;
 return result;
end $$;

create function public.admin_publish_product(p_actor uuid,p_id uuid,p_version integer,p_mode text default 'fixture') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.products; missing text[];
begin
 perform public.require_admin_actor(p_actor);
 if p_mode not in ('fixture','test','live') then raise exception using errcode='P0001',message='INVALID_PAYLOAD'; end if;
 select * into p from public.products where id=p_id for update;
 if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 if p.version is distinct from p_version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',p.version)::text; end if;
 missing:=public.product_publication_missing(p_id,p_mode);
 if cardinality(missing)>0 then raise exception using errcode='P0001',message='PUBLISH_INCOMPLETE',detail=jsonb_build_object('fieldErrors',jsonb_build_object('publication',missing))::text; end if;
 perform 1 from public.media_assets m join public.product_media pm on pm.media_id=m.id where pm.product_id=p_id order by m.id for update of m;
 if exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p_id and (m.status not in ('publishing','published') or m.public_key is null)) then raise exception using errcode='P0001',message='MEDIA_NOT_READY'; end if;
 if exists(select 1 from public.product_media pm join public.media_assets m on m.id=pm.media_id left join public.media_assets poster on poster.id=m.poster_media_id where pm.product_id=p_id and m.type='video' and (poster.status not in ('publishing','published') or poster.public_key is null)) then raise exception using errcode='P0001',message='MEDIA_NOT_READY'; end if;
 update public.media_assets set status='published' where status='publishing' and (id in(select media_id from public.product_media where product_id=p_id) or id in(select m.poster_media_id from public.product_media pm join public.media_assets m on m.id=pm.media_id where pm.product_id=p_id));
 update public.products set status='published',published_at=coalesce(published_at,now()) where id=p_id;
 perform public.record_audit('admin','catalog.product.publish','product',p_id::text,jsonb_build_object('previousVersion',p.version,'status','published'),null,null,p_actor);
 return public.admin_product_json(p_id,p_mode);
end $$;

create function public.admin_archive_product(p_actor uuid,p_id uuid,p_version integer,p_mode text default 'fixture') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.products;
begin
 perform public.require_admin_actor(p_actor); select * into p from public.products where id=p_id for update;
 if not found then raise exception using errcode='P0001',message='NOT_FOUND'; end if;
 if p.version is distinct from p_version then raise exception using errcode='P0001',message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',p.version)::text; end if;
 update public.products set status='archived' where id=p_id;
 perform public.record_audit('admin','catalog.product.archive','product',p_id::text,jsonb_build_object('previousVersion',p.version,'status','archived'),null,null,p_actor);
 return public.admin_product_json(p_id,p_mode);
end $$;

do $$ declare routine regprocedure; begin
 for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('require_admin_actor','product_publication_missing','admin_product_json','admin_catalog','admin_get_product','admin_save_product','admin_replace_variants','admin_set_product_packaging','admin_save_size_guide','admin_adjust_inventory','admin_publish_product','admin_archive_product') loop
  execute format('revoke all on function %s from public,anon,authenticated',routine);
  execute format('grant execute on function %s to service_role',routine);
 end loop;
end $$;
commit;
