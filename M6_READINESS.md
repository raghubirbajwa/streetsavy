# M6 — Fixture verification and readiness

Recorded 12 October 2026. Scope: **Q01–Q15**, only as fixture mode permits. The user approved M5, requested prerequisite reruns, and prohibited deployment. `APP_MODE=fixture` remains set in `.env.local` and `.env.example`. **Nothing was deployed; no real payment, refund, shipment or email was sent.** Stop here for review.

A local PASS applies only to the named fixture check. Every account, hosted, content and device gate below remains **BLOCKED** until its own evidence exists. This is not approval for live sales. The original roadmap in `docs/spec/TASKS.md` is unchanged.

## Required reruns before M6

Both were completed and reported before starting M6:

- `npm test`: **112 passed, 0 failed, 0 skipped**.
- `M5_TEST_URL=http://127.0.0.1:3120 npm run test:m5`: **PASS**, including dispatch/private label, failed pickup recovery, protected tracking, return/inspection/restock, owner refund/unknown balance, cancellation and RTO.

Logs: `../../work/m6-prerequisite-npm-test.log` and `../../work/m6-prerequisite-m5-http.log`.

## Changes made for this review

1. Added ten regression tests: three for authorization/catalog/media and six for money, checkout contention, late capture, parcel changes and leased-job recovery, plus one for the current three-worker result contract. Detailed cases and evidence are in [M6_ACCESS_CATALOG_MEDIA.md](M6_ACCESS_CATALOG_MEDIA.md) and [M6_MONEY_OPERATIONS.md](M6_MONEY_OPERATIONS.md).
2. Added `npm run lint`, Next's flat ESLint configuration and locked development dependencies. Fixed component state ownership on query/order/return changes, render-time ref access, cart subscription cleanup, wishlist hydration/storage subscriptions, and stale checkout quote invalidation. Private previews use unoptimized images so authentication stays in the browser request. Saving a media card that leaves the current search clears its dirty marker. These changes still require browser interaction checks below.
3. Updated the historical hosted helper/runbook for three worker counts and current M5 cancellation/refund expectations. The result validator is covered locally; the hosted commands themselves remain BLOCKED. Removed unused declarations and corrected a fragile M1 heading assertion to check protected admin navigation/order links. No SQL migration, provider contract, fee, tax, stock policy or live configuration changed.
4. Added `npm run check:secrets`: a redacted local scan of source and public build text/source maps, known key patterns, privileged JWTs, configured secret values and empty example fields. It checks every dotenv declaration, including duplicate/export assignments. Matching configured values covers `.env.local` and process environment values of at least eight characters. It does not certify entropy, repository history, ignored review files, binary files or hosted secret storage.
5. Prepared [M6_BLOCKED_INPUTS.md](M6_BLOCKED_INPUTS.md), including real-account procedures, content requirements, operational integration gaps and deployment boundaries.

The lint tool is pinned to ESLint 9.39.5 with `eslint-config-next` 16.3.6 because this installed Next/React lint plugin crashes under ESLint 10.12.0. npm labels ESLint 9 unsupported; that is a development-tool maintenance limitation, not a clean bill of health for the toolchain. Upgrade the compatible lint stack before release when available. Lint keeps Next/React/TypeScript rules active, permits deliberately omitted rest fields/underscore interface arguments, and has one documented navigation exception for refreshing the document after order-access/payment cookie changes.

## Q01–Q15 status

| Task | Ready / local evidence | BLOCKED / remaining evidence |
| --- | --- | --- |
| Q01 Authorization | PASS fixture identity, nonadmin/anonymous denial, membership revocation, cross-customer order denial, private media/labels and owner-only refunds. | Actual Supabase Auth/JWT/PostgREST/RLS, real identities and hosted private asset/access boundaries. |
| Q02 Catalog | PASS exact black/S + blue/M counterexample, matching-variant prices/stock filtering and price sorting, public draft exclusion, publication/archive behavior. | Real merchant catalog acceptance and hosted publication. Stock is an availability filter; no separate stock-sort feature is claimed. |
| Q03 Money | PASS integer paise, nonzero inclusive tax/rounding, stale fee quote and quote/order/payment-attempt agreement. | Actual Razorpay Test Mode order/payment comparison and approved business tax/fee settings. |
| Q04 Concurrency | PASS fixture last-unit/multi-tab/duplicate capture/expired-reservation late capture scenarios. | Real PostgreSQL contention across independent connections/workers and actual delayed provider notifications. Serialized PGlite is not hosted concurrency proof. |
| Q05 Payments | PASS simulated failed/authorized/captured, invalid evidence/signature, wrong amount/currency/mode, lost callback, duplicate/reordered events and unavailable/ambiguous providers. | Real Test Mode account, HTTPS Checkout/callback/webhook delivery and actual provider status behavior. |
| Q06 Refunds | PASS reserved partial balances, owner restriction, unknown recovery, duplicate processed settlement and separate once-only inspected restock/cancellation rules. | Actual Test Mode refunds, provider correlation/webhooks, hosted contention, approved return policy and warehouse process. |
| Q07 Shipping | PASS fixture eligibility/PIN/package checks, changed actual parcel/cost with frozen paid total, duplicate booking, AWB/pickup recovery, cancellation fences, stale tracking and conservative RTO. | Separately authorized carrier account, real pickup/parcel details, real booking/label/cost/physical pickup/cancellation/RTO. `APP_MODE=test` still simulates shipping. |
| Q08 Media | PASS invalid/oversized/incomplete uploads, revoked access, draft privacy, failed publication, referenced deletion denial and bounded cleanup with failure retry. | Real R2 signing/CORS/private-public isolation, delivery domain, hosted decoding runtime and scheduled cleanup. |
| Q09 Browser journey | Supporting HTTP workflows PASS; they exercise local admin, storefront, checkout, fulfillment, returns and error states. | **BLOCKED**, including local browser clicks. Browser-control permissions were pending at the previous review and have not been confirmed granted. No end-to-end browser journey is claimed. |
| Q10 UX | State/ref issues identified by lint were fixed. HTTP renders and image responses are covered. | **BLOCKED** desktop/mobile, long titles, keyboard/focus, reduced motion, contrast, 200% zoom, hydration/console and interactive dead-link inspection. Final client content/devices are also unavailable. |
| Q11 Engineering | Final local lint, tests, migrations, production build, typecheck, route HTTP and scoped secret scan: see command record below. | Hosted runtime/build/secret checks and untested browser/provider behavior. Lint dependency maintenance noted above remains before release. |
| Q12 Operations | PASS local durable dedupe/leases, expired-token fencing, dead-job retry, worker partition, missed-capture recovery and no replay of an ambiguous carrier POST. | **BLOCKED** real off-laptop scheduler, multi-worker recovery, shared rate limiter, scheduled media cleanup and monitoring/alerts. Shared throttling, cleanup scheduling and monitoring need integration work, not just credentials. |
| Q13 Content | Required input checklist prepared. | **BLOCKED** approved brand/assets/licenses, real catalog/size guides/stock/weights, warehouse/packaging, tax/fees, policies and support. Demo data is not acceptance evidence. |
| Q14 Infrastructure | Existing hosted runbooks and remaining implementation needs documented. | **BLOCKED** host/runtime/domain/HTTPS, separate real environments, R2, inbox deliverability, backup restore, retention, operations ownership and rollback rehearsal. |
| Q15 Deployment | Review handoff prepared. | **BLOCKED** by the explicit no-deployment instruction and outstanding readiness gates. No deployment or live smoke test attempted. |

## Command record

Run from the project root. Final results are recorded only after successful exit; no provider or browser pass is inferred from these commands.

| Actual command | Result | Workspace log |
| --- | --- | --- |
| `node scripts/test-m4-hosted.mjs --help` and `node --check scripts/test-m4-hosted.mjs` | PASS locally; no hosted request made | `../../work/m6-hosted-helper-help.log` / console |
| `npm run check:env` | PASS: fixture, local URL; both env files retain fixture mode | Console record |
| `npm test` after M6 fixes | **PASS: 122/122, 0 failures/skips** | `../../work/m6-final-npm-test.log` |
| `npm run test:db` | PASS: all migrations, SQL assertions, owner recovery, types and 16-product public projection | `../../work/m6-database.log` |
| `npm run lint` | PASS: 0 errors, 0 warnings | `../../work/m6-final-lint.log` |
| `npm run build` | PASS: optimized production Webpack build and generated route checks | `../../work/m6-final-build.log` |
| `npm run typecheck` after build | PASS | `../../work/m6-final-typecheck.log` |
| `npm run check:secrets` after build | PASS: no findings in the scoped source/public-build scan | `../../work/m6-final-secrets.log` |
| `npm run test:http` | PASS: session/access/Origin/cookie/response boundaries | `../../work/m6-final-auth-http.log` |
| `npm run test:m2` | PASS: admin/catalog/settings/content and real local PNG validation/publication | `../../work/m6-final-admin-media-http.log` |
| `M3_TEST_URL=http://127.0.0.1:3122 node scripts/test-m3-http.mjs` | PASS: storefront routes, 404s, metadata, images and cart isolation/versioning | `../../work/m6-final-storefront-http.log` |
| `M4_TEST_URL=http://127.0.0.1:3122 npm run test:m4` | PASS: quote/session/payment/recovery/cancellation and workers | `../../work/m6-final-checkout-http.log` |
| `M5_TEST_URL=http://127.0.0.1:3122 npm run test:m5` | PASS: dispatch/tracking/returns/refunds/cancellation/RTO and admin rendering | `../../work/m6-final-m5-http.log` |

The earlier checkout smoke at 3120 failed its aggregate zero-failed-job assertion because M5 intentionally left failed shipping-operation history in that database. It passed on a new checkout-only fixture at 3121; the final sequence uses checkout before M5 on another fresh database. The assertion was retained. The first combined M6 build/test caught an overbroad `const` cleanup in checkout reconciliation; the required mutable binding was restored before the final rerun. Initial failures are retained in `../../work/m6-checkout-http.log`, `m6-build-first-attempt.log` and `m6-npm-test-first-attempt.log`; they are not counted as passes.

## Repeat local checks

Use Node 22.16+ (this review used Node 24.20.0/npm 11.19.0). Keep provider credentials unset. `npm run test:http` and `npm run test:m2` start/stop their own isolated servers on 3108/3110. Production build and typecheck should run sequentially because Next generates route types.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:env
npm run lint
npm test
npm run test:db
npm run build
npm run typecheck
npm run check:secrets
npm run test:http
npm run test:m2
```

For the ordered M3–M5 HTTP checks, choose a **new** local fixture directory and use one application process per database. In a dedicated terminal:

```sh
export APP_MODE=fixture
export APP_URL=http://127.0.0.1:3122
export FIXTURE_AUTH_DIR="$PWD/.fixture/m6-review"
export FIXTURE_DB_DIR="$FIXTURE_AUTH_DIR/database"
export FIXTURE_MEDIA_DIR="$FIXTURE_AUTH_DIR/media"
npm run prepare:m5
npm run start -- --port 3122
```

In a second terminal, from the project root:

```sh
M3_TEST_URL=http://127.0.0.1:3122 node scripts/test-m3-http.mjs
M4_TEST_URL=http://127.0.0.1:3122 npm run test:m4
M5_TEST_URL=http://127.0.0.1:3122 npm run test:m5
```

The fixture preparation adds a labelled sample warehouse/parcel, zero sample tax and 14-day sample return policy. It is only for local review. The scripts create sample orders and leave their IDs in the output. Do not run preparation or demo seeds against the real test project. The actual review used `../../work/m6-final-review` outside the distributable project.

## Local review records

Final fixture preview: `http://127.0.0.1:3122`. Choose a fixture identity at `/admin/login`. These sample records were created by the final M5 HTTP check:

- Delivered and refunded order: `/admin/orders/721d6d0b-0e0b-492d-afeb-73684b69fb1a`
- Inspected/restocked return: `/admin/returns/e9e1e33e-2c23-4985-82d3-1a898add5259`
- Cancelled order: `/admin/orders/b90399be-379a-4a23-97c2-f8659eda1f5e`
- Inspected/refunded RTO: `/admin/orders/f0a280aa-173d-40f6-a0f1-eac4a85833e1`

## How to unblock browser checks

Grant the existing browser-control macOS Accessibility/Screen Recording permissions or perform the checks manually and supply results. Keep the local app in fixture mode. Record browser/version, viewport, date, exact steps and outcomes; screenshots alone do not prove keyboard/hydration behavior.

1. Q09: use Demo staff/owner to create/upload/publish a product; as customer find it through filters, choose its actual variant, add it, review checkout and simulate capture. As staff pack/book/assign label, simulate failed pickup then retry, and simulate delivery. From the protected customer receipt track it and request a return. As staff receive/inspect/restock once; as owner refund. Confirm denied anonymous/customer/staff-only actions. Also try unavailable stock, expired quote, failed/authorized/timeout payment and pending refund. HTTP evidence above is support only.
2. Q10: repeat main storefront/admin/order flows at 320, 390, 768 and 1440 CSS-pixel widths; check overflow, long titles and final media. Use keyboard alone through filters, quick-add/cart, checkout and admin forms; verify visible focus, dialog trapping, Escape and return focus. Test Back/Reset filters, saved items after reload/another tab/storage denial, and media metadata saves that change the active search result.
3. Q10: enable reduced motion; inspect text/control/focus contrast; use 200% zoom. Inspect console and hydration errors, failed resource/network requests, images/video and all navigation/form destinations. Repeat on actual supported mobile/desktop browsers with final approved content. Unsupported/unrun devices remain BLOCKED.

## What is needed next

See [M6_BLOCKED_INPUTS.md](M6_BLOCKED_INPUTS.md) for one detailed handoff: sanitized M4/M5 real-account results; approved content/data; infrastructure and operations choices/evidence; browser verification; and separate future deployment authorization. Credentials should stay in private environment/host storage, not in chat or committed files. Use M4 for hosted setup/payment checks, with the M5 shipping/returns runbooks for current cancellation/refund states and the updated three-worker job counts; all their outstanding “unverified” gates are **BLOCKED** for this review.

**M6 fixture work stops for review. Hosted acceptance, browser acceptance and launch readiness remain blocked.**
