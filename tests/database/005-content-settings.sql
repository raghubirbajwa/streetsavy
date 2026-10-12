-- Runner executes this file inside a rolled-back transaction.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003') on conflict do nothing;
insert into public.admin_memberships(user_id,role) values ('00000000-0000-4000-8000-000000000001','owner'),('00000000-0000-4000-8000-000000000002','staff') on conflict do nothing;
insert into public.categories(id,slug,name) values('91000000-0000-4000-8000-000000000001','content-test','Content test');
insert into public.products(id,slug,title,category_id,status,published_at) values
 ('92000000-0000-4000-8000-000000000001','content-public','Published content product','91000000-0000-4000-8000-000000000001','published',now()),
 ('92000000-0000-4000-8000-000000000002','content-draft','Private content product','91000000-0000-4000-8000-000000000001','draft',null);
insert into public.media_assets(id,stage_key,public_key,type,status,content_type,size_bytes,width,height,alt) values
 ('93000000-0000-4000-8000-000000000001','content-test-stage','catalog/content-test.png','image','published','image/png',128,10,10,'Fixture image');

set local role service_role;
do $$
declare
 owner_id uuid:='00000000-0000-4000-8000-000000000001'; staff_id uuid:='00000000-0000-4000-8000-000000000002'; customer_id uuid:='00000000-0000-4000-8000-000000000003';
 c_id uuid; d jsonb; h jsonb; s jsonb; w jsonb; p jsonb; v integer; wh_id uuid;
begin
 d:='{"title":"Public edit","slug":"m2-content-edit","description":"Public description","coverMediaId":"93000000-0000-4000-8000-000000000001","productIds":["92000000-0000-4000-8000-000000000001"],"sortOrder":0,"active":true}';
 begin perform public.admin_save_collection(customer_id,null,0,d); raise exception 'expected denial'; exception when raise_exception then assert sqlerrm='FORBIDDEN'; end;
 c_id:=public.admin_save_collection(staff_id,null,0,d);
 assert not exists(select 1 from jsonb_array_elements(public.public_catalog()->'collections') x where x->>'id'=c_id::text),'new draft not public';
 perform public.admin_publish_collection(staff_id,c_id,1);
 assert exists(select 1 from jsonb_array_elements(public.public_catalog()->'collections') x where x->>'id'=c_id::text and x->>'title'='Public edit');
 d:=jsonb_set(d,'{title}','"PRIVATE UNSAVED TITLE"');
 perform public.admin_save_collection(staff_id,c_id,2,d);
 assert exists(select 1 from jsonb_array_elements(public.public_catalog()->'collections') x where x->>'id'=c_id::text and x->>'title'='Public edit'),'draft edit must preserve published snapshot';
 begin perform public.admin_save_collection(staff_id,c_id,2,d); raise exception 'expected version conflict'; exception when raise_exception then assert sqlerrm='VERSION_CONFLICT'; end;
 d:=jsonb_set(d,'{productIds}','["92000000-0000-4000-8000-000000000002"]');
 perform public.admin_save_collection(staff_id,c_id,3,d);
 begin perform public.admin_publish_collection(staff_id,c_id,4); raise exception 'expected private-reference rejection'; exception when raise_exception then assert sqlerrm='INVALID_REFERENCE'; end;
 d:=jsonb_set(d,'{productIds}','["92000000-0000-4000-8000-000000000001"]');
 perform public.admin_save_collection(staff_id,c_id,4,d);
 perform public.admin_publish_collection(staff_id,c_id,5);

 h:=jsonb_build_object('hero',jsonb_build_object('eyebrow','EDIT','heading','Published hero','body','Approved copy','ctaLabel','Shop edit','collectionId',c_id,'mediaId','93000000-0000-4000-8000-000000000001'),
   'announcement',jsonb_build_object('text','Explore','collectionId',c_id),'navigation',jsonb_build_array(jsonb_build_object('label','Edit','collectionId',c_id)),
   'featuredProductIds',jsonb_build_array('92000000-0000-4000-8000-000000000001'),'lookbook','[]'::jsonb);
 perform public.admin_save_content(staff_id,0,h);
 assert public.public_home_content() is null,'homepage draft hidden';
 perform public.admin_publish_content(staff_id,1);
 assert public.public_home_content()#>>'{hero,heading}'='Published hero';
 h:=jsonb_set(h,'{hero,heading}','"PRIVATE HOMEPAGE DRAFT"');
 perform public.admin_save_content(staff_id,2,h);
 assert public.public_home_content()#>>'{hero,heading}'='Published hero';
 begin perform public.admin_publish_content(staff_id,2); raise exception 'expected version conflict'; exception when raise_exception then assert sqlerrm='VERSION_CONFLICT'; end;
 begin perform public.admin_save_content(staff_id,3,h||'{"secret":"never accepted"}'); raise exception 'expected strict-schema rejection'; exception when raise_exception then assert sqlerrm='INVALID_PAYLOAD'; end;
 h:=jsonb_set(h,'{hero,collectionId}','"99000000-0000-4000-8000-000000000099"');
 begin perform public.admin_save_content(staff_id,3,h); raise exception 'expected missing-reference rejection'; exception when raise_exception then assert sqlerrm='INVALID_REFERENCE'; end;

 s:='{"shippingMode":"flat","shippingFeePaise":5000,"freeShippingThresholdPaise":100000,"taxInclusive":true,"taxRatePercent":null,"returnWindowDays":14,"shippingPolicy":"PRIVATE SHIPPING DRAFT","returnPolicy":"PRIVATE RETURN DRAFT","privacyPolicy":"PRIVATE PRIVACY DRAFT","termsPolicy":"PRIVATE TERMS DRAFT","supportEmail":"private@example.test","supportPhone":"1234567890","policiesPublished":false,"contactPublished":false}';
 begin perform public.admin_settings_read(staff_id); raise exception 'expected staff settings read denial'; exception when raise_exception then assert sqlerrm='FORBIDDEN'; end;
 begin perform public.admin_save_settings(staff_id,0,s); raise exception 'expected staff settings write denial'; exception when raise_exception then assert sqlerrm='FORBIDDEN'; end;
 perform public.admin_save_settings(owner_id,0,s);
 assert public.public_store_settings()->'policies'='null'::jsonb and public.public_store_settings()->'contact'='null'::jsonb;
 assert public.public_store_settings()::text not like '%PRIVATE%' and public.public_store_settings()::text not like '%private@example%';
 begin perform public.admin_save_settings(owner_id,0,s); raise exception 'expected settings version conflict'; exception when raise_exception then assert sqlerrm='VERSION_CONFLICT'; end;
 begin perform public.admin_save_settings(owner_id,1,jsonb_set(s,'{taxInclusive}','false')); raise exception 'expected exclusive-tax rejection'; exception when raise_exception then assert sqlerrm='INVALID_PAYLOAD'; end;
 begin perform public.admin_save_settings(owner_id,1,s||'{"apiSecret":"private"}'); raise exception 'expected secret-key rejection'; exception when raise_exception then assert sqlerrm='INVALID_PAYLOAD'; end;
 s:=jsonb_set(jsonb_set(s,'{policiesPublished}','true'),'{contactPublished}','true');
 perform public.admin_save_settings(owner_id,1,s);
 assert public.public_store_settings()#>>'{policies,shipping}'='PRIVATE SHIPPING DRAFT' and public.public_store_settings()#>>'{contact,email}'='private@example.test','explicit publication permits approved text/contact';
 w:='{"name":"Fixture warehouse","pickupLocation":"fixture-location","contactName":"PRIVATE PERSON","email":"warehouse@example.test","phone":"1234567890","line1":"PRIVATE ADDRESS","line2":"","city":"Fixture City","state":"Fixture State","pincode":"560001","country":"IN","active":true}';
 perform public.admin_save_warehouse(owner_id,null,0,w);
 select id into wh_id from public.warehouse where pickup_location='fixture-location';
 begin perform public.admin_save_warehouse(owner_id,null,0,jsonb_set(w,'{pickupLocation}','"fixture-location-2"')); raise exception 'expected active-warehouse conflict'; exception when raise_exception then assert sqlerrm='ACTIVE_WAREHOUSE_EXISTS'; end;
 begin perform public.admin_save_warehouse(staff_id,wh_id,1,w); raise exception 'expected staff warehouse denial'; exception when raise_exception then assert sqlerrm='FORBIDDEN'; end;
 perform public.admin_save_warehouse(owner_id,wh_id,1,jsonb_set(w,'{active}','false'));
 begin perform public.admin_save_warehouse(owner_id,wh_id,1,w); raise exception 'expected warehouse version conflict'; exception when raise_exception then assert sqlerrm='VERSION_CONFLICT'; end;
 p:='{"label":"Fixture box","lengthCm":30,"widthCm":20,"heightCm":5,"tareWeightG":100,"maxContentsWeightG":2000,"maxItems":5,"priority":0,"active":true}';
 perform public.admin_save_packaging(owner_id,null,0,p);
 begin perform public.admin_save_packaging(staff_id,null,0,p); raise exception 'expected staff packaging denial'; exception when raise_exception then assert sqlerrm='FORBIDDEN'; end;
 begin perform public.admin_save_packaging(owner_id,null,0,jsonb_set(p,'{lengthCm}','0')); raise exception 'expected dimension rejection'; exception when raise_exception then assert sqlerrm='INVALID_PAYLOAD'; end;
 assert public.admin_settings_read(owner_id)::text like '%PRIVATE ADDRESS%','owner can read private warehouse';
 assert public.public_store_settings()::text not like '%PRIVATE ADDRESS%' and public.public_store_settings()::text not like '%warehouse@example%';
 assert not exists(select 1 from public.audit_logs where diff::text like '%PRIVATE ADDRESS%' or diff::text like '%PRIVATE SHIPPING DRAFT%');
 assert (select count(*) from public.audit_logs where actor_user_id=owner_id and entity_type in ('store_settings','warehouse','packaging_presets'))=5,'each successful owner mutation audited once';
 update public.admin_memberships set enabled=false where user_id=staff_id;
 begin perform public.admin_collections_read(staff_id); raise exception 'expected revoked membership denial'; exception when raise_exception then assert sqlerrm='FORBIDDEN'; end;
end $$;

reset role;
do $$ declare f record; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
   (p.proname like 'content_%' or p.proname in ('admin_collections_read','admin_save_collection','admin_publish_collection','admin_content_read','admin_save_content','admin_publish_content','admin_settings_read','admin_save_settings','admin_save_warehouse','admin_save_packaging')) loop
  assert not has_function_privilege('anon',f.oid,'execute') and not has_function_privilege('authenticated',f.oid,'execute'),f.proname||' must be private';
 end loop;
end $$;
set local role anon;
select public.public_home_content(),public.public_store_settings();
do $$ begin
 begin perform public.admin_content_read('00000000-0000-4000-8000-000000000001'); raise exception 'expected anon denial'; exception when insufficient_privilege then null; end;
end $$;
