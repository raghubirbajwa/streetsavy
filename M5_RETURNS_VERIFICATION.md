# M5 returns, cancellations and refunds verification

Implementation recorded 7 October 2026. The workspace remains `APP_MODE=fixture`. No Supabase project, real customer records, Razorpay account, payment, refund, courier booking or email was used in these checks. M4 hosted verification remains unverified; run its checklist before relying on hosted behavior. M5 is not a launch approval.

## Implemented behavior

- Customer returns require the guest capability or verified customer identity, an authoritative delivered event, and the configured return window. A zero-day window disables requests. Nonfixture orders also require published policies. The request stores the policy wording/window used for its decision.
- Order locks protect overlapping item requests. Open requests reserve requested quantities; after inspection, only physically received quantities consume the return allowance. Rejected requests release their allowance. Different colors/sizes are displayed separately.
- Staff or owners can approve/reject, record a manual reverse reference, record received quantities, inspect, and separately restock accepted sellable quantities. Every update uses the expected version. Receiving or inspecting alone does not add inventory; money refunds never add inventory.
- RTO is a separate return kind. An authoritative `rto_delivered` event makes a manual RTO receipt available. Tracking alone never changes stock. Staff must record actual receipt and inspect each item before any sellable quantity is restocked. Owner hold resolution changes it to returned only after every ordered unit is physically accounted for, inspection/disposition is final, accepted sellable units are explicitly restocked, and a full refund has processed. Missing or uncertain evidence keeps the hold; resolution itself moves no stock or money.
- Customer/admin cancellation records its intent while holding the order lock shared with booking. Existing shipments must be authoritatively cancelled and shipping operations resolved. A collected parcel cannot follow ordinary cancellation. Uncertain payment/shipping leaves the order held and creates a durable cancellation job. Captured unshipped inventory is restored once; an owner must separately issue any refund due.
- Owner refunds reserve integer paise before provider calls. The minimum is ₹1 (100 paise), matching the provider API. The available balance subtracts processed amounts, local pending/unknown amounts, and known unmatched provider pending refunds. Staff and revoked owners cannot initiate or reconcile refunds.
- Refund POST is sent once per durable operation. A timeout remains unknown and continues reserving its amount. Retries retrieve the stored provider refund or scan the payment's refunds for the stored receipt/reference; a missing result does not permit another POST. `pending` does not mean refunded. Only matched authoritative `processed` evidence increases refunded money; duplicate/stale evidence cannot lower the total. A partial refund preserves unrelated shipping progress.
- Mode checks separate fixture orders and test/live data. Fixture controls cannot operate on real orders. An unknown refund cannot be manually labelled failed merely to release its reserved amount.

## Local automated checks

From the project directory, with Node 24 installed:

```sh
npm ci
node --experimental-strip-types --conditions=react-server --test tests/returns.test.ts tests/refunds-provider.test.ts tests/checkout-reconciliation.test.ts
```

Verified result: 21 tests passed on 7 October 2026 (9 return/refund transaction tests, 4 refund-provider adapter tests, and 8 M4 reconciliation regression tests).

These tests create in-memory PGlite databases, apply all migrations and use local fixtures/injected transports. They cover ownership, disabled policies, overlapping quantities, stale versions, physical receipt limits, damaged stock, duplicate restock, RTO separation, owner-only/revoked membership, fixture mode isolation, concurrent refund requests, provider pending reservations, unknown create recovery, mode/config guards, response correlation, pagination, malformed/mismatched responses, cancellation/pickup protection, durable cancellation recovery and payment/refund replay. They exercise the shared PostgreSQL transaction functions, but cannot prove hosted multi-connection locking or provider behavior.

M4 regression expectations intentionally change in M5: paid uncollected orders expose cancellation, a partial refund leaves ready fulfillment intact, and a later capture retains an already requested cancellation rather than making that order dispatchable.

## Fixture review in the browser

Use the preview instructions in `M5_IMPLEMENTATION.md`. Fixture settings must explicitly have a nonzero sample return window (the base fixture configuration defaults to zero). Complete checkout using the clearly marked fixture payment controls, and retain its protected receipt.

1. Open the paid order in `/admin/orders`, dispatch it through the fixture shipping controls, then simulate delivery. On the receipt, request only one of multiple purchased units. In `/admin/returns`, approve, record a reverse reference, receive one physical unit, inspect it, and separately restock it. Inventory must rise by exactly one only after the final action. Repeat the stale request to confirm rejection.
2. On a second order, simulate failed delivery and RTO delivery. Its stock must remain deducted. Record RTO receipt and inspect damaged goods: the restock action must reject damaged quantities. Use a separate sellable item to exercise an allowed restock.
3. As fixture staff, attempt a refund: it must be denied. As fixture owner, request a partial refund. Its status must initially be processing and its amount must reduce the available refund balance. Use the fixture outcome control to process it, then repeat: money moves once and inventory does not move. Shipment state remains unchanged for a partial refund.
4. Use a fresh partial refund with fixture timeout. Its amount must remain reserved while unknown. Reconcile repeatedly: no additional refund record or create operation appears. Change the simulated provider outcome to processed and reconcile; the original refund settles.
5. Cancel a paid unshipped order. It must become cancelled with refund review, restore its sold units once, and retain captured funds until the owner refunds. Cancel after physical collection: it must be refused. Cancel an authorized payment, then simulate capture: the order remains held for cancellation; the scheduler finishes the cancellation once shipping/payment state is clear.

## Hosted checks still required — all UNVERIFIED

Use separate test accounts and an isolated Supabase project, with a real test catalog and actual operational values. Do not import demo seed SQL. Keep the fixture workspace unchanged. Complete the configuration and actual test payment cases in `M4_HOSTED_VERIFICATION.md` first. Test refunds use `APP_MODE=test`, `rzp_test_...` credentials, and payments created/captured with those same test credentials. Shiprocket behavior remains simulated in test mode; real carrier work requires its separately authorized checks.

Record project reference, application build, test order/refund IDs, command output, timestamps and the expected/actual result for each case. Do not put secrets in evidence or this repository.

1. **Migrations, grants and roles.** Apply every migration in order using M4's isolated-project procedure. Inspect the new functions in the SQL editor. `anon` and `authenticated` must have no EXECUTE on `returns_*`, `refunds_*`, or the renamed M4 implementation helpers. Call customer/admin routes as signed-out, nonadmin, staff and owner users. Staff refund POST and owner requests after membership revocation must return 403; another customer's order/return must return 404.

   ```sql
   select p.proname,
     has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
     has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and (p.proname like 'returns_%' or p.proname like 'refunds_%'
     or p.proname in ('checkout_apply_payment_m4','checkout_release_reservation_m4','checkout_receipt_m4'));
   ```

2. **Real return eligibility.** Publish your actual return policy/window in the isolated test project. Create a real test order, simulate its carrier lifecycle in test mode, and log in through Supabase email recovery to access its receipt. Request a specific variant/quantity. Verify outside-window, no-delivery, disabled policy, wrong email and overlapping requests fail. For a boundary test, adjust only the isolated project's test shipment event timestamp in the SQL editor to before/after the configured window and retry. Preserve evidence of this deliberate test edit.

3. **Hosted concurrency.** With two authenticated owner browser tabs, open one captured test order and simultaneously submit separate refund keys whose combined amount exceeds its available balance. Exactly one may reserve the conflicting amount. Repeat with two customer return requests for the same remaining unit and with two staff restock submissions at the same expected version. Verify the database balance/quantity constraints and exactly one inventory movement. PGlite's serialized connection is insufficient evidence for this gate.

4. **Actual Razorpay Test Mode partial/full refunds.** On a captured test payment, use the owner UI to refund a part of the captured amount. Compare the refund's payment ID, amount, INR currency, receipt and status with the Razorpay Test dashboard. While pending, funds stay reserved and the order is not marked refunded. Run the protected scheduler or press Reconcile until the provider confirms processed. Verify one observation, one local refund, the correct `refunded_paise`, no inventory movement, and unchanged forward fulfillment. Refund the remaining available balance with a new key; only then should payment status become refunded.

5. **Authoritative retrieval and correlation.** Use the saved test refund/payment IDs to inspect `GET /v1/refunds/:id` and `GET /v1/payments/:id/refunds?count=100&skip=0` through the provider dashboard/API console with the same test credentials. Confirm receipt `rf_<local refund UUID without dashes>` or `notes.store_refund_id` survives the provider round trip. Verify pagination and the payment mapping. The app does not assume this receipt is an idempotency key.

6. **Lost refund-create response.** In an isolated test runner, inject a transport into `razorpayRefundProvider(testEnvironment, transport)` that sends the real test POST once, waits for its response, then throws locally to simulate response loss. Use `createReturnsService({rpc,env,provider})` against the isolated project. Reconcile the same local refund repeatedly. Confirm Test Mode contains one provider refund, the app finds its receipt/reference, and the local amount stays reserved throughout. A query returning no match must remain unknown, with no second POST. Repeat by killing the worker after provider acceptance and allowing its operation lease to expire. Do not use a real-money payment for fault injection.

7. **Refund webhook replay and stale events.** Enable Razorpay's test refund/payment webhooks using M4's raw-signature gate. Deliver duplicate/reordered notifications and invoke the scheduler. The worker must retrieve current provider evidence, preserve the same provider refund ID/amount/payment mapping, settle the local operation, and never double count processed money. A bad signature or wrong amount/currency/payment/mode must not change the money balance. Inspect `provider_refund_observations`, `refunds`, `external_operations` and `orders`.

8. **External dashboard refund.** Create a partial refund through the Razorpay Test dashboard. Reconcile payment evidence in the app. While its provider status is pending, it must reduce the amount another local refund can reserve even though it has no local request row. Once processed, it contributes once to the order total. Repeat with a local pending refund to confirm no double subtraction for a matched provider ID.

9. **Cancellation races.** Against two hosted app requests, race customer cancellation with booking and pickup. Cancellation must mark/lock the order before dispatch can start. Existing running/unknown create or pickup operations prevent a premature cancellation completion. Only authoritative provider cancellation may finalize an existing shipment; a collected shipment is refused. Test authorized payment → cancellation request → capture: fulfillment stays held, stock never goes negative, a durable `order.cancel` job finishes only once safe, and captured funds remain for an owner refund. Repeat scheduler calls after completion and verify stock returns once. Test-mode carrier results establish application behavior only; real carrier concurrency must be separately validated with authorization.

10. **Receipt, inspection and restock.** Run one customer partial return and one RTO in the isolated project. Record received quantities smaller than requested, inspect sellable/damaged units, and restock only the accepted sellable count. Confirm missing units become available for a new request only after inspection completes. Verify the item-level `inventory_movements`, actor/reason audit rows and stale-version rejection. Refund processing and tracking callbacks must not add stock. On the RTO, try owner hold resolution before complete receipt, before sellable restock, and before the full processed refund: each must refuse. Complete those steps and resolve with an evidence reason; fulfillment becomes returned with one audit entry and no extra stock/money movement. Replay tracking/payment reconciliation and verify returned remains stable.

11. **Scheduled recovery without a browser.** Configure the external scheduler from M4. Queue an unknown refund and an uncertain cancellation, close all browsers, and verify retries/backoff/lease recovery through persisted `jobs` and `external_operations`. A worker crash on its final lease must appear as a dead job after lease reclamation. Use the operations panel to reconcile evidence; an unknown refund's amount must not be released through a manual state guess.

## Provider contract references

Verified against official Razorpay documentation during M5 implementation: [normal refund creation](https://razorpay.com/docs/api/refunds/create-normal/), [fetch refund by ID](https://razorpay.com/docs/api/refunds/fetch-with-id/), and [fetch a payment's refunds](https://razorpay.com/docs/api/refunds/fetch-multiple-refund-payment/). The adapter sends an explicit amount, normal speed, local receipt and a store refund ID note; it retrieves authoritative statuses and uses bounded pagination. No provider idempotency guarantee is inferred from the receipt field. A normal refund POST is not evidence that a refund has processed.
