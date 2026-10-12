# M5 — Dispatch, tracking, returns and refunds

Implementation: 6–8 October 2026. Scope: **T35–T43**, authorized while M4 hosted acceptance remains unverified. `APP_MODE=fixture` stays set. No real shipment, payment/refund, email or deployment was performed. Stop after this milestone for review; **M6 has not started**.

## Implementation plan followed

1. Protect admin order reads, independent payment/fulfillment/attention filters and immutable item/address/price snapshots.
2. Persist measured packing quotes and separately leased shipment creation, AWB, private label, pickup, cancellation and tracking steps; reconcile ambiguous actions before considering another creation.
3. Connect protected customer tracking/returns to policy, quantities and physical receipt/inspection. Keep restocking independent from refunds and tracking.
4. Add owner-only refund balance reservations, authoritative provider confirmation, retry/reconciliation and conservative audited hold resolution.
5. Verify fixture dispatch and recovery, cancellation, returns/restock, partial/full refunds, role/access boundaries, stale records and duplicate effects. Record all hosted limits separately.

## Delivered scope

| Task | Implemented behavior |
| --- | --- |
| T35 | Protected order list with payment, fulfillment and attention filters; paginated detail with frozen purchased items, shipping charge, address, money, shipment/return records and audit timeline. |
| T36 | Actual packed grams/dimensions; compatible packaging and allocated paid-order validation; expiring courier selection and merchant cost shown independently of the frozen customer fee. |
| T37 | Separate durable shipment create, AWB, label, pickup and cancel/sync records. Private, authenticated PDF download. Pickup scheduled is separate from physically collected. |
| T38 | Database-enforced single active forward shipment; idempotency and versions; timed-out create reconciles its original correlation. Failed pickup retries preserve the existing shipment/AWB. |
| T39 | Authenticated carrier webhook hints followed by authoritative fetch; normalized history, unknown-state holds, stale-event protection, polling fallback and capability-protected customer timeline. |
| T40 | Cancellation intent fences dispatch; ambiguous shipping/payment stays held with durable recovery. Collected parcels cannot follow ordinary cancellation. Failed delivery/RTO is explicit and never automatically restocks. |
| T41 | Policy/ownership/quantity-checked customer request; admin approval, manual reverse reference, physical receipt and inspection; separately audited sellable-only, bounded, once-only restock. |
| T42 | Owner-only integer partial/remaining refund; balance includes local pending/unknown and known provider pending refunds. Only authoritative processed evidence counts as refunded. No refund adds inventory. |
| T43 | Operations and held-order queue, audited reconciliation and eligible failed-job retry, notification status, and evidence-checked owner hold resolution. Completed RTO closes as returned only after full physical receipt/inspection, required sellable restock and confirmed full refund. Unknown outcomes cannot be cleared by guessing. |

The private label implementation stores bounded PDF bytes in a private PostgreSQL table. It does not use the public catalog-media bucket. Hosting must plan retention, access and backups for address-bearing labels.

## Files and migrations

- `src/lib/fulfillment/`: validated contracts, shipping/refund adapters, services, HTTP boundary and admin read/recovery functions.
- `src/components/admin/M5*`, admin orders/returns/operations pages, and customer order tracking/return components/routes.
- `supabase/migrations/202610060001_shipping.sql`: shipment quoting, booking/steps, events, polling, private labels and operation mappings.
- `supabase/migrations/202610060002_returns-refunds.sql`: return quantities/receipt/inspection, refunds/balance, cancellation recovery and M4 reconciliation compatibility.
- `supabase/migrations/202610060003_fulfillment-reads.sql`: protected order/operation reads, provider-specific webhook claims, job recovery and conservative hold resolution.
- Generated PostgreSQL types, focused transaction/provider/admin tests, `scripts/prepare-m5-fixture.ts` and `scripts/test-m5-http.mjs`.

Original specification files in `docs/spec` are unchanged. Their initial unchecked roadmap is preserved; this note records implementation status.

## Repeat the local fixture review

Run from the project directory. Use one application process per embedded fixture database. The command below explicitly installs a **14-day sample return window**, a labelled sample warehouse/parcel and zero sample tax where absent. It does not configure or approve a real store policy.

```sh
npm ci --ignore-scripts --no-audit --no-fund
# Copy .env.example to .env.local only if the local file does not already exist.
APP_MODE=fixture npm run prepare:m5
npm run build
npm start
# In another terminal, while the fixture server is running:
M5_TEST_URL=http://localhost:3000 npm run test:m5
```

For an isolated preview, set the same `FIXTURE_DB_DIR`, `FIXTURE_AUTH_DIR`, `FIXTURE_MEDIA_DIR` and `APP_URL` on the preparation/server commands, with `APP_MODE=fixture`. Set `M5_TEST_URL` to that exact local origin. Do not point two servers at one database. The smoke script is restricted to localhost and requires fixture identity/checkout markers before mutations. It leaves labelled sample orders for review and prints their IDs.

1. Choose Demo owner or Demo staff at `/admin/login`.
2. Place and capture a fixture order through checkout; keep its protected receipt. Open the order in `/admin/orders`.
3. Confirm the measured parcel, fetch/select the courier, create one shipment, assign its tracking number, and generate/open the private fixture label. For the default sample parcel, 1200 g / 40 × 30 × 15 cm covers the test order used by the smoke.
4. Enable “Fail next pickup once”, request pickup, then retry that step. Confirm one create operation and the same AWB. Use the fixture event controls to simulate delivery.
5. From the receipt, request the available return quantity. At `/admin/returns`, approve, record the manual reverse reference, receive/inspect, then explicitly restock a sellable item. Compare inventory before/after; repeating restock cannot add it twice.
6. As owner, submit a partial refund. It begins pending; simulate processed or timeout. Unknown funds remain reserved. Reconcile the saved operation and finish the remaining refund without altering inventory.
7. Use another order for precollection cancellation and another for RTO. RTO tracking alone leaves stock unchanged. Review holds and recovery in `/admin/operations`.

## Verification evidence

Verified on 8 October 2026:

| Command/check | Result |
| --- | --- |
| `npm run check:env` | PASS: fixture mode, local application URL. |
| `npm run types:db` | PASS: all migrations on a fresh local database, generated types, SQL/role/owner bootstrap assertions and 16-product projection parity. |
| `npm test` | **112/112 passed**, no failures/skips. Includes transaction, provider transport, role, concurrency/duplicate, cancellation and RTO resolution regressions. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS, production Webpack build. |
| `M4_TEST_URL=http://127.0.0.1:3118 npm run test:m4` | PASS on the fresh final preview: checkout, capture, recovery, cancellation and durable worker compatibility. |
| `M5_TEST_URL=http://127.0.0.1:3118 npm run test:m5` | PASS: authenticated order filters/details, quote/booking/AWB/private PDF, failed pickup recovery, protected tracking, return receipt/inspection/restock, owner refund balances/unknown recovery, cancellation, RTO closure and page rendering. |

The final local review server is `http://127.0.0.1:3118`, using the isolated `work/m5-final-review` directory outside the app. Fixture preparation completed with all final migrations. Older in-progress M5 preview databases are not the final review database. Command logs are in the workspace's `work/m5-final-*.log` files.

Review records created by the HTTP smoke:

- Delivered/refunded order: `/admin/orders/53cd8b56-5510-4320-9271-016bef3a0ae6`
- Inspected/restocked customer return: `/admin/returns/f04cd86e-7a7c-440e-ae87-3cfd304de428`
- Cancelled order awaiting its separate owner refund: `/admin/orders/a9d52a40-5521-4ce6-ab8c-1c71184f86ea`
- Physically inspected, refunded RTO resolved to returned: `/admin/orders/9c8e52dc-fe65-4ffc-b0c7-1548c83cba98`

Final handoff recorded 12 October 2026. **M5 fixture implementation is complete and stopped for review.** No M6 work has begun.

**Visual review limitation:** desktop/mobile browser inspection was not completed. On 8 October the browser creation tool stalled; on 12 October native browser access reported pending macOS Accessibility and Screen Recording permissions. Only the fixture login was observed through the browser tool. Do not treat the HTTP page-render checks as visual, responsive, keyboard or hydration verification. Those browser checks remain unverified. The final preview was restarted successfully on 12 October for manual review; no application code changed after the passing 8 October build/checks.

The focused checks use fresh PGlite databases/injected transports; they validate application and transaction behavior, not real multi-connection Supabase or provider acceptance. Private API responses are no-store/noindex, and provider webhook endpoints are disabled in fixture mode.

## Hosted acceptance remains pending

**UNVERIFIED:** every M4 gate in [M4_HOSTED_VERIFICATION.md](M4_HOSTED_VERIFICATION.md). The user will complete those using a real isolated Supabase project, Razorpay Test Mode and genuine test records, rather than importing demo data.

M5 adds the precise gates and procedures in [M5_SHIPPING_VERIFICATION.md](M5_SHIPPING_VERIFICATION.md) and [M5_RETURNS_VERIFICATION.md](M5_RETURNS_VERIFICATION.md): hosted grants/roles/concurrency, actual Razorpay partial/full/unknown refund behavior, provider correlation/webhook replay, physical return/restock, scheduler/lease recovery, and authorized carrier booking/labels/pickup/cancel/tracking/RTO.

`APP_MODE=test` uses configured Supabase and Razorpay Test Mode but **simulates courier dispatch**. Real Shiprocket data/actions require separately authorized carrier access and applicable charges; no free shipping sandbox is assumed. Fixture labels cannot ship a parcel. Real courier validation was neither requested nor performed.

Actual policies, tax/fees, warehouse/packaging, catalog assets and infrastructure approvals remain outstanding. An externally scheduled job runner and launch readiness belong to later hosted verification/M6. The app is not claimed ready for live sales.
