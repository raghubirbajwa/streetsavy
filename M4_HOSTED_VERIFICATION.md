# M4 hosted acceptance runbook

> M6 compatibility note (12 October 2026): all hosted gates remain **BLOCKED** in the fixture review. Apply all current migrations. M5 adds owner refunds, cancellation intent preservation and three bounded workers. Follow [M5_RETURNS_VERIFICATION.md](M5_RETURNS_VERIFICATION.md) for current cancellation/refund outcomes. The `assert-order ... cancelled` helper state is for **uncaptured** cancellations; inspect paid-cancellation inventory/refunds using the M5 gates instead. No hosted helper invocation has been executed during M6.


Prepared 30 September 2026. **Every hosted gate below is UNVERIFIED.** M4 development remains `APP_MODE=fixture`. This document and the opt-in helper make the remaining checks reproducible; no Supabase project, Razorpay account, email provider, scheduler or deployment was contacted to run them. The helper's syntax, `--help`, fixture/missing-opt-in/live-key/wrong-project refusals and invalid count/state refusals were checked locally only.

The M4 roadmap exit requires an actual Razorpay **Test Mode** transaction. Fixture simulation does not satisfy that exit. Record the date, code version/checksum, isolated Supabase project reference, test order/payment/event IDs, commands and sanitized output for each gate. Do not save cookies, passwords, keys, signatures, OTPs, raw addresses or unredacted payment payloads in review notes.

## Isolated setup — required before G01–G14

Use a new Supabase development project containing no live orders and a separate app copy/runtime. Keep the review app's `.env.local` at `APP_MODE=fixture`. Do not run `prepare-m4-fixture.ts` against hosted data; it rejects test/live. Do not share live provider keys or data with this setup.

1. Install Node compatible with `package.json`, npm and PostgreSQL `psql` on the test operator's machine. Use `npm ci` in the separate app copy. In a private env file outside the source/review folders, set the variables below. `APP_URL` is the exact origin users visit; a public HTTPS test origin is required for real incoming webhook delivery. A localhost origin can exercise Supabase and browser Checkout, but cannot by itself prove webhook delivery. Arrange a test host/tunnel separately when authorized.

   ```dotenv
   APP_MODE=test
   APP_URL=https://YOUR-ISOLATED-TEST-ORIGIN
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-TEST-PROJECT-REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_TEST_PROJECT_PUBLISHABLE_KEY
   SUPABASE_SECRET_KEY=YOUR_TEST_PROJECT_SERVER_SECRET
   RAZORPAY_KEY_ID=rzp_test_YOUR_TEST_KEY
   RAZORPAY_KEY_SECRET=YOUR_TEST_KEY_SECRET
   RAZORPAY_WEBHOOK_SECRET=YOUR_SEPARATE_TEST_WEBHOOK_SECRET
   JOBS_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
   M4_TEST_ACK=isolated-supabase-razorpay-test
   M4_EXPECT_SUPABASE_REF=YOUR-TEST-PROJECT-REF
   M4_NONADMIN_EMAIL=YOUR_NONADMIN_TEST_MAILBOX
   M4_NONADMIN_PASSWORD=YOUR_NONADMIN_TEST_PASSWORD
   M4_OWNER_EMAIL=YOUR_OWNER_TEST_MAILBOX
   M4_OWNER_PASSWORD=YOUR_OWNER_TEST_PASSWORD
   M4_TEST_VARIANT_ID=YOUR_DEDICATED_LAST_UNIT_VARIANT_UUID
   M4_TEST_ADDRESS_FILE=/absolute/private/path/test-address.json
   # Optional, for the actual notification delivery gate:
   TRANSACTIONAL_EMAIL_PROVIDER=resend
   TRANSACTIONAL_EMAIL_API_KEY=YOUR_ISOLATED_RESEND_KEY
   TRANSACTIONAL_EMAIL_FROM=YOUR_VERIFIED_SENDER_EMAIL
   ```

   These are placeholders, not credentials. Restrict the file and test-address file to the operator (`chmod 600`). Set shell variable `M4_ENV_FILE` to its absolute path. Use a fresh shell so existing exported environment values cannot override this file. The helper reads `APP_URL`; there is no `M4_TEST_URL` knob. It refuses fixture/live mode in its own environment, a non-test Razorpay key, an unexpected Supabase project reference or a database containing live orders. These guards do not remotely attest the running server's mode or keys: before any helper mutation, verify the separate server process was built/started with this same test file, and that its Razorpay key starts with `rzp_test_`. The race helper confirms its quotes exist in the expected database before reserving stock, then checks the returned test order/key; that final check happens after creating an unpaid provider order.

2. Connect `psql` using the new project's trusted database connection settings. Set the private shell variable `M4_DATABASE_URL` yourself; never put it in the repository. Apply each migration **once, to the fresh database**, in filename order. These SQL files are not an idempotent migration runner. For an already migrated isolated project, apply only its unapplied files using its existing migration history.

   ```sh
   for migration in supabase/migrations/*.sql; do
     psql "$M4_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration" || exit 1
   done
   ```

3. Create and verify separate owner and nonadmin email/password users in Supabase Auth. The nonadmin must own no orders for the `permissions` helper. Bootstrap the owner with the existing trusted script:

   ```sh
   psql "$M4_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
     -v owner_user_id='OWNER_AUTH_UUID' -f scripts/bootstrap-owner.sql
   ```

4. Start the separate test build. The public Supabase environment values must be correct at **build time** as well as runtime. The commands below use a local listener; a configured HTTPS reverse proxy/tunnel can point to it while `APP_URL` remains the public test origin.

   ```sh
   node --env-file="$M4_ENV_FILE" node_modules/next/dist/bin/next build --webpack
   node --env-file="$M4_ENV_FILE" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3116
   ```

5. Log in as the owner through `/admin/login`. Configure one active warehouse with valid PIN/address, an active packaging preset with measured dimensions/tare/capacity, product compatibility, and commerce settings with an explicit inclusive tax rate and fee policy. Publish a dedicated test product/variant with valid price/weight, guide and media. Real media publication also needs the isolated R2 variables documented in `.env.example`; do not claim that gate passed if R2/media remains unconfigured. Use admin inventory adjustment to leave the race variant with exactly `on_hand=1`, `reserved=0`; do not force reserved stock to zero. Create `test-address.json` using the exact `AddressDTO` shape below and a mailbox you control:

   ```json
   {"fullName":"Test Operator","phone":"9000000000","email":"YOUR_CONTROLLED_MAILBOX","line1":"TEST_ADDRESS","line2":"","city":"Bengaluru","stateCode":"KA","pincode":"560001","country":"IN"}
   ```

6. In Razorpay **Test Mode**, configure the test webhook URL `APP_URL/api/v1/webhooks/razorpay`, its separate secret, and payment/refund events available for the account (`payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`). Record actual subscribed events and capture settings. Use automatic capture for the normal success test; temporarily select manual capture only for G06, then restore it. Use the current [Razorpay test-payment instructions](https://razorpay.com/docs/payments/payments/test-card-details/) and [capture settings](https://razorpay.com/docs/payments/payments/capture-settings/), not real card details.

7. Configure Supabase Email Auth and a working test SMTP sender. Set the site/redirect origins to the test app. The Magic Link/OTP template must contain `{{ .Token }}` because `/track-order` expects a numeric code. Check the new-user confirmation template too, since recovery permits user creation. See [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless#with-otp) and [email templates](https://supabase.com/docs/guides/auth/auth-email-templates). Supabase's built-in email limits/recipient restrictions can prevent delivery; actual inbox receipt is required for G12.

**Shipping boundary:** `APP_MODE=test` deliberately uses deterministic shipping: PIN `999999` is unserviceable; `888888` simulates provider unavailability; other accepted PINs yield a ₹75 sample courier cost. Customer fees still follow configured `provider`, `flat` or `free_above` policy. This run does not certify Shiprocket serviceability, pickup configuration, parcel rates or live shipment behavior. No Shiprocket sandbox is assumed, and no shipment is created by this runbook.

## Gates and exact checks

### G01 — Clean migrations, RLS and grants (UNVERIFIED)

Run the migration loop above; retain successful filenames and query the real database. Both result sets below must contain **zero rows**:

```sql
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

select p.oid::regprocedure as exposed_private_rpc
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
and (p.proname like 'checkout_%' or p.proname in
 ('reserve_checkout','apply_verified_payment','release_reservation','claim_jobs',
  'claim_operation','receive_webhook','finish_webhook'))
and (has_function_privilege('anon',p.oid,'execute')
  or has_function_privilege('authenticated',p.oid,'execute'));
```

Run the helper:

```sh
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs permissions
```

It verifies public catalog access, anon base-order denial, private-RPC denial for actual anon/nonadmin/owner JWTs, nonadmin order RLS, owner membership and unauthenticated admin HTTP denial. Additionally log in through the app as the nonadmin and request `/api/v1/admin/products`: expect 403. Log in as owner: expect authorized admin reads. Revoke the owner's membership in the trusted SQL console, retry the same session/API and expect denial; restore through `bootstrap-owner.sql`. Inspect a browser network capture: only the publishable Supabase key may be public; no service key/provider secret/guest hash may appear.

### G02 — Real guest ownership and Supabase session behavior (UNVERIFIED)

Create an unpaid order in browser A. Copy its `/orders/UUID` and operation URL into private browser B; both must return 404/no order data. A refresh in A must preserve receipt access. Inspect the guest cookie: HttpOnly, SameSite=Lax and Secure on the HTTPS test origin; private API responses must be `no-store`. Revoke A's guest session in the isolated DB (`guest_sessions.revoked_at=now()` for its order's session) and retry: guest access must fail. Use G12 to recover access. The race helper also checks cross-guest order and operation denial.

### G03 — Address, quote freshness, fees and tax (UNVERIFIED)

In browser DevTools Network, preserve the request payloads for `/checkout/quote` and `/checkout/sessions` without saving PII. Test malformed PIN/phone, wrong country, blank required address, and added `totalPaise`/status fields: expect 422 and no quote/order. PIN `999999` returns 422 `UNSERVICEABLE_PIN`; `888888` returns 503; neither creates a payment attempt.

Get a valid quote, then change the cart in another tab and submit the saved `{quoteId}` with a fresh idempotency key: expect 409 `QUOTE_STALE`, zero order/reservation for that quote. Repeat with a variant price change, packaging/warehouse change, and commerce-settings version change in admin. Repeat after its real ten-minute expiry (do not alter an immutable quote). For a cart exceeding every compatible preset expect `PACKAGING_UNSUPPORTED` and no provider order. Compare quote, order, Razorpay order and callback amount: exact integer paise, INR; `total = sum(line payable) + customer shipping fee`. Included tax is displayed within that total. Exercise all three fee policies and both sides of the free threshold; verify courier cost remains private and is not silently substituted for flat/free customer fees.

Use at least two distinct cart lines and a nonzero configured test tax rate so rounding is exercised. After checkout, run this read-only SQL with its order UUID: `quote_and_order_tax_match`, `line_tax_matches` and `aggregate_tax_matches` must all be true. The formula sums tax rounded independently for each payable line plus shipping; tax is never added again to the customer total. This checks the configured arithmetic, not whether that tax rate is appropriate for a real business.

```sql
select o.id, o.tax_breakdown=q.tax_breakdown as quote_and_order_tax_match,
  bool_and((i.tax_breakdown->0->>'includedPaise')::bigint =
    round(i.line_payable_paise::numeric * (i.tax_breakdown->0->>'ratePercent')::numeric /
      (100 + (i.tax_breakdown->0->>'ratePercent')::numeric))) as line_tax_matches,
  (o.tax_breakdown->0->>'includedPaise')::bigint =
    sum((i.tax_breakdown->0->>'includedPaise')::bigint) +
    round(o.shipping_fee_paise::numeric * (o.tax_breakdown->0->>'ratePercent')::numeric /
      (100 + (o.tax_breakdown->0->>'ratePercent')::numeric)) as aggregate_tax_matches
from public.orders o join public.order_items i on i.order_id=o.id
join public.shipping_quotes q on q.id=o.quote_id
where o.id='ORDER_UUID'
group by o.id,q.id;
```

Check database immutability in the trusted SQL editor with `BEGIN; UPDATE public.shipping_quotes SET shipping_fee_paise=shipping_fee_paise+1,total_paise=total_paise+1 WHERE id='QUOTE_UUID';` — expect `IMMUTABLE_QUOTE`, then `ROLLBACK;`. Separately try changing an existing `order_items.product_title` inside a transaction — expect append-only rejection, then rollback. Read the saved order after archiving its product; its financial/title/size snapshots must remain unchanged.

### G04 — Actual concurrent last unit and multiple tabs (UNVERIFIED)

With the dedicated variant at one available unit and no unrelated worker modifying it, run:

```sh
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs race
```

This sends **separate, concurrent HTTP requests** with distinct guest cookies to an app using real PostgreSQL. Exactly one checkout must reserve, the other must receive 409 `STOCK_CONFLICT`; no negative stock or second order may exist. It replays the winner concurrently with the same key and expects the same order, checks same-key/different-owned-quote `IDEMPOTENCY_CONFLICT`, verifies ownership and inventory conservation, and cancels/reconciles the unpaid winner. If an assertion fails, it reports every returned order ID and attempts cleanup of each uncaptured Test order in the expected project, including an unexpected double winner. The final stock must again be one on-hand, zero reserved. The test creates an unpaid Razorpay Test Mode order; it never submits payment. If cleanup cannot prove cancellation, its printed order ID remains pending/held for reconciliation: do not manually erase its reservation.

Also open one cart in two tabs, obtain two quotes, and click Pay near-simultaneously using distinct keys. Exactly one store order may be pending; the second gets `QUOTE_STALE` or `CHECKOUT_IN_PROGRESS`. Repeat the race at least five times, restoring only legitimate available stock via admin adjustments between runs. Repeat with two variants added in opposite orders to the two carts to check the stable lock order; no deadlock, double reservation or partial order may remain. This hosted contention evidence is distinct from sequential PGlite tests.

If a checkout HTTP response times out before its order ID is returned, automatic cleanup cannot confirm the outcome. Use the two `race-quotes` IDs printed before the requests in trusted SQL: `select id,order_status,payment_status from public.orders where quote_id in ('FIRST_QUOTE_UUID','SECOND_QUOTE_UUID');`. Keep the scheduler running and inspect `/admin/operations`; let verified unpaid expiry release stock. Do not repeat the race while an earlier reservation is unresolved.

### G05 — Actual captured payment, callback and webhook convergence (UNVERIFIED)

Complete one real Razorpay **Test Mode** Checkout success in the browser. Record store order UUID, Razorpay order/payment IDs, dashboard amount/currency and capture status. Check Network for a successful `/api/v1/payments/razorpay/verify`; the server must use its stored provider order ID and fetch the authoritative payment. Wait for the actual provider webhook to be durably received and run:

```sh
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs jobs 20
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs assert-order ORDER_UUID captured
```

The helper checks real database totals, one local payment-attempt record, exact capture amount, reservation/inventory conservation, one sale movement per variant and one payment notification. Repeat callback verification (DevTools Replay XHR), deliver the webhook again and refresh/reconcile the receipt; rerun `assert-order`. The same order remains captured/ready with no further deduction or notification. In SQL, compare `payment_attempts.provider_order_id` to the dashboard order; one provider order is associated with that local operation.

### G06 — Failed attempt, authorized state, and retry within one provider order (UNVERIFIED)

Use Razorpay's supported Test Mode failure path. The store remains pending, not falsely cancelled; no sale movement or capture is recorded. Reopen payment from that receipt and succeed before reservation expiry: the **same Razorpay order** must be reused, the authoritative successful payment must win over earlier failed payment entries, and exactly one sale/outbox remains.

For a separate order, configure Test Mode manual capture, complete authorization and reconcile. Run `assert-order ORDER_UUID authorized`: captured amount zero, reservation held, fulfillment not ready. Attempt cancellation: it must remain held pending authoritative resolution. Capture the payment using the Razorpay Test dashboard's supported control, deliver webhook/run jobs, and expect captured funds with fulfillment held for the existing cancellation intent, never dispatch-ready. Run the scheduler until cancellation is safe; the owner then separately refunds captured funds. Follow M5 returns gate 9 for the held-to-cancelled transition. Do not use the helper’s uncaptured `cancelled` state assertion for this paid cancellation. Restore automatic capture. If the account does not expose manual-capture testing, leave this gate unverified and record the account limitation.

### G07 — Lost callback, dismissal and browser closure (UNVERIFIED)

Dismiss Checkout before paying: receipt remains pending and Resume payment reuses the same provider order. For another order, block only `/api/v1/payments/razorpay/verify` using browser request blocking, complete a successful Test payment and close the tab before its callback arrives. Keep app/server and the external scheduler running. Actual webhook or provider polling must converge without any browser. Reopen through the original cookie or G12 recovery, then run `assert-order ORDER_UUID captured`. Restore request blocking. A paid-looking Checkout UI alone is not passing evidence.

### G08 — Raw signatures, duplicates and out-of-order events (UNVERIFIED)

First confirm actual Razorpay delivery succeeds over the deployed HTTPS path, not just a locally signed sample. Save exact raw **test** JSON temporarily in a private file and its event ID privately. Configure `M4_WEBHOOK_EVENT_ID` in the private env file to that event ID; use the exact original bytes when replaying an existing ID. Then run:

```sh
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs webhook-replay /absolute/private/path/raw-test-event.json
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs assert-order ORDER_UUID captured
```

The helper signs the raw bytes using the test webhook secret, delivers the same event twice, checks one durable inbox row, and appends a space while retaining the old signature: the altered request must receive 403. It runs one worker request, which claims at most one job per checkout/shipping/refunds worker (up to three total); run `jobs 20` if older queued work is ahead of this event. The command exits nonzero when a worker reports failure; inspect `/admin/operations` and `jobs.last_error` before retrying. A self-signed replay verifies application handling, not provider transport.

Replay an older authorized/failed event after actual capture using its own original event ID/raw body, then rerun jobs and `assert-order`: captured state must not regress. With a new test-only event ID, submit a correctly signed event referencing an unmapped provider order: receipt is durable, worker retries/attention stay visible, and no unrelated order changes. Submitting the same event ID with different signed bytes must return conflict rather than replacing history. Razorpay documents duplicate IDs, raw-body verification and non-guaranteed order in [webhook validation](https://razorpay.com/docs/webhooks/validate-test/).

### G09 — Wrong mapping/amount/currency/mode and invalid callback (UNVERIFIED)

Copy the browser's verify request and change one signature character: expect 403 and no state transition. Use another Test payment/order ID with the original signature: reject it. Never accept a customer-supplied amount. In an isolated SQL transaction, exercise `apply_verified_payment` with a real order's provider reference and a deliberately wrong amount or currency; verify `fulfillment_status='held'`, `attention_reason='PAYMENT_MISMATCH'`, and unchanged stock/captured amount, then **ROLLBACK**. A template for the trusted SQL editor is:

```sql
begin;
select public.apply_verified_payment('ORDER_UUID',
  jsonb_build_object('id','REAL_TEST_PAYMENT_ID','order_id','REAL_TEST_PROVIDER_ORDER_ID',
    'amount',1,'currency','INR','status','captured','amount_refunded',0), 'test');
select payment_status,captured_paise,fulfillment_status,attention_reason
  from public.orders where id='ORDER_UUID';
rollback;
```

Repeat with correct amount + `currency='USD'`, then a different provider order ID. Separately use correct identifiers/amount/currency + `p_mode='live'`: expect an immediate `PAYMENT_MISMATCH` SQL exception before any mutation; `ROLLBACK`, then confirm the original order and inventory are unchanged. The mode check does not persist a held state because the transaction is rejected. These are SQL backstop checks, not fabricated provider evidence. Separately verify actual fetched Razorpay identifiers, amounts, currency and server key mode against G05. Do not create a real Live payment to test mismatch.

### G10 — Ambiguous provider creation and lease recovery (UNVERIFIED)

Use a separate test server under a debugger; no production code changes or invented idempotency support are needed. Place a breakpoint in `createPayment()` immediately **after** `adapter.create(...)` returns and **before** `checkout_bind_provider` is called. Start checkout, confirm one Razorpay Test order exists, then terminate this test worker. Restart the same build/config, allow its **60-second operation lease** to expire, and run `jobs 20`. A job claimed by the terminated worker separately has a **300-second job lease**; for that job, wait for its actual `locked_until`, let a worker reclaim it, then wait for the displayed retry `run_after` and invoke again. The expired operation becomes unknown; reconciliation finds the existing provider order by `yb_` plus the store UUID without hyphens and binds it. Dashboard/provider query must show exactly one creation, the same receipt and frozen total. Repeating polling/reconciliation must never issue a second create.

For the no-result case, pause before the POST reaches Razorpay, terminate, restart and reconcile. The order must remain held with `PAYMENT_RECONCILIATION_REQUIRED`; an absent search result is not permission to recreate. Inspect `external_operations.status/attempts/last_error`, `jobs.state/attempts/last_error`, and the operations attention page. Remove debugger/fault injection afterward. If this controlled crash boundary cannot be exercised, leave G10 unverified; a mocked timeout unit test is insufficient.

### G11 — Expiry, cancellation, delayed capture and stock (UNVERIFIED)

Create an unpaid order; leave it for the actual 15-minute reservation lifetime with the scheduler operating. After provider reconciliation proves it clear, expect `order_status='closed'`, released reservations and zero sale movement; run `assert-order ORDER_UUID closed`. Cancel a second unpaid order through the receipt: expect cancelled/released, and repeat cancellation with no additional stock change. For an authorized/uncertain payment, expiry must retain held stock/attention instead of assuming payment failure.

For delayed-capture testing, keep Test Checkout open while its reservation expires. In a dedicated worker, pause reconciliation immediately after the provider's payments fetch returns an empty/created-only list and before `release_reservation`. Temporarily block the browser verify callback and pause webhook processing. Complete the actual Test payment, then resume the worker using that earlier provider result so it releases the expired reservation. Test once while enough stock remains and once after a different buyer legitimately reserves the last unit. Unblock callback/webhook processing and reconcile the actual capture: the noncancelled order may atomically commit only if stock is available; otherwise it records captured money, keeps fulfillment held and `LATE_CAPTURE_REVIEW`, with no oversell. Repeat with explicit cancellation in place of expiry: a cancelled order stays held for review on late capture even if stock exists. Run `assert-order ORDER_UUID held` for an unresolved insufficient-stock case and inspect reservations/movements. For explicit cancellation, inspect the M5 held-to-cancelled transition instead: once the cancellation worker has safely finished, `held` is no longer the required final state. Do not run the helper’s uncaptured `cancelled` assertion on captured funds; use M5 cancellation/refund evidence. Also repeat the late-capture case with callback and webhook delivery still blocked: leave the browser closed and let the scheduler alone discover it. Inspect `orders.next_payment_check_at`: pending/attention orders are due one minute after a check, captured orders after 15 minutes, and closed/cancelled unpaid orders after one hour. Closed/cancelled unpaid orders must remain eligible in `checkout_internal('due')`; wait for their actual due time and prove polling finds the late capture. Restore all blocking/debugging afterward. If the account/Checkout refuses payment after the delay or the race cannot be produced, record the case unverified; a controlled SQL backstop alone is not provider evidence. For current cancellation completion and owner refund actions, follow M5 returns gates 3–10; M5 preserves cancellation intent and never makes that captured order dispatchable merely because payment arrived.

### G12 — Actual Supabase email OTP and protected receipt recovery (UNVERIFIED)

In a fresh private browser, open `/track-order`. Request recovery for an existing order number + its email, then a nonexistent order number with that same email: both request responses must be the same accepted shape/status and neither reveal matching data. A numeric OTP must actually reach the mailbox through Supabase. No `fixtureToken` may appear in Test Mode. Enter a wrong/expired OTP: no grant. Verify a valid email but supply someone else's order number: no access. Enter a fresh valid OTP with the correct order: only that order becomes accessible, `customer_user_id` matches Supabase's verified Auth user and an explicit guest access grant is created. Reload/refresh the Auth session, clear the guest cookie while retaining the verified Auth session, and ensure the owned receipt still resolves. Sign out/clear both, then check denial again. Inspect request rate limiting without exceeding provider test-account limits. Record actual inbox receipt and the negative cases, not just an Auth API 200.

### G13 — Refund reconciliation without restock (UNVERIFIED)

In Razorpay **Test Mode dashboard**, use its supported refund action against the G05 payment: first a partial amount, then the remaining balance. This deliberately tests an external dashboard refund. Also test the current owner-only refund UI through M5 returns gates 3–8; do not treat this external-refund check as coverage of initiation. Let actual refund events and authoritative payment/refund polling reconcile, then inspect `orders.refunded_paise` and payment status (`partially_refunded`, finally `refunded`). Run `assert-order ORDER_UUID partially_refunded` after the partial refund and `assert-order ORDER_UUID refunded` after the full amount. The helper checks that refunded money equals the sum of mapped `provider_refund_observations` in `processed` status; pending/failed observations contribute zero. Verify each stored observation's Razorpay refund ID, payment ID, amount and status against the actual dashboard/API, and verify that fetched provider refunds use INR. The adapter retrieves the complete bounded refund list (100 per page, at most 1,000); a truncated list or conflicting duplicate ID must fail reconciliation instead of being treated as success. Repeat the webhook and replay an older payment event: refunded total never decreases, never exceeds captured, and no restock movement appears solely because money was refunded. A refund merely requested/failed must not mark the order fully refunded. Record provider refund IDs, statuses and unchanged sale/stock counts. Provider availability may prevent a natural failed refund; record that case unverified instead of inventing it.

### G14 — Durable scheduler and notification delivery/failure (UNVERIFIED)

Run the bounded helper (it stops early if no job is claimable):

```sh
node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs jobs 20
```

A no-secret invocation must be 403. Every valid bearer request runs checkout, shipping and returns/refunds workers, each claiming **at most one job**, with a **300-second job lease** (up to three jobs total). Each worker satisfies `done + failed = claimed`; aggregate counts equal their sums, and the helper fails if any job fails. `COUNT` permits 1–100 sequential requests, default 1. A single request does not drain the inbox/outbox, and zero claimed means no job is ready **now**, not that delayed retries or future reconciliation are complete.

Configure a real **external** scheduler to run that bounded command every minute on a test runner that can reach the test app, with its private environment in the scheduler's secret store. An HTTP-only scheduler must make enough sequential `POST APP_URL/api/v1/internal/jobs/run` calls with `Authorization: Bearer JOBS_SECRET` to drain this isolated test workload; one POST handles at most one job per worker, up to three total. Keep the secret out of URLs and browsers. Shut the browser and operator laptop; retain external runner logs plus database timestamps proving pending payments/expiry were processed. Inspect the safe operational rows with the following SQL and increase the bounded worker capacity if the ready backlog grows:

```sql
select id,type,state,attempts,max_attempts,run_after,locked_until,last_error
from public.jobs
where type in ('payment.create','payment.reconcile','notification.send','webhook.process','webhook.reconcile')
  and state <> 'done'
order by run_after,id;
select id,order_status,payment_status,attention_reason,next_payment_check_at
from public.orders where mode='test' order by next_payment_check_at,id;
```

Invoke two helper processes together against the same isolated project and inspect their counts/side effects: no job/effect may be duplicated. Kill a worker after claim, record its `locked_until`, wait past it and run another worker to reclaim. Reclaim schedules a retry with backoff; wait for its actual `run_after`, invoke again, and verify no lost/duplicated money or notifications. The provider-create operation's separate lease is 60 seconds (G10); do not confuse it with the job lease.

For notification failure, first leave email variables absent and capture a new Test payment: receipt/outbox must say `unconfigured`, never sent. Configure the Resend adapter and a verified sender, use a fresh payment to test actual inbox receipt, then run jobs repeatedly: one notification row and one provider message. Use an invalid isolated email key on another fresh order: expect failed/retry with a safe error and no sent claim; restore the key and let retry succeed. To test an ambiguous delivery, stop the worker after Resend responds but before `notificationFinish`, restart within the 23-hour application retry window and rerun: the persisted notification ID is the provider idempotency key. After that window, unresolved sends remain failed/reconciliation-required, not blindly resent. `unconfigured` notifications are intentionally not auto-retried after configuration changes; use a fresh test payment for the configured-delivery gate. Verify the email's order URL alone gives no receipt access in another browser.

## Result record and completion boundary

For every G01–G14 record **PASS / FAIL / UNVERIFIED**, timestamp, operator, exact code version, project reference, test-only order/payment/event IDs and sanitized evidence. Any failure or unavailable account capability remains open. A helper exit code 0 covers only its named assertions; it does not automatically check off the manual gates. Actual Shiprocket behavior, M5 fulfillment/refund initiation, live money, real courier actions and launch readiness remain outside this M4 acceptance run. Keep the current review project in fixture mode until a separate authorized test run is undertaken.
