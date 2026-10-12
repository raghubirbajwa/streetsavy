/** Explicit development-only checkout configuration. Never run automatically in test/live. */
export const fixtureCheckoutSql = `
insert into public.warehouse(id,name,pickup_location,contact,address,active)
select 'f4000000-0000-4000-8000-000000000001','Fixture pickup — not a shipping location','fixture-only','{"name":"Fixture","email":"fixture@example.invalid","phone":"9000000000"}','{"line1":"Fixture address","city":"Fixture","state":"KA","pincode":"560001","country":"IN"}',true
where not exists(select 1 from public.warehouse where active) on conflict do nothing;
insert into public.packaging_presets(id,label,length_cm,width_cm,height_cm,tare_weight_g,max_contents_weight_g,max_items,priority,active)
values('f4000000-0000-4000-8000-000000000002','Fixture parcel — sample dimensions',40,30,15,100,5000,10,9999,true) on conflict do nothing;
insert into public.product_packaging(product_id,preset_id) select id,'f4000000-0000-4000-8000-000000000002' from public.products where is_demo on conflict do nothing;
insert into public.store_settings(key,value) values('commerce','{"shippingMode":"provider","shippingFeePaise":0,"freeShippingThresholdPaise":0,"taxInclusive":true,"taxRatePercent":0,"returnWindowDays":0,"shippingPolicy":"","returnPolicy":"","privacyPolicy":"","termsPolicy":"","supportEmail":"","supportPhone":"","policiesPublished":false,"contactPublished":false}') on conflict do nothing;
`;
