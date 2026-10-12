# M6 money, fulfillment and worker evidence

Recorded 12 October 2026. Scope: Q03–Q07 and Q12. All new checks use fresh in-memory fixture databases. No real accounts, external requests, deployment, payment, refund, shipment or email delivery were used. No application or domain SQL changes were needed for the six added checks.

## Focused verification

```sh
node --experimental-strip-types --conditions=react-server --test tests/m6-money-operations.test.ts
```

Result: **6 tests passed, 0 failed, 0 skipped** (5.38 seconds). The temporary 5% tax and flat shipping amounts are arithmetic inputs in an in-memory test database, not approved business settings. The project remains in fixture mode.

| Task | Ready in fixture mode | Still BLOCKED |
| --- | --- | --- |
| Q03 Money | New test proves nonzero inclusive tax is counted inside integer paise totals, including rounding of item and shipping portions. Quote, checkout session, saved order and payment attempt agree exactly. A changed shipping fee invalidates the prior quote. Existing validation rejects injected totals and noninteger monetary provider responses. | Actual Razorpay order/payment totals must be compared with a captured Test Mode payment. Client tax and shipping settings require approval. This is arithmetic evidence, not tax advice or certification. |
| Q04 Concurrency | New tests send simultaneous checkout starts with different keys for one cart: one order/payment/reservation succeeds. An expired last-unit reservation is released, another buyer purchases it, and the delayed duplicate capture stays held with no extra stock deduction. Existing checks cover competing last-unit reservations, duplicate captures and authorization retaining reserved stock. | Separate hosted PostgreSQL connections, multiple app workers and actual delayed provider notifications. PGlite serializes database execution; local simultaneous promises do not prove production locking under contention. |
| Q05 Payments | New test rejects wrong-mode evidence and holds wrong-currency capture without allocating stock. Existing checks cover created/failed/authorized/captured states, raw signature bytes, wrong amount/order, lost callback recovery, duplicate/out-of-order events, multiple captures, provider outages and ambiguous create without a second POST. | Real Test Mode signature, webhook delivery, credentials, account behavior and provider status transitions. Injected transports and fixture controls are not an account compatibility test. |
| Q06 Refunds | Existing `returns.test.ts`, `refunds-provider.test.ts` and `fulfillment-admin.test.ts` cover concurrent partial reservation limits, external pending amounts, unknown response reconciliation, duplicate processed observations, owner-only refunds, received/inspected sellable quantity limits, once-only restock and conservative RTO resolution. | Real Test Mode partial/full refunds, pending-to-processed transitions, provider correlation after response loss, duplicate provider deliveries and hosted concurrency. Real return policy and warehouse receipt/inspection procedures also need client approval. |
| Q07 Shipping | New test changes actual parcel weight/dimensions, verifies higher simulated carrier cost while paid customer total stays frozen, rejects a stale warehouse quote, then books the exact new parcel. Existing tests cover unserviceable PIN, unsupported packaging, duplicate booking, AWB preservation after failed pickup, unknown create reconciliation, cancellation fences, private labels, old tracking events and RTO without automatic restock. | Actual courier serviceability, charged cost, packaging limits, booking/AWB/label/pickup/cancellation, physical pickup races and RTO scans. Test mode still simulates shipping; real carrier checks need separately authorized account use and operational details. |
| Q12 Operations | New test crashes a leased carrier job, verifies it becomes dead, fences the expired job/operation token, records an audited retry, prevents the checkout worker consuming carrier work, and confirms the unknown external operation cannot be replayed. Existing SQL checks cover dedupe, retry budgets, redaction, append-only audit and lease renewal. Existing payment worker tests recover a missed late capture; fixture outbox truthfully remains unsent. | Real external scheduler with the laptop/browser closed, deployed authentication, multiple-worker lease recovery and actionable monitoring for missed webhooks/old pending orders. No scheduler or alert service has been installed or claimed working. |

Existing test coverage was inspected, not described as a new rerun here. Root milestone notes record the actual full-suite and HTTP reruns separately.

## Required inputs and how to clear the blocked gates

1. Provide an isolated Supabase project, real owner/staff/customer test identities and a genuine test catalog. Follow `M4_HOSTED_VERIFICATION.md` for migration, JWT/RLS, exact payment totals and last-unit/multi-tab concurrency checks. Do not import demo records into the hosted test project.
2. Configure Razorpay Test Mode credentials/webhook signing secret securely outside the repository. Execute `M5_RETURNS_VERIFICATION.md` gates 3–8 for concurrent, pending, lost-response and duplicate refunds; record provider IDs, amounts, statuses and redacted results.
3. Supply approved tax/fee settings, actual parcel weights/dimensions, pickup location and return policy. A real courier test requires separate explicit authorization for any charge or physical shipment. Follow `M5_SHIPPING_VERIFICATION.md`; fixture and test-mode carrier results cannot clear these gates.
4. Choose the deployment host and external scheduler/monitoring owner. When deployment is separately authorized, schedule authenticated calls to `/api/v1/internal/jobs/run`, close the development laptop/browser, deliberately interrupt a worker, restore it, and record lease/dead-job recovery, polling of an old pending order, missed-webhook detection and alert delivery. Keep Q12 BLOCKED until that evidence exists.

No deployment or provider action is authorized by this document. It is a verification handoff within the user's fixture-only M6 scope.
