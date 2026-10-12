-- Safe public content media lookup, including videos whose posters are private.
create function pg_temp.display_assert(value boolean, label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'Display media assertion failed: %',label; end if; end $$;
insert into public.media_assets(id,stage_key,public_key,type,status,content_type,size_bytes,width,height,alt,source_details,license_details)
values
('71000000-0000-4000-8000-000000000001','private/poster','public/poster.webp','image','ready','image/webp',100,600,800,'Poster','{"source":"private source"}','{"license":"private license"}'),
('71000000-0000-4000-8000-000000000002','private/video','public/video.mp4','video','published','video/mp4',200,600,800,'Published campaign','{}','{}'),
('71000000-0000-4000-8000-000000000003','private/image','public/image.webp','image','published','image/webp',100,600,800,'Published image','{}','{}');
update public.media_assets set poster_media_id='71000000-0000-4000-8000-000000000001' where id='71000000-0000-4000-8000-000000000002';
set local role anon;
select pg_temp.display_assert(jsonb_array_length(public.public_media_details(array['71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002']::uuid[]))=1,'private media omitted');
select pg_temp.display_assert(public.public_media_details(array['71000000-0000-4000-8000-000000000002']::uuid[])->0->'posterKey'='null'::jsonb,'private poster omitted');
select pg_temp.display_assert(not (public.public_media_details(array['71000000-0000-4000-8000-000000000003']::uuid[])->0 ?| array['stage_key','source_details','license_details','uploaded_by']),'private fields omitted');
select pg_temp.display_assert(public.public_media_details(array_fill('71000000-0000-4000-8000-000000000003'::uuid,array[51]))='[]'::jsonb,'lookup bound enforced');
reset role;
update public.media_assets set status='published' where id='71000000-0000-4000-8000-000000000001';
set local role anon;
select pg_temp.display_assert(public.public_media_details(array['71000000-0000-4000-8000-000000000002']::uuid[])->0->>'posterKey'='public/poster.webp','published poster resolves');
reset role;
