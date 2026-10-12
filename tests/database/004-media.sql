-- Real SQL permissions/lifecycle checks; runner wraps this file in a rollback.
create function pg_temp.media_assert(value boolean, label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'Media assertion failed: %',label; end if; end $$;
create function pg_temp.media_error(statement text, expected text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise exception 'Expected %, got %',expected,sqlerrm; end;
 raise exception 'Expected error %, but operation succeeded',expected;
end $$;

insert into auth.users(id) values('41000000-0000-4000-8000-000000000001'),('41000000-0000-4000-8000-000000000002');
insert into admin_memberships(user_id,role) values('41000000-0000-4000-8000-000000000001','staff');
insert into categories(id,slug,name,active) values('42000000-0000-4000-8000-000000000001','media-test','Media test',true);
insert into products(id,slug,title,category_id) values('43000000-0000-4000-8000-000000000001','media-product','Media product','42000000-0000-4000-8000-000000000001');
insert into product_variants(id,product_id,sku,color_key,color_label,size,price_paise,unit_weight_g) values('44000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','MEDIA-TEST-S','black','Black','S',100,100);
select pg_temp.media_assert(not has_function_privilege('anon','public.admin_media(uuid,text,jsonb)','execute'),'anon cannot invoke media mutations');
select pg_temp.media_assert(not has_function_privilege('authenticated','public.admin_media(uuid,text,jsonb)','execute'),'authenticated cannot forge actor through media RPC');
select pg_temp.media_assert((select proconfig @> array['search_path=""'] from pg_proc where oid='public.admin_media(uuid,text,jsonb)'::regprocedure),'fixed media RPC search path');

set local role service_role;
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000002','list','{}')$q$,'FORBIDDEN');
select public.admin_media('41000000-0000-4000-8000-000000000001','create','{"id":"45000000-0000-4000-8000-000000000001","fileName":"fixture.png","kind":"image","contentType":"image/png","sizeBytes":100,"tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','authorize_upload','{"id":"45000000-0000-4000-8000-000000000001","tokenHash":"bad"}')$q$,'UPLOAD_EXPIRED');
select public.admin_media('41000000-0000-4000-8000-000000000001','authorize_upload','{"id":"45000000-0000-4000-8000-000000000001","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
select public.admin_media('41000000-0000-4000-8000-000000000001','claim_validation','{"id":"45000000-0000-4000-8000-000000000001","lease":"46000000-0000-4000-8000-000000000001"}');
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','claim_validation','{"id":"45000000-0000-4000-8000-000000000001","lease":"46000000-0000-4000-8000-000000000002"}')$q$,'MEDIA_BUSY');
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','ready','{"id":"45000000-0000-4000-8000-000000000001","lease":"46000000-0000-4000-8000-000000000002"}')$q$,'MEDIA_STATE_CONFLICT');
select public.admin_media('41000000-0000-4000-8000-000000000001','ready','{"id":"45000000-0000-4000-8000-000000000001","lease":"46000000-0000-4000-8000-000000000001","contentType":"image/webp","sizeBytes":80,"width":40,"height":60,"durationSeconds":null,"checksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","validatedKey":"validated/45000000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp"}');
select public.admin_media('41000000-0000-4000-8000-000000000001','edit','{"id":"45000000-0000-4000-8000-000000000001","version":3,"alt":"Media test","source":"Generated test","license":"Original test","focalX":0.5,"focalY":0.5,"posterMediaId":null}');
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','set_attachments','{"productId":"43000000-0000-4000-8000-000000000001","version":1,"items":[{"mediaId":"45000000-0000-4000-8000-000000000001","colorKey":"purple","isCover":true}]}')$q$,'MEDIA_COLOR_INVALID');
select public.admin_media('41000000-0000-4000-8000-000000000001','set_attachments','{"productId":"43000000-0000-4000-8000-000000000001","version":1,"items":[{"mediaId":"45000000-0000-4000-8000-000000000001","colorKey":"black","isCover":true}]}');
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','set_attachments','{"productId":"43000000-0000-4000-8000-000000000001","version":1,"items":[]}')$q$,'VERSION_CONFLICT');
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','delete','{"id":"45000000-0000-4000-8000-000000000001","version":4}')$q$,'MEDIA_IN_USE');
select public.admin_media('41000000-0000-4000-8000-000000000001','prepare_product','{"productId":"43000000-0000-4000-8000-000000000001","version":2}');
select public.admin_media('41000000-0000-4000-8000-000000000001','finish_promotion','{"id":"45000000-0000-4000-8000-000000000001","publicKey":"catalog/45000000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp","checksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
set local role anon;
select pg_temp.media_assert(public.public_media('catalog/45000000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp') is null,'promotion copy is private until final publish commit');
select pg_temp.media_assert(public.public_media('staging/45000000-0000-4000-8000-000000000001/original') is null,'staging key is never public');
reset role;
update media_assets set status='published' where id='45000000-0000-4000-8000-000000000001';
set local role anon;
select pg_temp.media_assert(public.public_media('catalog/45000000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp')->>'contentType'='image/webp','published media can be read through safe projection');
select pg_temp.media_assert(not public.public_media('catalog/45000000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp') ? 'stage_key','public projection hides staging key');
reset role;
insert into media_assets(stage_key,type,status,content_type,size_bytes,created_at) select 'staging/'||gen_random_uuid()::text||'/original','image','uploading','image/png',10,now()-interval '25 hours' from generate_series(1,21);
set local role service_role;
select pg_temp.media_assert(jsonb_array_length(public.admin_media('41000000-0000-4000-8000-000000000001','cleanup','{}'))=20,'cleanup claims at most twenty expired unattached rows');
reset role;
update admin_memberships set enabled=false where user_id='41000000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.media_error($q$select public.admin_media('41000000-0000-4000-8000-000000000001','get','{"id":"45000000-0000-4000-8000-000000000001"}')$q$,'FORBIDDEN');
reset role;
