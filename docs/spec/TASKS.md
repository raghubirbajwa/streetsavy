# Implementation Roadmap and Verification Checklist

Version 2.0 · 23 September 2026

Status: all implementation tasks are pending. Only this specification package has been produced. Complete milestones in dependency order; mark checked only after actual verification. A full-build request covers the implementation scope below, while live deployment/financial/courier activity still requires the relevant authorization.

## M0 — Inspect and configure the project

- [ ] T01 Read all ten docs and applicable repository instructions; inspect actual app, lockfile and existing code.
- [ ] T02 Record stack versions, preserve unrelated changes and create a short implementation plan.
- [ ] T03 Set mode contract (fixture/test/live), validated environment module and `.env.example` with no secrets.
- [ ] T04 Record unresolved brand/assets/business inputs and begin fixture work without unnecessary blocking questions.
- [ ] T05 Verify current official SDK/provider contracts, particularly Shiprocket authentication/tracking/test facilities; do not assume unsupported endpoints or a sandbox.

Exit: reproducible app foundation and actual setup commands documented, no fake configured services.

## M1 — Supabase foundation and admin identity

Dependencies: M0. Covers FR-07 and foundational NFRs.

- [ ] T06 Write migrations for DATA_MODEL entities, constraints/indexes, RLS/grants and typed schemas.
- [ ] T07 Implement public catalog read projections and private server clients; verify no accidental RLS bypass in views/RPCs.
- [ ] T08 Implement Supabase SSR/session refresh and owner/staff membership checks; document trusted first-owner bootstrap/reset.
- [ ] T09 Build admin login/layout and no-access states; verify direct API calls by nonadmins are denied.
- [ ] T10 Implement durable jobs/external operations/webhook inbox/audit infrastructure with leases and dedupe.
- [ ] T11 Create fixture/test seed with deterministic UUIDs and sixteen products. Never auto-seed live.

Exit: migrations run on clean test DB; public/nonadmin/admin permission tests pass; no browser secrets.

## M2 — Catalog, media and operating admin

Dependencies: M1. Covers FR-08/09/12.

- [ ] T12 Product list/editor, draft/preview/publish/archive and version conflict handling.
- [ ] T13 Variant matrix with unique SKU/colour/size; prices, weights, size guides and packaging compatibility.
- [ ] T14 Inventory adjustment transaction, stock movement history and reserved/available visibility.
- [ ] T15 R2 private signed uploads, CORS, byte/type/dimension/video validation and safe retry/cleanup.
- [ ] T16 Media ordering/colour/cover, private preview and publish promotion; public asset URLs and private labels separated.
- [ ] T17 Collections/homepage draft/publish, validated references and cache invalidation.
- [ ] T18 Owner settings for warehouse, packaging, shipping fee mode, tax-inclusive config and policies; audit changes.

Exit: authorized admin publishes a real test product with variants/images, it becomes public without a source redeploy, and archive removes it without damaging order history.

## M3 — Storefront design and shopping

Dependencies: M1 catalog; M2 content/media conventions. Covers FR-01/02/03.

- [ ] T19 Implement DESIGN tokens, original branding, responsive shell and truthful CONTENT copy.
- [ ] T20 Build animated campaign hero, categories, arrivals, story, featured and optional real lookbook.
- [ ] T21 Collection/search routes, matching-variant filters, URL state, stable sorting/pagination and not-found/error states.
- [ ] T22 Product gallery/colour/size/guide/availability; quick add reuses purchase logic.
- [ ] T23 Server guest session/cart with versions, current pricing, local wishlist and reliable hydration.
- [ ] T24 Support/policy routes, Track order entry, live newsletter hidden until integrated.
- [ ] T25 Review desktop/mobile/320px/zoom/keyboard/reduced motion; capture design screenshots.

Exit: connected home → collection → product → cart journey; no inert visible controls. A mock storefront alone does not complete the full project.

## M4 — Quotes, inventory reservation and Razorpay

Dependencies: M1–M3 and test accounts where needed. Covers FR-04/05/06.

- [ ] T26 Address validation and Shiprocket serviceability/quote adapter; compatible one-parcel packaging; customer fee separate from courier cost.
- [ ] T27 Immutable expiring quote, tax-inclusive totals and stale quote/cart invalidation.
- [ ] T28 Atomic checkout/order/item snapshot/reservation transaction; concurrent last-unit and multiple-tab protection.
- [ ] T29 Razorpay Test Mode order creation, idempotent external operations, Checkout UI and pending recovery.
- [ ] T30 Server signature verification, amount/currency/mode mapping and captured-state application.
- [ ] T31 Raw verified webhook inbox, dedupe/out-of-order handling and refund/payment reconciliation.
- [ ] T32 Reservation expiry/cancellation/late-capture stock policy, held-order attention path.
- [ ] T33 Protected receipt/order access and Supabase verified-email OTP recovery.
- [ ] T34 Transactional notification outbox with configured delivery adapter and truthful failure state.

Exit: actual Razorpay test payment plus callback/webhook/reconciliation converges to one order/capture/inventory deduction. Close-browser and duplicate-event cases work. Fixture payment is insufficient evidence.

## M5 — Dispatch, tracking, returns and refunds

Dependencies: M4. Covers FR-10/11/12.

- [ ] T35 Admin order panel with separate payment/fulfillment/attention state and immutable line snapshots.
- [ ] T36 Packing weight/dimensions, courier quote selection and paid-order dispatch eligibility.
- [ ] T37 Create shipment, assign AWB, private label download and pickup as separately persisted operations.
- [ ] T38 Single forward shipment constraint; reconcile ambiguous creates; partial failure retries only missing steps.
- [ ] T39 Authenticated/authoritatively verified tracking events, provider status mapping, polling fallback and protected customer timeline.
- [ ] T40 Cancel-before-pickup protection and explicit failed-delivery/RTO workflow.
- [ ] T41 Customer return request, admin approval/manual reverse-reference, receipt/inspection and item-level restock.
- [ ] T42 Owner-only partial/full refund with atomic refundable-balance reservation and provider confirmation.
- [ ] T43 Operations queue for retry/reconcile/attention and audited manual resolutions.

Exit: test/fixture dispatch journey includes AWB success + failed pickup recovery without duplicate shipping; real carrier validation is explicitly recorded when safe access/authorization exists. No assumption that Shiprocket offers free test shipments.

## M6 — End-to-end verification and launch readiness

- [ ] Q01 Authorization: anon/nonadmin cannot reach admin writes, private media or other customers' orders; membership revocation and owner-only refund enforced.
- [ ] Q02 Catalog: black/S + blue/M does not match black+M; price/stock sort uses matching variants; public drafts are invisible.
- [ ] Q03 Money: integer amounts, inclusive taxes not added twice, quote stale handling, final Razorpay total exact.
- [ ] Q04 Concurrency: two buyers for last unit; two tabs start checkout; duplicate capture; reservation expiry plus delayed webhook; no negative/oversold stock.
- [ ] Q05 Payments: failed/authorized/captured states, invalid signature, wrong amount/currency/mode, callback lost, webhook duplicate/out of order, provider unavailable.
- [ ] Q06 Refunds: concurrent partial refunds, unknown timeout, processed callback twice, restock once only after inspection or unshipped cancellation.
- [ ] Q07 Shipping: unserviceable PIN, unsupported package, changed actual dimensions/cost, duplicate booking, AWB/pickup partial failure, cancelled/picked-up race, stale event/RTO.
- [ ] Q08 Media: unauthorized upload, oversized/mismatched file, incomplete validation, draft privacy, publication failure, referenced-media deletion and cleanup bounds.
- [ ] Q09 Browser: admin adds/publishes → customer finds/selects/pays → admin packs/books → customer tracks; exercise pending/error paths and return request.
- [ ] Q10 UX: desktop/mobile sizes, long titles, keyboard focus, reduced motion, contrast, 200% zoom, no hydration/console errors or dead links.
- [ ] Q11 Engineering: typecheck/lint/tests/production build, route validation, no secret scans failures; record actual commands/results and any untested provider/device.
- [ ] Q12 Operations: real external scheduler runs when no browser/laptop is open; recover expired leases/dead jobs; monitor missed webhooks and old pending orders.
- [ ] Q13 Launch content: brand/assets/real size guides/stock/weights, pickup/packaging, tax/fee settings, return/shipping/privacy/terms and support approved.
- [ ] Q14 Infrastructure: segregated live keys/data, HTTPS callback/webhooks, R2 custom domain/private buckets, email deliverability, backups/restore test, host/runtime and rollback documented.
- [ ] Q15 Authorized deployment only after readiness; controlled live payment/shipment tests require explicit applicable authorization and recorded outcomes.

Exit: describe exactly what is production-ready and what remains blocked. Test results do not certify legal/tax correctness or guarantee conversion/performance. No live launch claim until actual deployment and smoke checks succeed.

## Later enhancements

COD/remittance/RTO risk controls; automated exchanges; multi-parcel/multi-warehouse; customer accounts/synced wishlist; coupon/loyalty/reviews; bulk import; provider rate optimization; managed video streaming; optional garment 3D. None should delay v1 unless the user changes scope.

## Working log template

For each milestone record date, files/migrations changed, verified commands/results, screenshots where useful, provider mode, missing inputs/credentials and next task. Keep untested checks unchecked. Current state: specification prepared, implementation not started by this package.
