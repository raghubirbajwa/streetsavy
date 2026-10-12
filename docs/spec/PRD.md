# Product Requirements Document

Version 2.0 · 23 September 2026 · Planned product, not an implementation report.

## Product and audience

Create an Indian clothing store selling contemporary streetwear, with original Bonkers Corner-inspired art direction, mobile-first shopping, and an admin workspace for operating the catalog and orders. Shoppers discover clothing, choose a valid size/colour, pay securely and track delivery. Admins maintain products without code changes and ship orders after packing.

The reference site's accessible content was reviewed on 18 September 2026; exact current geometry and animations were not browser-audited. Our design specifications are proposed choices. Do not copy its brand, images or endorsements.

## Launch scope

Next.js storefront/server/admin; Supabase database/Auth; Cloudflare R2 media; Razorpay prepaid checkout; Shiprocket availability, quotes, courier booking and tracking. India, INR, single pickup location, one parcel per order. Guest checkout; email OTP may recover access to an order. No compulsory customer password account.

Include manual return requests, inspection and admin-issued refunds. Reverse shipping may initially be arranged through the provider dashboard with its reference recorded. Size exchanges are handled as an approved return/refund and separate new order; no automatic stock swap workflow in v1.

Deferred: COD, international/multi-currency, split shipments, multi-warehouse, coupons/loyalty, reviews, customer account dashboard, bulk import, automated exchanges and elaborate analytics. Optional 3D hero is not a launch dependency.

## Requirements

### FR-01 — Brand and homepage

Editable wordmark, hero image/video, campaign text, collection links and featured products. Category tiles, arrivals, collection story, featured grid, optional lookbook and footer. Acceptance: mobile/desktop hierarchy is coherent; all live CTAs work; publishing content updates the storefront without rebuilding source.

### FR-02 — Catalog and discovery

Collection directory/listings, query-string filters, sorting, pagination, search and availability. Acceptance: AND across filter groups, OR within a group, variant filters match one variant; reload/back restore state; draft/archived products are absent from public queries; no-results has reset.

### FR-03 — Product and cart

Gallery, colour/size selection, real size guide, quantity, local wishlist and server guest cart. Acceptance: valid variant required, consistent integer-money totals, same variants merge, unavailable sizes cannot be bought, and stale carts are repriced before payment. A cart does not reserve inventory.

### FR-04 — Shipping quote and address

PIN-code availability check and checkout address. Server chooses packaging and requests serviceability/rates. Acceptance: full order is deliverable in one supported parcel, shipping amount and estimated delivery are shown before payment, unserviceable destinations block checkout, provider downtime never becomes free shipping by default.

### FR-05 — Razorpay checkout

Create store order, stock reservation and provider order server-side; display Razorpay Checkout; verify returned signature and authoritative captured status. Acceptance: exact amount/currency/order mapping, safe repeat clicks/events, pending verification state, stock and payment updated once, no paid fulfillment based solely on client success.

### FR-06 — Customer order and tracking

Order confirmation, separate payment/shipment statuses and tracking timeline. Acceptance: current guest capability or verified email owner can read the order; order number/PIN alone cannot expose details. Confirmation appears only after server verification; email failures do not erase paid orders.

### FR-07 — Admin access

Supabase Auth and protected admin membership. Acceptance: nonadmins denied at every mutation/read of private data; users cannot promote themselves; server validates session and current membership; bootstrap and recovery are documented. Privileged actions require a current session; recommend MFA for production admins.

### FR-08 — Product, variant and inventory admin

Search/paginated product list; create/edit draft; title/description/category; colour-size matrix; SKU, price, weight and stock; size guide; preview; publish/archive. Acceptance: unique variants, field errors, optimistic update conflicts, audited stock adjustments, no hard deletion of ordered variants, required content validated on publish.

### FR-09 — Media admin

Authenticated direct uploads to private R2 staging; validate content and attach to product/colour; reorder/set cover; publish approved copies to public media domain. Acceptance: no public draft uploads, no secret keys in browser, no broken image as a successful upload, referenced assets not destructively removed, orphan cleanup is bounded.

### FR-10 — Order and shipping admin

View paid/attention orders; pack and confirm actual measurements; fetch courier options; create shipment, assign AWB, download label, request pickup and track. Acceptance: only paid, allocated, uncancelled orders ship; creation/AWB/pickup are distinct states; repeat clicks/timeouts cannot silently create duplicate parcels; unavailable providers preserve order for retry.

### FR-11 — Returns, cancellations and refunds

Customer request plus admin review; cancel before fulfillment when eligible; record reverse pickup/receipt/inspection; initiate exact partial/full refund with reason. Acceptance: policy controls customer eligibility, manual exceptions audited, concurrent refund amounts never exceed captured balance, refunds settle only when provider confirms, restocking occurs only after inspection or eligible unshipped cancellation.

### FR-12 — Content and operations

Admin collections/homepage, single warehouse/settings, jobs/attention queue, audit history and essential transactional notifications. Acceptance: credentials remain in server environment; failed jobs expose actionable retry/reconcile paths; business settings required for launch; newsletter stays hidden until a real integration exists.

## Nonfunctional requirements

- NFR-01 Accessibility: aim for WCAG 2.2 AA, labelled controls, keyboard/focus support, useful errors and reduced motion. No claim of certification from automated checks alone.
- NFR-02 Responsive: 320px reflow; reviewed 360/390/768/1024/1440px and 200% zoom. Admin tasks remain usable on mobile.
- NFR-03 Performance: reserve media dimensions, optimize images/video and defer optional 3D. Production targets LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at p75; separate lab measurements from field results.
- NFR-04 Consistency: Postgres transactions own stock/money invariants; durable jobs and idempotent state transitions handle external calls. No business-critical work in an unawaited background promise.
- NFR-05 Privacy/security: RLS, ownership, secure cookies, no public order lookup, no caching private responses, minimal PII, validated uploads and server-only secrets.
- NFR-06 Operability: migrations/backups, scheduled reconciliation, failure logs with redaction, tested restores and documented setup. Routine catalog updates do not require redeployment.

## Money and shipping rules

Integer paise, INR; units include grams and centimetres. Proposed v1 pricing is tax-inclusive: item and shipping payable totals already include applicable taxes; tax breakdown is informational and must not be added twice. Business supplies the tax treatment/rates and invoice requirements before live checkout.

Shipping customer fee and actual courier cost are distinct fields. Default provider-quote mode; configurable flat/threshold policy requires explicit amounts. Checkout freezes the customer total. Admin packing differences never silently increase a paid customer total; merchant absorbs the difference or resolves it with the customer outside the automatic charge path.

Reserve stock at checkout, not add-to-cart. Default reservation window 15 minutes; late captures and uncertain provider outcomes follow DATA_MODEL.md. Keep payment, order, refund and shipment lifecycles separate.

## Completion and launch

Build milestones in TASKS.md: foundation; catalog/admin/media; storefront; checkout; shipping/operations; launch readiness. Fixture/test modes support progress but do not count as provider integration verification. Credentials/policies gate live operation, not completion of unrelated code.

Launch requires real assets/catalog, confirmed policies/taxes/pickup/packaging, successful provider tests, real scheduler, protected order access, recovery paths and explicit deployment authorization. No invented conversion targets or testimonials. Unresolved business choices are centralized in README.md.
