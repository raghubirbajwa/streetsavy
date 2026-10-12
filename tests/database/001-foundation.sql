-- Run after migrations against a disposable database, inside a transaction.
-- The runner supplies Supabase roles, auth.users and auth.uid() locally.
create function pg_temp.assert_true(actual boolean, description text) returns void language plpgsql as $$
begin if actual is distinct from true then raise exception 'Assertion failed: %', description; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate <> expected_state then raise exception 'Expected SQLSTATE %, got % for %: %', expected_state, sqlstate, statement, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected SQLSTATE %, but statement succeeded: %', expected_state, statement;
end $$;

select pg_temp.assert_true((select count(*) >= 35 and bool_and(rowsecurity) from pg_tables where schemaname = 'public'), 'all application tables, including milestone additions, have RLS');
select pg_temp.assert_true(not exists(select 1 from pg_views where schemaname = 'public'), 'there are no definer views bypassing RLS');
select pg_temp.assert_true((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.public_catalog()'::regprocedure), 'catalog definer search_path is fixed');
select pg_temp.assert_true((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.has_admin_role(text)'::regprocedure), 'membership definer search_path is fixed');
select pg_temp.assert_true(not has_function_privilege('anon','public.has_admin_role(text)','EXECUTE'), 'anon cannot execute membership helper');
select pg_temp.assert_true(not exists(select 1 from pg_tables where schemaname = 'public' and has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT')), 'anon cannot select any base table');
select pg_temp.assert_true(not exists(select 1 from pg_tables where schemaname = 'public' and (has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'INSERT') or has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'UPDATE') or has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'DELETE'))), 'authenticated base writes are all denied');

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003'),('00000000-0000-4000-8000-000000000004');
insert into public.admin_memberships(user_id,role) values ('00000000-0000-4000-8000-000000000001','owner'),('00000000-0000-4000-8000-000000000002','staff');
insert into public.categories(id,slug,name,active) values ('10000000-0000-4000-8000-000000000001','public-category','Public',true),('10000000-0000-4000-8000-000000000002','inactive-category','Inactive',false);
insert into public.size_guides(id,title,measurement_type,values_cm) values
 ('11000000-0000-4000-8000-000000000001','Public guide','garment','{"columns":[{"key":"chest","label":"Chest"}],"rows":[{"size":"S","values":{"chest":50}}]}'),
 ('11000000-0000-4000-8000-000000000002','Private guide','garment','{"columns":[],"rows":[]}');
insert into public.products(id,slug,title,category_id,status,published_at,size_guide_id) values
 ('20000000-0000-4000-8000-000000000001','public-product','Public product','10000000-0000-4000-8000-000000000001','published',now(),'11000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','draft-product','PRIVATE DRAFT','10000000-0000-4000-8000-000000000001','draft',null,'11000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000003','archived-product','PRIVATE ARCHIVE','10000000-0000-4000-8000-000000000001','archived',now(),null),
 ('20000000-0000-4000-8000-000000000004','hidden-category-product','PRIVATE CATEGORY','10000000-0000-4000-8000-000000000002','published',now(),null);
insert into public.product_variants(id,product_id,sku,color_key,color_label,size,price_paise,unit_weight_g,enabled) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','PRIVATE-SKU','black','Black','S',89900,250,true),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','DISABLED-SKU','black','Black','M',89900,250,false);
insert into public.inventory(variant_id,on_hand,reserved) values ('30000000-0000-4000-8000-000000000001',29,28),('30000000-0000-4000-8000-000000000002',42,0);
insert into public.media_assets(id,stage_key,public_key,type,status,content_type,size_bytes,width,height,last_error) values
 ('40000000-0000-4000-8000-000000000001','PRIVATE-STAGE-KEY','catalog/public.png','image','published','image/png',100,10,10,'PRIVATE-ERROR'),
 ('40000000-0000-4000-8000-000000000002','PRIVATE-UNPUBLISHED-STAGE',null,'image','ready','image/png',100,10,10,null);
insert into public.product_media(product_id,media_id,color_key,is_cover) values
 ('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','black',true),
 ('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',null,false);
insert into public.collections(id,slug,title,active,cover_media_id) values ('50000000-0000-4000-8000-000000000001','public-collection','Public collection',true,'40000000-0000-4000-8000-000000000002');
insert into public.collection_products(collection_id,product_id,sort_order) values ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1),('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',0);
insert into public.store_settings(key,value) values ('shipping_policy','{"configured":false}');
insert into public.site_content(key,draft_payload) values ('home','{"secret":"PRIVATE DRAFT CONTENT"}');
insert into public.guest_sessions(id,token_hash) values ('60000000-0000-4000-8000-000000000001',repeat('a',64));
insert into public.carts(id,guest_session_id,expires_at) values ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',now()+interval '1 day');
insert into public.warehouse(id,name,pickup_location,contact,address,active) values ('70000000-0000-4000-8000-000000000001','Test only','test-only','{}','{}',true);
insert into public.shipping_quotes(id,cart_id,cart_version,address_fingerprint,address_snapshot,warehouse_id,packaging_snapshot,eligible_services,selected_service_key,courier_cost_paise,shipping_fee_paise,item_subtotal_paise,total_paise,pricing_version)
 values ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',1,'test','{}','70000000-0000-4000-8000-000000000001','{}','[]','test',50,100,89900,90000,1);
insert into public.orders(id,order_number,guest_session_id,customer_user_id,customer_email,customer_phone,shipping_address_snapshot,items_payable_paise,shipping_fee_paise,total_paise,quote_id,source_cart_id,source_cart_version,shipping_snapshot,packaging_snapshot,mode)
 values ('63000000-0000-4000-8000-000000000001','TEST-0001','60000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','test@example.invalid','0000000000','{}',89900,100,90000,'62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',1,'{}','{}','test');
insert into public.order_items(order_id,variant_id,product_title,sku,color,size,quantity,unit_price_paise,line_payable_paise,unit_weight_g)
 values ('63000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Frozen title','FROZEN-SKU','Black','S',1,89900,89900,250);

set local role anon;
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()->'products') = 1,'only published product in active category is public');
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()->'categories') = 1,'inactive category is hidden');
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()->'sizeGuides') = 1,'unreferenced/private guides are hidden');
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()#>'{products,0,variants}') = 1,'disabled variant is hidden');
select pg_temp.assert_true(public.public_catalog()#>'{products,0,variants,0,available}' = 'true'::jsonb,'public stock is a boolean availability projection');
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()#>'{products,0,media}') = 1,'only approved published media appears');
select pg_temp.assert_true(public.public_catalog()#>'{collections,0,coverMediaId}' = 'null'::jsonb,'private collection cover is hidden');
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()#>'{collections,0,productIds}') = 1,'draft collection memberships are hidden');
select pg_temp.assert_true(public.public_catalog()::text !~ '(PRIVATE|on_hand|reserved|unit_weight_g|stage_key|last_error|token_hash|tax_category_key|"sku")','public projection has no private fields or values');
select pg_temp.expect_error('select * from public.products','42501');
select pg_temp.expect_error('select * from public.media_assets','42501');
select pg_temp.expect_error('select * from public.inventory','42501');
select pg_temp.expect_error('select * from public.guest_sessions','42501');
select pg_temp.expect_error('select public.has_admin_role()','42501');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"role":"owner"}}',true);
set local role authenticated;
select pg_temp.assert_true(not public.has_admin_role(),'editable metadata does not grant admin membership');
select pg_temp.assert_true((select count(*) = 0 from public.products),'nonadmin cannot read private base catalog');
select pg_temp.assert_true((select count(*) = 0 from public.admin_memberships),'nonadmin cannot read memberships');
select pg_temp.assert_true((select count(*) = 0 from public.orders),'nonadmin cannot read another customer order');
select pg_temp.assert_true((select count(*) = 0 from public.order_items),'nonadmin cannot read another customer items');
select pg_temp.assert_true((select count(*) = 0 from public.jobs),'nonadmin cannot read jobs');
select pg_temp.assert_true((select count(*) = 0 from public.site_content),'nonadmin cannot read content drafts');
select pg_temp.expect_error('insert into public.admin_memberships(user_id,role) values (auth.uid(),''owner'')','42501');
select pg_temp.expect_error('update public.inventory set on_hand = 999','42501');
select pg_temp.expect_error('insert into public.jobs(type,dedupe_key) values (''bad'',''bad'')','42501');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) = 1 from public.orders),'customer can read own order');
select pg_temp.assert_true((select count(*) = 1 from public.order_items),'customer can read own items');
select pg_temp.expect_error('update public.orders set payment_status = ''captured''','42501');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true(public.has_admin_role() and public.has_admin_role('staff') and not public.has_admin_role('owner'),'staff has only staff membership');
select pg_temp.assert_true((select count(*) = 4 from public.products),'staff can read drafts and archived products');
select pg_temp.assert_true((select count(*) = 0 from public.store_settings),'staff cannot read owner-only settings');
select pg_temp.assert_true((select count(*) = 1 from public.admin_memberships),'staff can read own membership only');
select pg_temp.expect_error('update public.admin_memberships set role = ''owner''','42501');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true(public.has_admin_role('owner'),'owner permission is recognized');
select pg_temp.assert_true((select count(*) = 1 from public.store_settings),'owner can read settings');
select pg_temp.assert_true((select count(*) = 2 from public.admin_memberships),'owner can read memberships');
select pg_temp.expect_error('delete from public.orders','42501');
reset role;
update public.admin_memberships set enabled = false where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(not public.has_admin_role(),'membership revocation is immediate without changing JWT');
select pg_temp.assert_true((select count(*) = 0 from public.products),'revoked owner loses catalog access');
reset role;

-- Base invariants prevent malformed data even under service credentials.
set local role service_role;
select pg_temp.expect_error('update public.inventory set reserved = 30 where variant_id = ''30000000-0000-4000-8000-000000000001''','23514');
select pg_temp.expect_error('update public.product_variants set price_paise = -1','23514');
select pg_temp.expect_error('update public.product_variants set price_paise = 9007199254740992','23514');
select pg_temp.expect_error('update public.product_variants set compare_at_paise = price_paise','23514');
select pg_temp.expect_error('update public.product_variants set unit_weight_g = 0','23514');
select pg_temp.expect_error('update public.orders set refunded_paise = captured_paise + 1','23514');
select pg_temp.expect_error('update public.order_items set product_title = ''changed''','23514');
select pg_temp.expect_error('delete from public.product_variants where id = ''30000000-0000-4000-8000-000000000001''','23503');
select pg_temp.expect_error('insert into public.carts(guest_session_id,expires_at) values (''60000000-0000-4000-8000-000000000001'',now()+interval ''1 day'')','23505');
select pg_temp.expect_error('insert into public.warehouse(name,pickup_location,contact,address,active) values (''Second'',''second'',''{}'',''{}'',true)','23505');
select pg_temp.expect_error('update public.product_media set color_key = ''black'', is_cover = true where media_id = ''40000000-0000-4000-8000-000000000002''','23505');
select pg_temp.expect_error('update public.product_media set color_key = ''blue'' where media_id = ''40000000-0000-4000-8000-000000000002''; set constraints all immediate','23514');
insert into public.audit_logs(actor,action,entity_type) values ('test','test','test');
select pg_temp.expect_error('update public.audit_logs set actor = ''tampered''','23514');
select pg_temp.expect_error('delete from public.audit_logs','23514');
update public.products set title = 'Updated' where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select version = 2 from public.products where id = '20000000-0000-4000-8000-000000000001'),'mutable entity version increments');
reset role;
set constraints all immediate;

-- M2 archive preserves the financial snapshot and its variant reference.
set local role service_role;
select public.admin_archive_product('00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',2,'fixture');
select pg_temp.assert_true((select product_title='Frozen title' and sku='FROZEN-SKU' and line_payable_paise=89900 and variant_id='30000000-0000-4000-8000-000000000001' from public.order_items limit 1),'archive retains immutable order item and variant');
select pg_temp.assert_true((select total_paise=90000 from public.orders limit 1),'archive does not change order total');
select pg_temp.assert_true(jsonb_array_length(public.public_catalog()->'products')=0,'archived product leaves public catalog');
reset role;
