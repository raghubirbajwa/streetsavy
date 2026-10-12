# Data Model and Consistency Rules

Version 2.0 · 23 September 2026

## Conventions

Supabase PostgreSQL is authoritative in test/live modes; fixture mode implements equivalent typed contracts. Use SQL migrations and generated TypeScript database types. No ORM is required for v1. Transactional multi-row operations use restricted database functions invoked by the server.

UUID primary keys unless noted; `created_at`/`updated_at` are UTC timestamptz; mutable admin entities have integer `version` for optimistic concurrency. Money is nonnegative bigint in paise, currency INR; API returns numbers only after safe-integer checks. Weight is positive integer grams; parcel dimensions are positive numeric centimetres. Provider IDs/AWBs are opaque text, never numbers. Use snake_case DB and camelCase DTOs. All secrets stay outside public configuration tables.

## Identity and access

- `auth.users`: Supabase-managed identities. Admin email/password plus reset flow; email OTP is available for customer order recovery. Verify actual server session, not client-supplied user IDs.
- `admin_memberships`: user_id PK/FK, role `owner|staff`, enabled. Owner may change settings/issue refunds; staff may manage catalog, inventory and shipping. No self-service promotion. Initial owner inserted through trusted bootstrap after creating its Auth user; no public admin signup.
- `guest_sessions`: id, token_hash unique, expires_at, revoked_at. Random high-entropy cookie token is hashed at rest; server resolves it. Default 30-day expiry; rotate/revoke deliberately.
- Customer profile/account dashboard is deferred. Order email and shipping snapshot are sufficient for guest purchases. A verified Auth email can recover matching guest orders server-side; email typed into a form alone grants nothing.

## Catalog

- `categories`: id, slug unique, name, sort_order, active. Initial slugs: oversized-tees, hoodies, cargos, shirts, accessories.
- `products`: id, slug unique, title, description, category_id, tags text[], status `draft|published|archived`, fit, material nullable, care text[], size_guide_id nullable, featured_rank, published_at, is_demo, version. No customer stock/private notes in public DTO.
- `product_variants`: id, product_id, sku unique, color_key, color_label, color_hex, size (`XS|S|M|L|XL|XXL|ONE_SIZE`), price_paise, compare_at_paise nullable, tax_category_key nullable, unit_weight_g, enabled, version. Unique(product_id,color_key,size). Disabled variants cannot be purchased. Compare-at must exceed price if set; require a truthful price basis before live display.
- `inventory`: variant_id PK, on_hand int≥0, reserved int≥0, version, CHECK(reserved≤on_hand). Single warehouse. Available = on_hand−reserved; public UI may use availability rather than exact warehouse counts.
- `inventory_movements`: id, variant_id, kind `receive|adjust|sale|restock`, on_hand_delta signed int, reason, actor_user_id nullable, order_id nullable, return_item_id nullable, operation_key unique, created_at. Append-only audit. Adjustments cannot push on_hand below reserved.
- `collections`: id, slug unique, title, description, cover_media_id nullable, active, sort_order, version.
- `collection_products`: collection_id, product_id composite PK; sort_order. Only published products appear publicly; explicit memberships can overlap.
- `size_guides`: id, title, measurement_type `garment|body`, instructions, values_cm jsonb validated by schema, is_demo, version. Values specify columns and size rows. Inches are derived by /2.54 for display, not stored independently.

## Media and content

- `media_assets`: id, stage_key unique, public_key nullable unique, type `image|video`, status `uploading|validating|ready|publishing|published|rejected|deleting`, content_type, size_bytes, width, height, duration_seconds nullable, poster_media_id nullable, checksum, alt, focal_x/y 0..1, source/license details, uploaded_by, last_error nullable, version. Store object keys, not expiring URLs. Public URLs derive from configured media domain plus public_key.
- `product_media`: product_id, media_id, color_key nullable, sort_order, is_cover. Enforce one effective cover per product/colour group; references must point to compatible product colours. A shared image is allowed, but do not misrepresent colours.
- `site_content`: key PK, draft_payload jsonb, published_payload jsonb nullable, schema_version, version, published_at. Validate exact hero/navigation/lookbook schema before publication. Product/collection references must resolve.
- `warehouse`: id, name, Shiprocket pickup_location identifier, contact/address, active. At most one active warehouse for v1; private data.
- `packaging_presets`: id, label, length_cm,width_cm,height_cm, tare_weight_g,max_contents_weight_g, max_items, priority, active. Admin declares products compatible with presets via `product_packaging(product_id,preset_id)`.
- `store_settings`: key PK, validated value, version. Shipping fee mode/amount/threshold, return period/rules, inclusive tax configuration, contact details and publication flags. No provider credentials. Changes audited.

Packaging selection uses active presets compatible with every product, sum(unit_weight_g × quantity) within max_contents_weight_g and total units within max_items; choose lowest priority value, then ID. Shipping weight includes tare; never add item dimensions together as a packing algorithm. No fitting preset returns PACKAGING_UNSUPPORTED. Admin verifies actual measurements before booking.

Uploads remain private in a staging bucket; published catalog copies use a separate public bucket/domain. Preserve immutable public object keys. Archiving removes catalog visibility; it is not a guarantee previously public media disappears from browser/CDN caches.

## Cart, quotes and orders

- `carts`: id, guest_session_id, version, currency, expires_at; one open cart per session. Do not expose guest token/hash.
- `cart_items`: cart_id, variant_id composite PK, quantity positive int. No stored authoritative price. Cart changes increment carts.version. Adding does not reserve stock.
- Wishlist: local storage product IDs (`clothing-store:wishlist:v1`); no PII or monetary authority. Validate version/dedupe/resolve; cross-device syncing deferred.
- `shipping_quotes`: id, cart_id, cart_version, address_fingerprint, address_snapshot jsonb private, warehouse_id, packaging_snapshot, eligible_services jsonb private, selected_service_key, courier_cost_paise, shipping_fee_paise, item_subtotal_paise, tax_breakdown jsonb, total_paise, currency, pricing_version, expires_at (default 10 minutes), status `ready|consumed|expired`. Hash input must cover items/quantities/prices, address, packaging and policy. Quoting reserves no stock.
- `orders`: id, order_number unique (human display only), guest_session_id, customer_user_id nullable, customer_email normalized, customer_phone, shipping_address_snapshot, order_status `pending_payment|confirmed|cancelled|closed`, payment_status `unpaid|authorized|captured|partially_refunded|refunded`, fulfillment_status `unfulfilled|held|ready|shipped|delivered|cancelled|returned`, attention_reason nullable, currency, items_payable_paise, shipping_fee_paise, tax_breakdown, total_paise, captured_paise default0, refunded_paise default0, quote_id unique, source_cart_id, source_cart_version, shipping/packaging snapshots, mode `test|live`, version.
- `order_items`: id, order_id, variant_id nullable on eventual permitted anonymization/deletion, product_title/sku/color/size snapshots, quantity, unit_price_paise, line_payable_paise, tax_breakdown, unit_weight_g, image_key snapshot. Immutable financial snapshots; variant deletion is restricted while referenced.
- `inventory_reservations`: id, order_id, variant_id, quantity, status `held|committed|released`, expires_at, committed_at/released_at, reason; unique(order_id,variant_id). Reservation rows preserve history. Only held rows count in inventory.reserved.
- `payment_attempts`: id, order_id, provider_order_id unique nullable, provider_payment_id unique nullable, status `creating|pending|authorized|captured|failed|unknown`, amount_paise, currency, provider_status, last_checked_at, safe_error, idempotency_operation_id. Failed attempt is not a failed/cancelled store order automatically.

Totals: items_payable = sum(order_items.line_payable), total = items_payable + shipping_fee. V1 prices are tax-inclusive; tax_breakdown extracts tax already included. Discount engine is absent. Shipping cost paid by merchant is not the customer shipping fee. Capture must equal frozen order total/currency for automatic confirmation; discrepancies go to held/attention.

## Stock and payment transaction protocol

1. Lock cart/quote and variants/inventory in stable ID order; validate current prices, cart version, quote expiry/serviceability, enabled products, available stock and immutable total. Any change returns `QUOTE_STALE` or `STOCK_CONFLICT`, with no charge.
2. In one DB transaction create one pending order and item snapshots; create held reservations (default 15 minutes); increment reserved; consume quote; record external operation/outbox job. Unique active payment-order constraint per cart prevents concurrent tabs creating competing orders. Before changing cart during an active payment session, resolve/cancel the old session explicitly.
3. Outside the DB transaction, create/reconcile Razorpay order. Persist provider IDs. Receipt/reference is correlation, not an assumed provider idempotency guarantee. An ambiguous timeout stays unknown and is reconciled before another create attempt.
4. On verified captured payment, lock order/reservations/inventory; ensure amount/currency/environment/ownership mapping; mark capture once. For held reservations, reduce on_hand and reserved exactly once and mark committed. Set confirmed/ready. Duplicate callback/webhook/reconcile must have no extra stock or money effect.
5. On expiry, recheck provider state. If confirmed not captured/authorized, release held reservations once. If provider is unreachable or result uncertain, hold/flag and retry; do not guess. Authorized payments await capture resolution and cannot ship.
6. For a late capture after release, atomically reacquire and consume available stock. If insufficient or order was cancelled, record the captured funds, hold fulfillment with `LATE_CAPTURE_REVIEW`, and route to owner for refund; never oversell or auto-ship cancelled orders.

Internal functions (`reserve_checkout`, `apply_verified_capture`, `release_reservation`, `adjust_inventory`, `reserve_refund_amount`) are server-only restricted RPCs. They validate database invariants even when called by privileged code. Never do a read-then-write stock update in browser JavaScript.

## Shipping, returns and refunds

- `fulfillment_quotes`: id, order_id, warehouse_id, actual_parcel_snapshot, courier_id, courier_service, quoted_cost_paise, estimated_delivery_at nullable, provider_quote_payload private, expires_at (default 10 minutes), status `ready|consumed|expired`. Separate from customer checkout quotes; order/version/parcel fingerprint must match on booking. Do not reprice a paid customer order.
- `shipments`: id, order_id, fulfillment_quote_id nullable, direction `forward|return`, return_request_id nullable, provider `shiprocket`, provider_order_id/provider_shipment_id opaque unique nullable, courier_id/name, awb unique nullable, booking_status `not_started|creating|created|awb_assigned|unknown|failed|cancelled`, pickup_status `not_requested|requested|scheduled|failed|picked_up`, transit_status `not_shipped|in_transit|out_for_delivery|delivered|exception|rto_in_transit|rto_delivered|cancelled`, actual_weight_g/dimensions, quoted_cost_paise, final_cost_paise nullable, estimated_delivery_at nullable, private_label_key nullable, provider_status, provider_updated_at, last_synced_at, version. A partial unique index permits at most one noncancelled forward shipment per order; reverse shipments have their own identity.
- `shipment_events`: id, shipment_id, provider_event_key unique per provider/environment where available, raw_status, normalized_status, occurred_at, received_at, source, sanitized_details. Append events even if older; do not regress current state from delayed events. RTO is a separate path, not an ordinary customer return.
- `return_requests`: id, order_id, status `requested|approved|rejected|pickup_pending|in_transit|received|inspected|closed`, reason, requested_at, reviewed_by, inspection_notes, version.
- `return_items`: id, return_request_id, order_item_id, quantity, accepted_quantity, restock_quantity, disposition. Enforce aggregate returned/active-request quantities ≤ purchased quantity; lock order items for overlapping requests. Only inspected sellable units restock, once per operation.
- `refunds`: id, order_id, payment_attempt_id, return_request_id nullable, amount_paise, status `requested|processing|processed|failed|unknown`, provider_refund_id unique nullable, reason, requested_by, operation_key unique, timestamps. Sum processed + pending/unknown reserved refunds ≤ captured amount. Do not mark refunded when request was merely sent. Inventory restock is a separate audited operation; money refund alone does not change stock.

If a parcel is already picked up, reject ordinary cancellation and start a supported interception/return process. Cancelled shipment does not imply refunded payment; delivered shipment does not imply refund prohibited without consulting policy. Archive products, not financial/order history.

## Reliability and notifications

- `external_operations`: id, scope, actor_or_session_key, idempotency_key, request_hash, status `queued|running|succeeded|failed|unknown`, provider_reference, result_json sanitized, expires_at; unique(scope,actor_or_session_key,idempotency_key). Different payload with same key is 409.
- `webhook_events`: id, provider, environment, provider_event_id or stable dedupe_hash, received_at, verification_result, payload private/redacted retention, processing_status, attempts, error. Unique provider+environment+dedupe key.
- `jobs`: id, type, dedupe_key unique, payload minimal, state `queued|running|retry|done|dead`, run_after, attempts, max_attempts, locked_until, last_error. Leased claims using SKIP LOCKED; external calls outside transaction; expired leases recover safely.
- `notifications`: id, order_id, type, channel, recipient, status, provider_id nullable, unique dedupe_key; outbox retries do not duplicate emails.
- `audit_logs`: id, actor, action, entity_type/id, redacted diff, reason, request_id, created_at. Append-only, access restricted.

## RLS and server access

Enable RLS explicitly on every application table. Revoke default public grants/functions. Public read models expose only published catalog, approved media URLs, safe collection/content fields and purchasability. Inventory counts, supplier costs, drafts, guest tokens, orders and provider payloads are private. If using views, use appropriate invoker behavior and grants; do not accidentally bypass RLS through a definer view.

Authenticated users may read their own orders only by customer_user_id policy; guest capability and email recovery go through the server. Ordinary users cannot modify admin_memberships, inventory, orders, payments, refunds or jobs. Admin reads/writes require membership; owner-only functions additionally check owner role. Privileged server keys bypass RLS, so every corresponding route still checks actor/ownership before using them. Private job/webhook RPCs are not executable by anon/authenticated roles.

Admin access revocation is read from membership on each operation, not solely from editable user metadata or a cached UI. Auth verification and authorization remain separate. Use fixed search_path and explicit grants for any SECURITY DEFINER helper; test against nonadmin JWTs.

## Indexes and validation

Unique slugs/SKUs/provider identifiers plus foreign keys; indexes on published category/rank/time, variant product/colour/size, collection ordering, order email/user/session/time, order payment/fulfillment attention, job state/run_after, reservation status/expiry and shipment last_synced. Index actual queries, not every field.

Development tests include two simultaneous buyers for the last size, payment after reservation release, duplicate refund attempts, out-of-order tracking, stale admin edits, corrupt wishlist storage, and unavailable providers. Never seed sample products into live mode automatically.
