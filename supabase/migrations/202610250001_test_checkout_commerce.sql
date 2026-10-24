-- Test-mode checkout needs an active warehouse, a parcel that fits the catalog, and inclusive tax.
-- Sample operational values only; not a live shipping location.

insert into public.warehouse (name, pickup_location, contact, address, active)
select
  'Test pickup',
  'test-pickup',
  '{"name":"StreetSavy","email":"pickup@example.invalid","phone":"9000000000"}'::jsonb,
  '{"line1":"Test warehouse","city":"Bengaluru","state":"KA","pincode":"560001","country":"IN"}'::jsonb,
  true
where not exists (select 1 from public.warehouse where active);

insert into public.packaging_presets (
  label, length_cm, width_cm, height_cm, tare_weight_g, max_contents_weight_g, max_items, priority, active
)
select 'Test parcel', 40, 30, 15, 100, 20000, 10, 100, true
where not exists (select 1 from public.packaging_presets where active);

insert into public.product_packaging (product_id, preset_id)
select p.id, pp.id
from public.products p
cross join public.packaging_presets pp
where pp.active
on conflict do nothing;

insert into public.store_settings (key, value)
values (
  'commerce',
  '{"shippingMode":"provider","shippingFeePaise":0,"freeShippingThresholdPaise":0,"taxInclusive":true,"taxRatePercent":0,"returnWindowDays":14,"shippingPolicy":"","returnPolicy":"","privacyPolicy":"","termsPolicy":"","supportEmail":"","supportPhone":"","policiesPublished":false,"contactPublished":false}'::jsonb
)
on conflict (key) do update
set value = public.store_settings.value || jsonb_build_object('taxInclusive', true, 'taxRatePercent', coalesce(public.store_settings.value->'taxRatePercent', '0'::jsonb))
where public.store_settings.value->>'taxInclusive' is distinct from 'true'
   or public.store_settings.value->>'taxRatePercent' is null;
