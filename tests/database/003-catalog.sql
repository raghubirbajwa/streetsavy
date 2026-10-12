create function pg_temp.assert_catalog(value boolean, description text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'Catalog assertion: %',description; end if; end $$;
create function pg_temp.catalog_error(statement text, expected_message text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlerrm not like '%'||expected_message||'%' then raise exception 'Expected %, got %',expected_message,sqlerrm; end if; return; end;
 raise exception 'Statement unexpectedly succeeded: %',statement;
end $$;
insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001'),('90000000-0000-4000-8000-000000000002');
insert into public.admin_memberships(user_id,role) values ('90000000-0000-4000-8000-000000000001','staff');
insert into public.categories(id,slug,name) values ('91000000-0000-4000-8000-000000000001','catalog-test','Catalog test');
select pg_temp.assert_catalog(not has_function_privilege('authenticated','public.admin_save_product(uuid,uuid,integer,jsonb,text)','execute'),'customer/staff browser cannot invoke privileged write directly');
select pg_temp.assert_catalog(not has_function_privilege('anon','public.admin_catalog(uuid,text)','execute'),'anonymous cannot read admin snapshot');
select pg_temp.catalog_error($test$select public.admin_catalog('90000000-0000-4000-8000-000000000002')$test$,'FORBIDDEN');
select pg_temp.catalog_error($test$select public.admin_catalog(null)$test$,'FORBIDDEN');

-- Full workflow runs with service credentials and independently checked actor.
set local role service_role;
do $$ declare p jsonb; q jsonb; v jsonb; inventory_version integer; movement jsonb; publication jsonb; p_id uuid; v_id uuid; begin
 p:=public.admin_save_product('90000000-0000-4000-8000-000000000001',null,null,'{"title":"Test product","slug":"test-product","description":"Test description","categoryId":"91000000-0000-4000-8000-000000000001","tags":[],"fit":"regular","material":null,"care":[],"sizeGuideId":null,"featuredRank":0}');
 p_id:=(p->>'id')::uuid;
 perform pg_temp.assert_catalog(p->>'status'='draft' and (p->>'version')::integer=1,'creation is a versioned draft');
 perform pg_temp.assert_catalog(jsonb_array_length(public.public_catalog()->'products')=0,'draft is not public');
 perform pg_temp.catalog_error(format('select public.admin_archive_product(%L,%L,9)','90000000-0000-4000-8000-000000000001',p_id),'VERSION_CONFLICT');
 perform pg_temp.catalog_error(format('select public.admin_publish_product(%L,%L,1)','90000000-0000-4000-8000-000000000001',p_id),'PUBLISH_INCOMPLETE');
 p:=public.admin_replace_variants('90000000-0000-4000-8000-000000000001',p_id,1,'[{"sku":"TEST-ONE","colorKey":"black","colorLabel":"Black","colorHex":"#000000","size":"ONE_SIZE","pricePaise":10000,"compareAtPaise":null,"taxCategoryKey":null,"unitWeightG":100,"enabled":true}]');
 v_id:=(p#>>'{variants,0,id}')::uuid;
 perform pg_temp.assert_catalog((p->>'version')::integer=2,'variant mutation advances product version');
 movement:=public.admin_adjust_inventory('90000000-0000-4000-8000-000000000001',v_id,5,1,'Receive sample stock','receive-one');
 perform pg_temp.assert_catalog((select on_hand=5 and reserved=0 and version=2 from public.inventory where inventory.variant_id=v_id),'stock and version changed atomically');
 q:=public.admin_adjust_inventory('90000000-0000-4000-8000-000000000001',v_id,5,1,'Receive sample stock','receive-one');
 perform pg_temp.assert_catalog(q->>'movementId'=movement->>'movementId' and (q->>'replayed')::boolean,'same adjustment replays one movement');
 perform pg_temp.assert_catalog((select count(*)=1 from public.inventory_movements),'no duplicate movement');
 perform pg_temp.catalog_error(format('select public.admin_adjust_inventory(%L,%L,6,1,%L,%L)','90000000-0000-4000-8000-000000000001',v_id,'Receive sample stock','receive-one'),'IDEMPOTENCY_CONFLICT');
 perform pg_temp.catalog_error(format('select public.admin_adjust_inventory(%L,%L,5,2,%L,%L)','90000000-0000-4000-8000-000000000001',v_id,'Receive sample stock','receive-one'),'IDEMPOTENCY_CONFLICT');
 perform pg_temp.catalog_error(format('select public.admin_adjust_inventory(%L,%L,-6,2,%L,%L)','90000000-0000-4000-8000-000000000001',v_id,'Excess removal','remove-bad'),'STOCK_CONFLICT');
 perform pg_temp.catalog_error(format('select public.admin_adjust_inventory(%L,%L,1,1,%L,%L)','90000000-0000-4000-8000-000000000001',v_id,'Stale edit','stale-one'),'VERSION_CONFLICT');
 update public.inventory set reserved=3 where inventory.variant_id=v_id;
 perform pg_temp.catalog_error(format('select public.admin_adjust_inventory(%L,%L,-3,3,%L,%L)','90000000-0000-4000-8000-000000000001',v_id,'Reserved removal','reserved-one'),'STOCK_CONFLICT');
 perform pg_temp.assert_catalog((select on_hand=5 and reserved=3 from public.inventory where inventory.variant_id=v_id),'failed adjustment preserves stock');
 p:=public.admin_replace_variants('90000000-0000-4000-8000-000000000001',p_id,2,'[]');
 perform pg_temp.assert_catalog(jsonb_array_length(p->'variants')=1 and not (p#>>'{variants,0,enabled}')::boolean,'omitted variant is disabled and history retained');
 perform pg_temp.assert_catalog(jsonb_array_length(p->'inventoryMovements')=1,'admin DTO includes immutable stock history');
 p:=public.admin_archive_product('90000000-0000-4000-8000-000000000001',p_id,3);
 perform pg_temp.assert_catalog(p->>'status'='archived','archive preserves product record');
end $$;
reset role;
update public.admin_memberships set enabled=false where user_id='90000000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.catalog_error($test$select public.admin_catalog('90000000-0000-4000-8000-000000000001')$test$,'FORBIDDEN');
reset role;
