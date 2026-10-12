# M4 — Checkout, reservations and payment verification

Review date: 30 September 2026. Authorized scope: T26–T34, after M3 approval. `APP_MODE=fixture` remains unchanged in both environment files. No hosted payment, email, shipment or deployment was performed. Stop here for review before M5.

## Implementation and evidence

| Task | Implemented behavior | Local evidence and remaining boundary |
| --- | --- | --- |
| T26 | Strict Indian address validation; compatible active one-parcel selection; shipping quote adapter; separate customer fee and private courier cost. Fixture/test shipping is deterministic; live quote code uses Shiprocket serviceability. | HTTP checks reject invalid and unserviceable PINs and simulate outages. Real Shiprocket serviceability is unverified; Test Mode does not call Shiprocket. |
| T27 | Immutable 10-minute quote with cart/catalog/config snapshots, integer paise, line-rounded included taxes, configurable delivery fee and explicit customer review. Address/cart changes require a new quote. | SQL/HTTP reject stale quotes, price/cart changes and injected totals. Tax is included, not added twice. Hosted nonzero/multiline tax and fee checks: G03. |
| T28 | One atomic transaction creates order/items, held stock, payment attempt, operation and job. Scoped idempotency key prevents duplicate creation; one unresolved checkout per cart. Stable stock locking and final availability checks. | Local competing last-unit and replay assertions pass. PGlite serializes local execution; true concurrent Postgres connections remain G04. |
| T29 | Razorpay Test/Live adapters, server-generated receipt, durable create lease, existing-order lookup after ambiguous creation, Checkout window and operation polling. Retry resumes the same order. Fixture simulation cannot load or call Razorpay. | Fixture failed/retry, authorization, close/reopen and unknown-create recovery tests pass. Actual Test Checkout/order creation and controlled crash: G05–G06/G10. |
| T30 | Callback HMAC uses stored provider order ID; server fetch validates mapping, amount, INR and mode. Authorization never confirms payment. Captured money, reservations, sale movements and cart clearing apply once. | Raw-signature, wrong amount, duplicate capture and historical failure tests pass. Real callback and capture proof: G05/G09. |
| T31 | Raw-byte verified, deduplicated webhook inbox; authoritative payment/refund reconciliation; multiple captured payment observations recorded atomically before a mismatch hold. Processed refund totals are monotonic and never restock inventory. | Provider pagination/refund mapping and out-of-order/duplicate/mismatch regression tests pass. Actual provider deliveries, replay and refund evidence: G07–G09/G13. |
| T32 | Expiry/cancellation reconciles first. Authorized/uncertain funds retain stock or an explicit hold. Late capture records funds and either safely reacquires stock or holds for review; cancelled orders stay held. Closed/cancelled unpaid orders continue periodic reconciliation. | Local last-unit, expiry, late capture, lost webhook and stronger-hold preservation tests pass. Hosted delayed-capture races and scheduler: G11/G14. |
| T33 | Private no-store/noindex receipt; owning guest capability or verified user only. Uniform recovery requests use Supabase email OTP outside fixture mode. Fixture codes are cookie-bound, expiring development simulations. | HTTP checks reject unrelated sessions and wrong/replayed fixture codes; successful recovery grants only the order. Real inbox and Auth session refresh: G01–G02/G12. |
| T34 | Capture and notification outbox enqueue share a transaction. Configured Resend adapter uses a persisted idempotency key and bounded retry window. Fixture/unconfigured/failed outcomes are explicit; provider acceptance is not claimed as delivery. | One outbox row, durable job drain and fixture `unconfigured` outcome verified. Real inbox, retry/ambiguous delivery and scheduler: G14. |

The narrow `/admin/operations` review page shows recent payment states, held orders, uncertain creations, failed jobs and email outcomes. It does not initiate refunds, ship orders or resolve holds. Those actions belong to M5.

## Files and local setup

The checkout migration is `supabase/migrations/202609280001_checkout.sql`; generated database types are updated. Contracts, orchestration, providers and HTTP boundaries are under `src/lib/checkout/`. Store checkout/receipt/recovery pages use `src/components/store/checkout-client.tsx`. Routes include checkout quotes/sessions, protected receipts/operations, verification/recovery, the Razorpay webhook and the authenticated worker. The fixture database RPC adapter now returns scalar, composite and set-returning results in PostgREST-compatible shapes.

Explicit fixture setup is `scripts/prepare-m4-fixture.ts` using `src/data/fixtures/checkout-seed.ts`. It adds labelled sample pickup/parcel data and zero sample tax only when configuration is absent. It preserves existing settings and refuses other app modes. Run with the server stopped; one process may use a given PGlite directory.

The current isolated review preview is `http://127.0.0.1:3115`. Its database, auth and media directories are under `../../work/m4-review/`; earlier milestone data is preserved. To recreate/start it from this project:

```sh
APP_MODE=fixture APP_URL=http://127.0.0.1:3115 \
  FIXTURE_DB_DIR=../../work/m4-review/database npm run prepare:m4
npm run build
APP_MODE=fixture APP_URL=http://127.0.0.1:3115 \
  FIXTURE_DB_DIR=../../work/m4-review/database \
  FIXTURE_AUTH_DIR=../../work/m4-review/auth \
  FIXTURE_MEDIA_DIR=../../work/m4-review/media npm start -- --port 3115
```

Use fake address details. PIN `999999` simulates no service; `888888` simulates an outage. The receipt exposes capture, authorization, failure and lost-confirmation simulations. Track order displays a development code and clearly states that no inbox is verified. Payment records remain for review; fixture history is not erased by tests.

## Verified commands

- `npm run types:db`: all nine migrations, six SQL assertion files, trusted owner setup/recovery and sixteen-product projection parity pass in isolated local PostgreSQL/PGlite. Types regenerated from the schema.
- `npm run typecheck`: passes. Run after the build has finished; running it while Next replaces `.next/types` can cause transient missing generated-file errors.
- `npm test`: **84 passed, 0 failed**, including checkout/provider/reconciliation and existing milestone coverage. No real provider requests.
- `npm run build`: production Webpack build passes. No separate lint script is configured.
- `M4_TEST_URL=http://127.0.0.1:3115 npm run test:m4`: all three fixture HTTP groups pass: quote/reservation/capture/access; retry/reopen/cancel/authorization/lost callback; recovery/outbox. The script creates labelled sample orders in the isolated preview.
- `node --check scripts/test-m4-hosted.mjs`, helper help and six offline refusal cases pass. These validate the harness only; they do not verify hosted services.

Logs are in `../../work/m4-db.log`, `m4-all-tests.log`, `m4-build.log` and `m4-http-tests.log`.

## Browser review

The in-app browser verified product → size → cart → address → quote → pending receipt; lost confirmation followed by explicit reconciliation; cart clearing after capture; recovery using a cookie-bound fixture code; unauthenticated admin redirect and demo-owner payment review. Changing an address clears quote acceptance. Checkout and receipt were inspected at the default desktop size and at 320 pixels, with no horizontal overflow. Keyboard selection/submission worked; no browser error/warning logs were recorded during the reviewed journey.

Screenshots: [checkout desktop](review/m4/checkout-desktop.png), [checkout 320px](review/m4/checkout-320.png), [receipt desktop](review/m4/receipt-desktop.png), [receipt 320px](review/m4/receipt-320.png). All details shown are synthetic fixture data.

## Required hosted verification — all UNVERIFIED

[M4_HOSTED_VERIFICATION.md](M4_HOSTED_VERIFICATION.md) gives the exact setup, commands, manual actions, expected results and evidence for every gate below. Use an isolated real Supabase project and Razorpay **Test Mode** in a separate app copy; do not change this fixture review environment.

1. **G01:** migrations, RLS and grants against real anonymous, customer and admin identities.
2. **G02:** guest receipt/operation ownership, access revocation and sensitive-response caching.
3. **G03:** real SQL quote immutability/expiry, stale configuration, fee rules and nonzero/multiline inclusive-tax reconciliation.
4. **G04:** two independent buyers for the last unit, simultaneous tabs and idempotent retries.
5. **G05:** actual Razorpay Test payment; callback, webhook and polling converge to one capture, sale and notification.
6. **G06:** actual failed/authorized/captured states, browser close and callback loss with same-order recovery.
7. **G07:** lost callback, payment-window dismissal and browser closure with the same saved order.
8. **G08:** exact raw-body webhook HMAC, invalid body/signature rejection, durable receipt and duplicated/out-of-order actual events.
9. **G09:** callback/mapping/amount/currency/mode mismatches and allocation prevention.
10. **G10:** controlled worker crash during provider creation and lease recovery without a duplicate provider order.
11. **G11:** real expiry/cancellation/delayed-capture races, scarce stock and held-order outcomes.
12. **G12:** delivered Supabase email OTP, negative recovery cases, verified identity and refreshed sessions.
13. **G13:** actual partial/full Test refunds, pending/failed distinctions, monotonic processed totals and no automatic restock.
14. **G14:** authenticated external scheduler, multiple workers/crash recovery, actual notification delivery/failure/idempotency and operation with the browser/laptop closed.

`node --env-file="$M4_ENV_FILE" scripts/test-m4-hosted.mjs help` lists guarded helper commands. The runbook explains the environment file and project acknowledgement. A helper success never certifies the manual gates. Fixture tests do **not** satisfy TASKS.md's actual Razorpay payment exit requirement.

## Limits and review boundary

M4 is implemented for fixture review; hosted acceptance is still open. No real Supabase Auth/PostgREST, Razorpay, Shiprocket or Resend result is claimed. Real tax, warehouse/packaging, policies, sender/domain and business content still need approved inputs. Shared deployment rate limiting, monitored external scheduler operation, real database concurrency and operational recovery remain acceptance/launch work. The implementation processes one checkout job per invocation; production scheduling must drain sufficient work, not assume one request per minute handles every order.

M5 dispatch, tracking, return/refund initiation and manual resolution tools have not been started. Await review before continuing.
