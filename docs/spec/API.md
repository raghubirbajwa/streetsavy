# API Contracts and Provider Integrations

Version 2.0 · 23 September 2026

These are planned Next.js server endpoints, not existing deployed APIs. DATA_MODEL.md owns persisted fields/invariants; SITEMAP.md owns page URLs. All paths here use `/api/v1`. Provider endpoints are wrapped server-side and must be checked against current official documentation at implementation time.

## Common conventions

JSON camelCase DTOs; UUIDs for our IDs, strings for provider IDs; UTC ISO timestamps; INR integer paise; grams/cm. Zod (or the repository's existing validator) validates all boundaries. Reject unexpected privilege/status/price fields on customer mutations. Database transaction functions enforce invariants independently of UI validation.

Success: `{data, meta?:{requestId,...}}`. Failure: `{error:{code,message,fieldErrors?},requestId}`. Statuses: 400 malformed, 401 missing identity, 403 unauthorized, 404 not found, 409 stale version/idempotency/stock, 422 invalid fields, 429 rate limit, 502 upstream failure, 503 unavailable configuration/service, 500 unexpected.

Important codes: `SIZE_REQUIRED`, `OUT_OF_STOCK`, `STOCK_CONFLICT`, `QUOTE_STALE`, `UNSERVICEABLE_PIN`, `PACKAGING_UNSUPPORTED`, `CHECKOUT_IN_PROGRESS`, `PAYMENT_PENDING`, `PAYMENT_MISMATCH`, `SHIPMENT_UNKNOWN`, `VERSION_CONFLICT`, `REFUND_LIMIT`, `INTEGRATION_UNCONFIGURED`. Do not leak private provider responses or secrets.

Private responses use no-store. Cookie mutations enforce same-origin/CSRF protections. Rate-limit auth/recovery/quote/upload/payment entry points; webhook validation is independent of browser CSRF. Guest carts/orders require server-issued HttpOnly Secure SameSite cookie capability; UUIDs alone confer no access.

Require `Idempotency-Key` for checkout creation, refunds and external shipping actions. Store actor scope, payload hash and result. Same key+payload returns the prior result/progress; different payload returns 409. Admin entity edits send expected `version`; conflicting updates return current safe version without overwriting.

## Public catalog

- `GET /products`: query filters from SITEMAP.md. Return `{items:[ProductCard],total,page,pageSize:12,totalPages}`. ProductCard: id,slug,title,category,cover,colour summaries,fromPricePaise,hasPriceRange,availability,matchingVariantIds. No private stock/cost fields.
- `GET /products/:slug`: ProductDetail with public description, media, enabled variants, prices, availability, guide and category. Missing/draft/archived returns 404 unless separate authenticated preview route is used.
- `GET /collections` and `GET /collections/:slug`: public collection metadata and ordered published product references.
- `GET /size-guides/:id` and `GET /content/home`: safe published content only.

Server Components may call the same read service directly; do not self-fetch HTTP just to read the database. Fixtures implement the same read interface and matching/sorting semantics.

## Guest cart and order access

- `POST /cart`: create/reuse guest session + current cart, set secure cookie; body empty. Return resolved CartDTO and version.
- `GET /cart`: resolved lines/availability/current prices/subtotal/version; missing session returns empty cart without private data.
- `POST /cart/items`: `{variantId,quantity,cartVersion}`; merge quantities within allowed limits.
- `PATCH /cart/items/:variantId`: `{quantity,cartVersion}`; set quantity.
- `DELETE /cart/items/:variantId`: `If-Match: "<cartVersion>"`; remove. Changes invalidate quotes. Active unresolved checkout returns CHECKOUT_IN_PROGRESS with a recovery action.
- `GET /orders/:id`: owned/same-session order only; safe receipt/status, address, items and shipment summary.
- `GET /orders/:id/tracking`: owned order's normalized shipment events; omit internal courier payloads/costs.

`POST /orders/access/request`: `{orderNumber,email}`; uniform accepted response and timing whether a match exists. Use Supabase email OTP flow to verify email; rate limit. `POST /orders/access/verify`: `{email,token,orderNumber}` verifies through Supabase Auth and grants access only when verified email matches that order's immutable email. Link customer_user_id only server-side after verification; never trust a client boolean or request email as proof. Reuse repository auth callback mechanisms where appropriate.

Wishlist is local IDs only; it needs no endpoint in v1. Transactional emails include a safe order route; receiving the route alone does not reveal data without current guest session or verified recovery.

## Checkout and payment

AddressDTO: `{fullName,phone,email,line1,line2?,city,stateCode,pincode,country:'IN'}`. Validate address strings/lengths, six-digit Indian PIN and normalized phone/email. A PIN check cannot verify a complete street address.

- `POST /shipping/serviceability`: `{pincode,variantId?,quantity?}` → `{serviceable,estimatedDeliveryRange?,message}` for product-page guidance. It is not a binding cart shipping quote.
- `POST /checkout/quote`: `{cartVersion,address}`. Reprice from DB; select a compatible packaging preset; query Shiprocket; calculate customer fee/tax; persist quote. Return `{quoteId,cartVersion,expiresAt,itemsPayablePaise,shippingFeePaise,taxBreakdown,totalPaise,currency:'INR',estimatedDeliveryRange?,deliveryLabel}`. Do not expose courier wholesale costs unless needed by admin. Default one standard service; don't show options the customer cannot actually select.
- `POST /checkout/sessions`: `{quoteId}` + Idempotency-Key. Transaction reserves stock, consumes quote and creates pending order, then durably creates/reconciles Razorpay order. Return 201 `{orderId,paymentAttemptId,keyId,razorpayOrderId,amountPaise,currency,reservationExpiresAt}` when ready; 202 `{operationId,orderId,status:'processing'}` for queued/ambiguous creation. Browser polls operation state, never starts a second charge blindly.
- `GET /operations/:id`: authorized actor/session gets safe progress/result only.
- `POST /payments/razorpay/verify`: `{orderId,razorpayPaymentId,razorpayOrderId,razorpaySignature}`. Check stored provider order ID, server signature and authoritative provider payment amount/currency/captured state. Return confirmed or verification-pending; never accept customer-supplied totals.
- `POST /orders/:id/cancel`: `{reason}`. Owner/session can request eligible pre-dispatch cancellation. Lock against shipment creation; resolve provider payment state and queued operations. Captured orders initiate the audited refund path; uncertain payment/shipment states return 202/held. A failed payment attempt alone is not proof that an order can be safely discarded.

Quote changes require explicit customer review and a fresh payment session. Razorpay UI dismissal does not equal payment failure; keep receipt pending until reconciled. Check callback signature using the server-stored Razorpay order ID, not an untrusted replacement. `payment.authorized` is insufficient to fulfill. Configure payment capture deliberately and document it.

## Webhooks

`POST /webhooks/razorpay`: read raw request bytes, verify documented signature using the webhook secret, dedupe provider event ID plus mode, durably record, then acknowledge and process through jobs. Payment/refund state updates use the same transaction functions as callback verification/reconciliation. Check mode, provider order/payment mapping, INR and frozen amount. Accept duplicate valid events without repeating effects; do not regress captured/processed states on older events.

`POST /webhooks/shiprocket`: verify the authentication mechanism actually supported/configured for this shipping account, match shipment/AWB, dedupe and store event history. Do not invent an HMAC header. If authenticating a notification is insufficient, treat it only as a hint and fetch authoritative shipment state using server credentials before changing customer-visible state. Record unknown mappings for review. Never use the separate Shiprocket Checkout webhook product as if it were shipment tracking.

Provider availability and event order are not guaranteed. Schedule reconciliation for pending money and stale tracking. Webhook 2xx means durably received, not “entire fulfillment workflow finished.”

## Admin catalog, media and configuration

Every endpoint below checks verified Supabase identity and active membership. Owner role is additionally required for settings/refunds; staff may handle catalog/shipping. No public endpoint for creating admins.

- `GET /admin/products`: search/status/category/page; includes drafts.
- `POST /admin/products`: draft title/category/description fields; returns draft/version.
- `GET|PATCH /admin/products/:id`: full admin DTO or versioned edit. PATCH product content only; no inventory bypass.
- `PUT /admin/products/:id/variants`: `{version,variants:[{id?,sku,colorKey,colorLabel,colorHex,size,pricePaise,unitWeightG,enabled,taxCategoryKey}]}`. Transactionally validate duplicate combinations and preserve referenced variants. Archive/disable rather than destructive removal.
- `POST /admin/inventory/adjustments`: `{variantId,delta,expectedVersion,reason}`. Atomic on-hand adjustment; records movement. Reserved is never editable from UI.
- `POST /admin/products/:id/publish`: `{version}`; validates assets, variants, size information, packaging and live-mode tax/pricing requirements. Promotes media first, then commits published product and invalidates public caches. Failure keeps a coherent draft.
- `POST /admin/products/:id/archive`: `{version}`; removes from public discovery without deleting order snapshots; checkout reprices/rechecks stale carts.
- `GET|POST /admin/collections`, `GET|PATCH /admin/collections/:id`: versioned ordered memberships and publication.
- `GET|POST /admin/size-guides`, `PATCH /admin/size-guides/:id`: versioned validated guides.
- `GET|PATCH /admin/content/home`, `POST /admin/content/home/publish`: versioned draft and explicit publication.
- `GET|PATCH /admin/settings`, `/admin/warehouse`, `/admin/packaging/:id`; `GET|POST /admin/packaging`: owner-only configuration. Secrets are never returned/stored here.

`POST /admin/media/uploads`: `{fileName,contentType,sizeBytes,kind}` → `{mediaId,uploadUrl,requiredHeaders,expiresAt}`. Proposed limits: images ≤10MB, MP4 ≤50MB/30 seconds; configurable constants shared with UI. Signed URL expires in 5 minutes and targets one unique private staging key. Validate size/type again after upload; client declarations are not enforcement.

`POST /admin/media/:id/complete`: HEAD/read/decode sufficiently to verify actual bytes, allowed type, dimensions and video duration; queue validation if needed and return 202. Reject scripts/SVG/unapproved formats. Browser never submits arbitrary public URLs for server fetching. `PATCH /admin/media/:id`: alt/focal/poster fields. `DELETE /admin/media/:id`: refuse attached published or retained order assets; otherwise mark/defer cleanup. Media GET/list and status endpoints expose only authorized private previews with expiring GET links. `PUT /admin/products/:id/media` controls media IDs, colour mapping, order and cover with product version.

## Admin orders, shipping and refunds

- `GET /admin/orders`, `GET /admin/orders/:id`: filters for payment/fulfillment/attention, details and audit timeline.
- `POST /admin/orders/:id/shipping-quotes`: `{weightG,lengthCm,widthCm,heightCm}` → eligible persisted fulfillment quote IDs, cost, service, expiry and estimate. Actual parcel must cover the entire order in v1. Paid customer total remains unchanged.
- `POST /admin/orders/:id/shipments`: `{shippingQuoteId,orderVersion}` + key. Reserve one forward shipment/operation atomically before calling provider. Creates Shiprocket order and returns state, not a claim of pickup.
- `POST /admin/shipments/:id/assign-awb`, `/pickup`, `/cancel`, `/sync`: separate idempotent actions. AWB/pickup use stored courier/order/parcel data; revalidate allowable state. Cancellation blocked/redirected when already collected.
- `GET /admin/shipments/:id/label`: authorized private download/short-lived URL after AWB generation; no public cache because labels contain addresses.
- `POST /orders/:id/returns`: `{items:[{orderItemId,quantity}],reason}` creates policy-eligible request; validate ownership and remaining returnable quantities.
- `GET /admin/returns`, `GET|PATCH /admin/returns/:id`: review/approve/reject or record reverse shipment reference/receipt/inspection with expected version. Restock uses a separate item-level audited operation.
- `POST /admin/orders/:id/refunds`: `{amountPaise,reason,returnRequestId?}` + key; owner only. Reserve refundable amount atomically, then call provider. Reconcile unknown timeouts. Repeating one operation cannot send two refunds.
- `GET /admin/operations`, `POST /admin/operations/:id/retry`: safe retry or reconciliation according to status; unknown is never force-recreated blindly.

## Internal jobs and provider adapters

Protected scheduler endpoint `/internal/jobs/run` claims bounded leased jobs. Schedule reservation expiry/payment/refund reconciliation each minute; tracking refresh roughly every 30 minutes for active shipments; cleanup daily. These are proposed starting schedules, adjusted to account limits. No browser interval is the job runner. Persist exponential backoff, bounded retries and an admin attention queue.

Adapters: `CatalogRepository`, `MediaService`, `PaymentProvider` (create/retrieve/verify/refund), `ShippingProvider` (serviceability/quote/create/AWB/label/pickup/cancel/track), `NotificationService`. Each has fixture/test implementations and explicit live configuration. Don't assume provider create/refund endpoints support your local idempotency header; use local operation locks and documented provider reconciliation mechanisms.

## Official integration references

Reviewed 22 September 2026. Recheck account-specific details during implementation.

- [Next.js data security](https://nextjs.org/docs/app/guides/data-security)
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) and [public media delivery](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/) and [webhook verification](https://razorpay.com/docs/webhooks/validate-test/)
- [Shiprocket developer entry](https://www.shiprocket.in/developers/) and [API reference](https://apidocs.shiprocket.in/)

Provider routes, webhook authentication, test facilities, payment methods and pricing are not invented here. Product/API rules above are our proposed implementation contract.
