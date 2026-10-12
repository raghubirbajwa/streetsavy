begin;
alter table public.media_assets
 add column upload_token_hash text check (upload_token_hash is null or upload_token_hash ~ '^[0-9a-f]{64}$'),
 add column upload_expires_at timestamptz,
 add column upload_received_at timestamptz,
 add column requested_content_type text,
 add column requested_size_bytes bigint,
 add column validated_key text,
 add column validation_lease uuid,
 add column validating_until timestamptz;
create index media_cleanup_due on public.media_assets(status,created_at) where status in ('uploading','rejected','deleting');

create function public.media_referenced(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_media where media_id=p_id)
 or exists(select 1 from public.collections c where cover_media_id=p_id or to_jsonb(c)->'draft_payload'->>'coverMediaId'=p_id::text)
 or exists(select 1 from public.media_assets where poster_media_id=p_id)
 or exists(select 1 from public.order_items i join public.media_assets m on m.id=p_id where i.image_key=m.public_key or i.image_key=m.stage_key)
 or exists(select 1 from public.site_content where draft_payload::text like '%'||p_id::text||'%' or published_payload::text like '%'||p_id::text||'%');
$$;
revoke all on function public.media_referenced(uuid) from public,anon,authenticated;
grant execute on function public.media_referenced(uuid) to service_role;

create function public.admin_media(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.media_assets; p public.products; v_id uuid; v_result jsonb; v_item jsonb; v_position integer:=0; v_version integer; v_key text; v_lease uuid;
begin
 perform public.require_admin_actor(p_actor);
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID_FIELDS'; end if;
 if p_action='list' then
   return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id) from (select * from public.media_assets where status<>'deleting' order by created_at desc,id limit 200) q),'[]');
 elsif p_action='get' then
   select * into m from public.media_assets where id=(p_data->>'id')::uuid;
   if not found then raise exception 'NOT_FOUND'; end if; return to_jsonb(m);
 elsif p_action='attachments' then
   select * into p from public.products where id=(p_data->>'productId')::uuid;
   if not found then raise exception 'NOT_FOUND'; end if;
   return jsonb_build_object('version',p.version,'items',coalesce((select jsonb_agg(jsonb_build_object('mediaId',media_id,'colorKey',color_key,'isCover',is_cover) order by sort_order,media_id) from public.product_media where product_id=p.id),'[]'),
     'colors',coalesce((select jsonb_agg(jsonb_build_object('key',color_key,'label',color_label) order by color_key) from (select distinct color_key,color_label from public.product_variants where product_id=p.id) c),'[]'));
 elsif p_action='create' then
   v_id:=(p_data->>'id')::uuid;
   if p_data->>'contentType' not in ('image/jpeg','image/png','image/webp','image/avif','video/mp4') or (p_data->>'sizeBytes')::bigint<=0
      or (p_data->>'sizeBytes')::bigint>(case when p_data->>'contentType'='video/mp4' then 52428800 else 10485760 end)
      or (p_data->>'kind'='video') is distinct from (p_data->>'contentType'='video/mp4') then raise exception 'INVALID_FIELDS'; end if;
   insert into public.media_assets(id,stage_key,type,status,content_type,size_bytes,alt,uploaded_by,upload_token_hash,upload_expires_at,requested_content_type,requested_size_bytes,source_details)
   values(v_id,'staging/'||v_id::text||'/original',p_data->>'kind','uploading',p_data->>'contentType',(p_data->>'sizeBytes')::bigint,'',p_actor,p_data->>'tokenHash',now()+interval '5 minutes',p_data->>'contentType',(p_data->>'sizeBytes')::bigint,jsonb_build_object('fileName',left(p_data->>'fileName',180))) returning * into m;
   v_result:=to_jsonb(m);
 elsif p_action='set_attachments' then
   select * into p from public.products where id=(p_data->>'productId')::uuid for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if p.version is distinct from (p_data->>'version')::integer then raise exception using message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',p.version)::text; end if;
   if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')>24 then raise exception 'INVALID_FIELDS'; end if;
   if (select count(*)<>count(distinct value->>'mediaId') from jsonb_array_elements(p_data->'items')) then raise exception 'INVALID_FIELDS'; end if;
   if exists(select 1 from jsonb_array_elements(p_data->'items') where (value->>'isCover')::boolean group by coalesce(value->>'colorKey','') having count(*)>1) then raise exception 'MEDIA_COVER_CONFLICT'; end if;
   for v_item in select value from jsonb_array_elements(p_data->'items') loop
     select * into m from public.media_assets where id=(v_item->>'mediaId')::uuid for update;
     if not found or m.status not in ('ready','publishing','published') then raise exception 'MEDIA_NOT_READY'; end if;
     if v_item->>'colorKey' is not null and not exists(select 1 from public.product_variants where product_id=p.id and color_key=v_item->>'colorKey') then raise exception 'MEDIA_COLOR_INVALID'; end if;
   end loop;
   delete from public.product_media where product_id=p.id;
   for v_item in select value from jsonb_array_elements(p_data->'items') loop
     insert into public.product_media(product_id,media_id,color_key,sort_order,is_cover) values(p.id,(v_item->>'mediaId')::uuid,v_item->>'colorKey',v_position,(v_item->>'isCover')::boolean);
     v_position:=v_position+1;
   end loop;
   update public.products set status='draft',version=version+1,updated_at=now() where id=p.id returning version into v_version;
   v_id:=p.id; v_result:=jsonb_build_object('version',v_version);
 elsif p_action='prepare_product' then
   select * into p from public.products where id=(p_data->>'productId')::uuid for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if p.version is distinct from (p_data->>'version')::integer then raise exception using message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',p.version)::text; end if;
   for m in select ma.* from public.media_assets ma join public.product_media pm on pm.media_id=ma.id where pm.product_id=p.id order by ma.id for update of ma loop
     if m.status not in ('ready','publishing','published') or m.checksum is null or m.width is null or m.height is null or length(btrim(m.alt))=0 then raise exception 'MEDIA_NOT_READY'; end if;
     if m.type='video' and (m.duration_seconds>30 or m.poster_media_id is null or not exists(select 1 from public.media_assets where id=m.poster_media_id and type='image' and status in ('ready','publishing','published') and length(btrim(alt))>0 and coalesce(nullif(btrim(source_details->>'source'),''),nullif(btrim(source_details->>'creator'),'')) is not null and length(btrim(coalesce(license_details->>'license','')))>0)) then raise exception 'MEDIA_POSTER_REQUIRED'; end if;
     if m.status='ready' then update public.media_assets set status='publishing',version=version+1,updated_at=now() where id=m.id; end if;
   end loop;
   -- Posters are also promoted before a video can be published.
   update public.media_assets set status='publishing',version=version+1,updated_at=now() where status='ready' and id in (select ma.poster_media_id from public.media_assets ma join public.product_media pm on ma.id=pm.media_id where pm.product_id=p.id);
   v_result:=coalesce((select jsonb_agg(to_jsonb(ma) order by ma.id) from public.media_assets ma where ma.id in (select media_id from public.product_media where product_id=p.id) or ma.id in (select m2.poster_media_id from public.media_assets m2 join public.product_media pm on pm.media_id=m2.id where pm.product_id=p.id)),'[]'); v_id:=p.id;
 elsif p_action='prepare_ids' then
   if jsonb_typeof(p_data->'ids') is distinct from 'array' or jsonb_array_length(p_data->'ids')>40 then raise exception 'INVALID_FIELDS'; end if;
   for v_item in select value from jsonb_array_elements(p_data->'ids') loop
     select * into m from public.media_assets where id=(v_item#>>'{}')::uuid for update;
     if not found then raise exception 'NOT_FOUND'; end if;
     if m.status not in ('ready','publishing','published') or m.checksum is null or m.width is null or m.height is null or length(btrim(m.alt))=0
       or coalesce(nullif(btrim(m.source_details->>'source'),''),nullif(btrim(m.source_details->>'creator'),'')) is null or length(btrim(coalesce(m.license_details->>'license','')))=0 then raise exception 'MEDIA_NOT_READY'; end if;
     if m.type='video' and (m.duration_seconds>30 or m.poster_media_id is null or not exists(select 1 from public.media_assets where id=m.poster_media_id and type='image' and status in ('ready','publishing','published') and length(btrim(alt))>0 and coalesce(nullif(btrim(source_details->>'source'),''),nullif(btrim(source_details->>'creator'),'')) is not null and length(btrim(coalesce(license_details->>'license','')))>0)) then raise exception 'MEDIA_POSTER_REQUIRED'; end if;
     if m.status='ready' then update public.media_assets set status='publishing',version=version+1,updated_at=now() where id=m.id; end if;
   end loop;
   update public.media_assets set status='publishing',version=version+1,updated_at=now() where status='ready' and id in (select poster_media_id from public.media_assets where id in (select value::uuid from jsonb_array_elements_text(p_data->'ids')));
   v_result:=coalesce((select jsonb_agg(to_jsonb(ma) order by ma.id) from public.media_assets ma where ma.id in (select value::uuid from jsonb_array_elements_text(p_data->'ids')) or ma.id in (select poster_media_id from public.media_assets where id in (select value::uuid from jsonb_array_elements_text(p_data->'ids')))),'[]');
 elsif p_action='cleanup' then
   with due as (select id from public.media_assets where status in ('uploading','rejected','deleting') and created_at<now()-interval '24 hours' and not public.media_referenced(id) and coalesce(last_error,'')<>'CLEANED' order by created_at,id limit 20 for update skip locked),
   changed as (update public.media_assets set status='deleting',upload_token_hash=null,version=version+1,updated_at=now() where id in (select id from due) returning *)
   select coalesce(jsonb_agg(to_jsonb(changed)),'[]') into v_result from changed;
 else
   v_id:=(p_data->>'id')::uuid; select * into m from public.media_assets where id=v_id for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if p_action='authorize_upload' then
     if m.status<>'uploading' or m.uploaded_by<>p_actor or m.upload_expires_at<=now() or m.upload_token_hash is distinct from p_data->>'tokenHash' then raise exception 'UPLOAD_EXPIRED'; end if;
     return to_jsonb(m);
   elsif p_action='received' then
     if m.status<>'uploading' then raise exception 'MEDIA_STATE_CONFLICT'; end if;
     update public.media_assets set upload_received_at=now(),updated_at=now() where id=v_id returning * into m;
   elsif p_action='claim_validation' then
     if m.status in ('ready','publishing','published') then return to_jsonb(m); end if;
     if m.status='validating' and m.validating_until>now() then raise exception 'MEDIA_BUSY'; end if;
     if m.status not in ('uploading','validating') then raise exception 'MEDIA_STATE_CONFLICT'; end if;
     v_lease:=(p_data->>'lease')::uuid;
     update public.media_assets set status='validating',validation_lease=v_lease,validating_until=now()+interval '2 minutes',upload_token_hash=null,version=version+1,updated_at=now() where id=v_id returning * into m;
   elsif p_action in ('ready','reject') then
     if m.status<>'validating' or m.validation_lease is distinct from (p_data->>'lease')::uuid then raise exception 'MEDIA_STATE_CONFLICT'; end if;
     if p_action='ready' then
       if p_data->>'contentType' not in ('image/webp','video/mp4') or (p_data->>'width')::integer<=0 or (p_data->>'height')::integer<=0 or (p_data->>'sizeBytes')::bigint<=0
          or p_data->>'checksum' !~ '^[0-9a-f]{64}$' or p_data->>'validatedKey' <> 'validated/'||v_id::text||'/'||(p_data->>'checksum')||(case when m.type='video' then '.mp4' else '.webp' end)
          or (m.type='video' and (p_data->>'contentType'<>'video/mp4' or p_data->>'durationSeconds' is null or (p_data->>'durationSeconds')::numeric not between 0.001 and 30))
          or (m.type='image' and (p_data->>'contentType'<>'image/webp' or p_data->>'durationSeconds' is not null)) then raise exception 'INVALID_FIELDS'; end if;
       update public.media_assets set status='ready',content_type=p_data->>'contentType',size_bytes=(p_data->>'sizeBytes')::bigint,width=(p_data->>'width')::integer,height=(p_data->>'height')::integer,
         duration_seconds=(p_data->>'durationSeconds')::numeric,checksum=p_data->>'checksum',validated_key=p_data->>'validatedKey',validation_lease=null,validating_until=null,last_error=null,version=version+1,updated_at=now() where id=v_id returning * into m;
     else
       update public.media_assets set status=case when coalesce((p_data->>'retryable')::boolean,false) then 'uploading' else 'rejected' end,
         last_error=left(p_data->>'code',100),validation_lease=null,validating_until=null,version=version+1,updated_at=now() where id=v_id returning * into m;
     end if;
   elsif p_action='finish_promotion' then
     if m.status='published' then return to_jsonb(m); end if;
     v_key:='catalog/'||m.id::text||'/'||m.checksum||case when m.type='video' then '.mp4' else '.webp' end;
     if m.status<>'publishing' or p_data->>'publicKey'<>v_key or p_data->>'checksum'<>m.checksum then raise exception 'MEDIA_STATE_CONFLICT'; end if;
     update public.media_assets set public_key=v_key,version=version+case when public_key is null then 1 else 0 end,updated_at=now() where id=v_id returning * into m;
   elsif p_action='edit' then
     if m.version is distinct from (p_data->>'version')::integer then raise exception using message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',m.version)::text; end if;
     if m.status in ('deleting','validating','publishing') then raise exception 'MEDIA_STATE_CONFLICT'; end if;
     if length(btrim(p_data->>'alt')) not between 1 and 500 or length(btrim(p_data->>'source')) not between 1 and 500 or length(btrim(p_data->>'license')) not between 1 and 500 then raise exception 'INVALID_FIELDS'; end if;
     if p_data->>'posterMediaId' is not null and not exists(select 1 from public.media_assets where id=(p_data->>'posterMediaId')::uuid and type='image' and status in ('ready','published')) then raise exception 'MEDIA_POSTER_REQUIRED'; end if;
     update public.media_assets set alt=p_data->>'alt',focal_x=(p_data->>'focalX')::numeric,focal_y=(p_data->>'focalY')::numeric,poster_media_id=(p_data->>'posterMediaId')::uuid,
       source_details=source_details||jsonb_build_object('source',p_data->>'source'),license_details=license_details||jsonb_build_object('license',p_data->>'license'),version=version+1,updated_at=now() where id=v_id returning * into m;
   elsif p_action='delete' then
     if m.version is distinct from (p_data->>'version')::integer then raise exception using message='VERSION_CONFLICT',detail=jsonb_build_object('currentVersion',m.version)::text; end if;
     if public.media_referenced(v_id) or m.status in ('published','publishing','validating') then raise exception 'MEDIA_IN_USE'; end if;
     update public.media_assets set status='deleting',upload_token_hash=null,version=version+1,updated_at=now() where id=v_id returning * into m;
   elsif p_action='deleted' then
     if m.status<>'deleting' or public.media_referenced(v_id) then raise exception 'MEDIA_IN_USE'; end if;
     update public.media_assets set validated_key=null,last_error='CLEANED',updated_at=now() where id=v_id returning * into m;
   else raise exception 'NOT_FOUND'; end if;
   v_result:=to_jsonb(m);
 end if;
 insert into public.audit_logs(actor_user_id,actor,action,entity_type,entity_id,diff) values(p_actor,'admin','media.'||p_action,'media',v_id::text,'{}');
 return v_result;
end $$;
revoke all on function public.admin_media(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_media(uuid,text,jsonb) to service_role;

create function public.public_media(p_key text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'publicKey',public_key,'contentType',content_type,'sizeBytes',size_bytes,'checksum',checksum)
 from public.media_assets where public_key=p_key and status='published';
$$;
revoke all on function public.public_media(text) from public,anon,authenticated;
grant execute on function public.public_media(text) to anon,authenticated,service_role;
commit;
