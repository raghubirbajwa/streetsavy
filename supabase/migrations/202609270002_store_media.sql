begin;
-- Public content references may point to media not attached to a product.
-- Resolve only published objects, never staging keys, rights records or uploader data.
create function public.public_media_details(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'publicKey',m.public_key,'type',m.type,'width',m.width,'height',m.height,'alt',m.alt,
    'focalX',m.focal_x,'focalY',m.focal_y,
    'posterKey',case when poster.status='published' and poster.type='image' then poster.public_key else null end
  ) order by m.id),'[]'::jsonb)
  from public.media_assets m left join public.media_assets poster on poster.id=m.poster_media_id
  where m.id=any(p_ids) and cardinality(p_ids)<=50 and m.status='published';
$$;
revoke all on function public.public_media_details(uuid[]) from public;
grant execute on function public.public_media_details(uuid[]) to anon,authenticated,service_role;
commit;
