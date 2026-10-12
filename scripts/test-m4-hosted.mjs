// Explicitly invoked hosted acceptance helper. No requests are made for --help.
// It creates unpaid Razorpay TEST orders in `race`; it never submits a payment.
import assert from "node:assert/strict";
import { assertJobResult } from "./assert-job-result.mjs";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const [command = "--help", argument, expected] = process.argv.slice(2);
const commands = ["permissions", "race", "assert-order", "webhook-replay", "jobs"];
if (command === "--help") {
  console.log(`Usage: node --env-file=/absolute/path/m4-test.env scripts/test-m4-hosted.mjs COMMAND [ARGUMENT] [EXPECTED]\nCommands:\n  permissions                     Real anon/nonadmin/owner JWT authorization\n  race                            Two HTTP buyers for a preconfigured last unit; cancels unpaid winner\n  assert-order ORDER_UUID [STATE]  Read-only totals, inventory, capture, refund and outbox checks\n  webhook-replay RAW_JSON_FILE     Signed duplicate and tampered-byte rejection\n  jobs [COUNT]                    1–100 sequential worker requests (default 1), one job per worker (checkout/shipping/refunds)\nStates: pending, authorized, captured, held, cancelled, closed, partially_refunded, refunded.\nRead M4_HOSTED_VERIFICATION.md first. Required opt-in: M4_TEST_ACK=isolated-supabase-razorpay-test.\nNo command proves an actual payment or email delivery; those require the manual runbook gates.`);
  process.exit(0);
}
assert.ok(commands.includes(command), "Unknown command; use --help.");
const env = process.env;
function required(key) { assert.ok(env[key], `Missing ${key}`); return env[key]; }
assert.equal(env.APP_MODE, "test", "Hosted checks require APP_MODE=test.");
assert.equal(env.M4_TEST_ACK, "isolated-supabase-razorpay-test", "Explicit isolated test-project opt-in is required.");
assert.match(required("RAZORPAY_KEY_ID"), /^rzp_test_[A-Za-z0-9]+$/, "Only Razorpay Test Mode keys are accepted.");
const origin = new URL(required("APP_URL"));
assert.ok(["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash, "APP_URL must be an origin.");
const supabaseUrl = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
assert.equal(supabaseUrl.protocol, "https:", "A hosted Supabase project is required.");
assert.equal(supabaseUrl.hostname, `${required("M4_EXPECT_SUPABASE_REF")}.supabase.co`, "Supabase project reference does not match the explicit target.");
assert.ok(!supabaseUrl.username && !supabaseUrl.password && !supabaseUrl.port && supabaseUrl.pathname === "/" && !supabaseUrl.search && !supabaseUrl.hash, "Supabase URL must be the project's HTTPS origin.");
const jobRuns = command === "jobs" ? Number(argument ?? "1") : 1;
assert.ok(Number.isInteger(jobRuns) && jobRuns >= 1 && jobRuns <= 100, "jobs COUNT must be an integer from 1 to 100.");
if (command === "assert-order") assert.ok(expected === undefined || ["pending", "authorized", "captured", "held", "cancelled", "closed", "partially_refunded", "refunded"].includes(expected), "Unknown expected state.");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const publicKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const service = createClient(supabaseUrl.origin, required("SUPABASE_SECRET_KEY"), options);
const anonymous = () => createClient(supabaseUrl.origin, publicKey, options);
const uuid = (value) => { assert.match(value ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Expected an order/variant UUID."); return value; };
const safeError = (result, label) => { assert.equal(result.error?.code ?? null, null, `${label} failed (${result.error?.code ?? "unknown"}); inspect private service logs.`); return result.data; };
async function rows(table, select, column, value) {
  let query = service.from(table).select(select);
  if (column) query = query.eq(column, value);
  return safeError(await query.limit(1000), `Read ${table}`);
}
// Refuse mixed/live order data before mutating anything. A fresh dedicated project is expected.
const live = await service.from("orders").select("id", { count: "exact", head: true }).eq("mode", "live");
safeError(live, "Check project mode");
assert.equal(live.count, 0, "Target project contains live orders; refusing hosted test harness.");

function browser() { return { cookies: new Map() }; }
async function http(jar, path, { method = "GET", body, headers = {}, raw } = {}) {
  const cookie = [...jar.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(new URL(path, origin), {
    method, headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0]; const at = pair.indexOf("=");
    jar.cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  let json = null; try { json = await response.json(); } catch { /* Explicit assertion below, without leaking response bodies. */ }
  return { status: response.status, json, headers: response.headers };
}
function accepted(result, statuses, label) {
  assert.ok(statuses.includes(result.status), `${label}: HTTP ${result.status}, code ${result.json?.error?.code ?? "unknown"}`);
  assert.ok(result.json && "data" in result.json, `${label}: missing data envelope`);
  return result.json.data;
}
async function runJobs() {
  const result = await http(browser(), "/api/v1/internal/jobs/run", { method: "POST", headers: { Authorization: `Bearer ${required("JOBS_SECRET")}` } });
  const data = accepted(result, [200], "Scheduler");
  assertJobResult(data);
  console.log(JSON.stringify({ check: "jobs", ...data }));
  assert.equal(data.failed, 0, "Worker reported a failed job; inspect /admin/operations and jobs.last_error before retrying.");
  return data;
}
async function assertOrder(id, state) {
  const [order] = await rows("orders", "id,mode,fixture,order_status,payment_status,fulfillment_status,attention_reason,items_payable_paise,shipping_fee_paise,total_paise,captured_paise,refunded_paise", "id", uuid(id));
  assert.ok(order, "Order missing in expected Supabase project; check application configuration.");
  assert.equal(order.mode, "test"); assert.equal(order.fixture, false);
  const items = await rows("order_items", "variant_id,quantity,unit_price_paise,line_payable_paise", "order_id", id);
  assert.ok(items.length > 0 && items.length < 1000, "Order item result must be nonempty and untruncated.");
  let subtotal = 0n;
  for (const item of items) { assert.equal(BigInt(item.line_payable_paise), BigInt(item.quantity) * BigInt(item.unit_price_paise)); subtotal += BigInt(item.line_payable_paise); }
  assert.equal(BigInt(order.items_payable_paise), subtotal);
  assert.equal(BigInt(order.total_paise), subtotal + BigInt(order.shipping_fee_paise), "Inclusive tax must not be added twice.");
  assert.ok(BigInt(order.refunded_paise) <= BigInt(order.captured_paise));
  const reservations = await rows("inventory_reservations", "variant_id,quantity,status", "order_id", id);
  assert.equal(reservations.length, items.length);
  for (const reservation of reservations) {
    const [inventory] = await rows("inventory", "on_hand,reserved", "variant_id", reservation.variant_id);
    const held = safeError(await service.from("inventory_reservations").select("quantity").eq("variant_id", reservation.variant_id).eq("status", "held").limit(1000), "Read held stock");
    assert.ok(held.length < 1000, "Held-stock result truncated; inspect in SQL.");
    assert.ok(inventory.on_hand >= 0 && inventory.reserved >= 0 && inventory.reserved <= inventory.on_hand);
    assert.equal(inventory.reserved, held.reduce((sum, row) => sum + row.quantity, 0), "Inventory reserved must equal all held reservation quantities.");
  }
  const movements = await rows("inventory_movements", "variant_id,kind,on_hand_delta,operation_key", "order_id", id);
  const sales = movements.filter((row) => row.kind === "sale");
  assert.equal(new Set(sales.map((row) => row.variant_id)).size, sales.length, "Duplicate inventory deduction.");
  const notifications = await rows("notifications", "id,type,status,dedupe_key", "order_id", id);
  const attempts = await rows("payment_attempts", "id,provider_order_id,provider_payment_id,status", "order_id", id);
  assert.equal(attempts.length, 1, "One local attempt record per checkout is expected.");
  const refunds = await rows("provider_refund_observations", "mode,provider_refund_id,provider_payment_id,amount_paise,status", "order_id", id);
  assert.ok(refunds.length < 1000, "Refund observations truncated; inspect in SQL.");
  let processedRefunds = 0n;
  for (const refund of refunds) {
    assert.equal(refund.mode, "test"); assert.equal(refund.provider_payment_id, attempts[0].provider_payment_id);
    assert.ok(BigInt(refund.amount_paise) > 0n && BigInt(refund.amount_paise) <= BigInt(order.captured_paise));
    if (refund.status === "processed") processedRefunds += BigInt(refund.amount_paise);
  }
  assert.equal(BigInt(order.refunded_paise), processedRefunds, "Only mapped processed refund observations contribute to refunded money.");
  if (Number(order.captured_paise) > 0) {
    assert.equal(BigInt(order.captured_paise), BigInt(order.total_paise));
    assert.equal(notifications.filter((n) => n.type === "payment_received").length, 1, "Exactly one payment outbox entry.");
    if (order.fulfillment_status === "ready") assert.equal(sales.length, items.length);
  } else assert.equal(sales.length, 0, "Uncaptured order must not deduct inventory.");
  for (const sale of sales) assert.equal(sale.on_hand_delta, -items.find((item) => item.variant_id === sale.variant_id).quantity);
  if (state === "captured") { assert.equal(order.payment_status, "captured"); assert.equal(order.fulfillment_status, "ready"); }
  else if (state === "authorized") { assert.equal(order.payment_status, "authorized"); assert.equal(Number(order.captured_paise), 0); assert.ok(reservations.every((r) => r.status === "held")); }
  else if (state === "held") assert.equal(order.fulfillment_status, "held");
  else if (state === "cancelled" || state === "closed") { assert.equal(order.order_status, state); assert.equal(Number(order.captured_paise), 0); assert.ok(reservations.every((r) => r.status === "released")); }
  else if (state === "refunded") { assert.equal(order.payment_status, "refunded"); assert.equal(BigInt(order.refunded_paise), BigInt(order.captured_paise)); }
  else if (state === "partially_refunded") { assert.equal(order.payment_status, "partially_refunded"); assert.ok(BigInt(order.refunded_paise) > 0n && BigInt(order.refunded_paise) < BigInt(order.captured_paise)); }
  else if (state === "pending") assert.equal(order.order_status, "pending_payment");
  else assert.ok(state === undefined, "Unknown expected state.");
  if (state === "refunded" || state === "partially_refunded") assert.ok(movements.every((movement) => movement.on_hand_delta <= 0), "M4 refund reconciliation must not restock inventory.");
  console.log(JSON.stringify({ check: "order", orderId: id, orderStatus: order.order_status, paymentStatus: order.payment_status, fulfillmentStatus: order.fulfillment_status, attentionReason: order.attention_reason, saleMovements: sales.length, notifications: notifications.map(({ status }) => status) }));
  return order;
}

if (command === "permissions") {
  const anon = anonymous();
  assert.ok(safeError(await anon.rpc("public_catalog"), "Public catalog"));
  assert.equal((await anon.from("orders").select("id").limit(1)).error?.code, "42501", "Anon base-order read must be denied.");
  const privateRpcs = [
    ["reserve_checkout", { p_token_hash: null, p_quote_id: null, p_key: null, p_mode: null }],
    ["apply_verified_payment", { p_order_id: null, p_payment: null, p_mode: null }],
    ["checkout_internal", { p_action: "due" }],
    ["checkout_receipt", { p_order_id: null, p_token_hash: null }],
    ["checkout_recover", { p_order_number: "missing", p_email: "missing@example.invalid", p_token_hash: null }],
  ];
  for (const role of ["ANON", "NONADMIN", "OWNER"]) {
    const client = role === "ANON" ? anon : anonymous();
    if (role !== "ANON") {
      safeError(await client.auth.signInWithPassword({ email: required(`M4_${role}_EMAIL`), password: required(`M4_${role}_PASSWORD`) }), `${role} sign-in`);
      assert.equal(safeError(await client.rpc("has_admin_role"), `${role} membership`), role === "OWNER");
    }
    for (const [name, args] of privateRpcs) assert.equal((await client.rpc(name, args)).error?.code, "42501", `${role} must not execute ${name}.`);
    if (role === "NONADMIN") assert.deepEqual(safeError(await client.from("orders").select("id").limit(1), "Nonadmin RLS"), [], "Use a nonadmin who owns no test orders.");
    if (role === "OWNER") assert.equal(safeError(await client.rpc("has_admin_role", { required_role: "owner" }), "Owner role"), true);
    if (role !== "ANON") await client.auth.signOut({ scope: "local" });
  }
  const denied = await http(browser(), "/api/v1/admin/products");
  assert.ok([401, 403].includes(denied.status), "Unauthenticated admin API must be denied.");
  console.log("PASS hosted public projection, anon/nonadmin/owner private-RPC denial, RLS and unauthenticated admin route.");
} else if (command === "jobs") {
  const denied = await http(browser(), "/api/v1/internal/jobs/run", { method: "POST" });
  assert.equal(denied.status, 403, "Scheduler without its secret must be denied.");
  for (let index = 0; index < jobRuns; index++) if ((await runJobs()).claimed === 0) break;
} else if (command === "assert-order") {
  await assertOrder(argument, expected);
} else if (command === "webhook-replay") {
  assert.ok(argument, "Supply a private file containing the exact JSON body.");
  const raw = await readFile(argument); assert.ok(raw.length > 0 && raw.length <= 262144, "Payload exceeds webhook limit.");
  JSON.parse(raw.toString("utf8"));
  const eventId = required("M4_WEBHOOK_EVENT_ID");
  assert.match(eventId, /^[A-Za-z0-9_.:-]{1,200}$/);
  const signature = createHmac("sha256", required("RAZORPAY_WEBHOOK_SECRET")).update(raw).digest("hex");
  const headers = { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId };
  for (let count = 0; count < 2; count++) accepted(await http(browser(), "/api/v1/webhooks/razorpay", { method: "POST", raw, headers }), [200], "Signed webhook");
  assert.equal((await http(browser(), "/api/v1/webhooks/razorpay", { method: "POST", raw: Buffer.concat([raw, Buffer.from(" ")]), headers })).status, 403, "Changed raw bytes with original signature must fail.");
  const events = safeError(await service.from("webhook_events").select("id,verification_result").eq("provider", "razorpay").eq("environment", "test").eq("dedupe_key", `event:${eventId}`), "Webhook inbox");
  assert.equal(events.length, 1); assert.equal(events[0].verification_result, "verified");
  await runJobs();
  console.log("PASS exact-byte signature validation, duplicate inbox identity and tampered-byte rejection; assert-order separately checks convergence.");
} else if (command === "race") {
  const variant = uuid(required("M4_TEST_VARIANT_ID"));
  const [inventory] = await rows("inventory", "on_hand,reserved", "variant_id", variant);
  assert.deepEqual(inventory, { on_hand: 1, reserved: 0 }, "Prepare a dedicated variant with exactly one on-hand and zero reserved; harness never changes stock directly.");
  const address = JSON.parse(await readFile(required("M4_TEST_ADDRESS_FILE"), "utf8"));
  const buyers = [browser(), browser()]; const quotes = []; const alternateQuotes = [];
  for (const buyer of buyers) {
    const cart = accepted(await http(buyer, "/api/v1/cart", { method: "POST" }), [200], "Create guest");
    const added = accepted(await http(buyer, "/api/v1/cart/items", { method: "POST", body: { variantId: variant, quantity: 1, cartVersion: cart.version } }), [200], "Add last unit");
    quotes.push(accepted(await http(buyer, "/api/v1/checkout/quote", { method: "POST", body: { cartVersion: added.version, address } }), [200], "Quote"));
    alternateQuotes.push(accepted(await http(buyer, "/api/v1/checkout/quote", { method: "POST", body: { cartVersion: added.version, address } }), [200], "Alternate quote for idempotency conflict"));
  }
  assert.ok(quotes.every((quote) => quote.fixture === false), "Target application is still in fixture mode.");
  for (const quote of quotes) {
    const [stored] = await rows("shipping_quotes", "id,total_paise,currency,status", "id", quote.quoteId);
    assert.ok(stored, "App quote is absent from the expected Supabase project; refusing to reserve stock.");
    assert.equal(stored.total_paise, quote.totalPaise); assert.equal(stored.currency, "INR"); assert.equal(stored.status, "ready");
  }
  const keys = buyers.map(() => `hosted-${randomUUID()}`);
  console.log(JSON.stringify({ check: "race-quotes", quoteIds: quotes.map((quote) => quote.quoteId) }));
  const sessions = await Promise.all(buyers.map((buyer, index) => http(buyer, "/api/v1/checkout/sessions", { method: "POST", body: { quoteId: quotes[index].quoteId }, headers: { "Idempotency-Key": keys[index] } })));
  const reserved = sessions.flatMap((result, buyerIndex) => {
    const value = result.json?.data;
    return [201, 202].includes(result.status) && typeof value?.orderId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.orderId) ? [{ buyerIndex, session: value }] : [];
  });
  for (const { session } of reserved) console.log(JSON.stringify({ check: "race-reserved", orderId: session.orderId }));
  try {
    assert.equal(reserved.length, 1, "Exactly one buyer must reserve the last unit; any returned test orders are reported and cleaned up below.");
    const { buyerIndex: winner, session } = reserved[0];
    assert.equal(sessions[1 - winner].status, 409); assert.equal(sessions[1 - winner].json?.error?.code, "STOCK_CONFLICT");
    assert.equal(session.fixture, false); if (session.keyId) assert.match(session.keyId, /^rzp_test_/);
    const replays = await Promise.all([0, 1].map(() => http(buyers[winner], "/api/v1/checkout/sessions", { method: "POST", body: { quoteId: quotes[winner].quoteId }, headers: { "Idempotency-Key": keys[winner] } })));
    for (const result of replays) assert.equal(accepted(result, [201, 202], "Same-key replay").orderId, session.orderId);
    const stranger = await http(buyers[1 - winner], `/api/v1/orders/${session.orderId}`);
    assert.equal(stranger.status, 404, "Order UUID alone must not grant access.");
    const operation = await http(buyers[1 - winner], `/api/v1/operations/${session.operationId}`);
    assert.equal(operation.status, 404, "Operation UUID alone must not grant access.");
    const altered = await http(buyers[winner], "/api/v1/checkout/sessions", { method: "POST", body: { quoteId: alternateQuotes[winner].quoteId }, headers: { "Idempotency-Key": keys[winner] } });
    assert.equal(altered.status, 409); assert.equal(altered.json?.error?.code, "IDEMPOTENCY_CONFLICT", "Same key cannot adopt a different quote.");
    await assertOrder(session.orderId, "pending");
    assert.deepEqual((await rows("inventory", "on_hand,reserved", "variant_id", variant))[0], { on_hand: 1, reserved: 1 });
    console.log("PASS separate HTTP buyers, last-unit serialization, concurrent same-key replay and guest ownership.");
  } finally {
    const unresolved = [];
    for (const { buyerIndex, session } of reserved) {
      try {
        const [stored] = await rows("orders", "mode,fixture,captured_paise", "id", session.orderId);
        assert.ok(stored && stored.mode === "test" && stored.fixture === false && Number(stored.captured_paise) === 0, "Cleanup requires an uncaptured test order in the expected project.");
        const result = await http(buyers[buyerIndex], `/api/v1/orders/${session.orderId}/cancel`, { method: "POST", body: { reason: "Hosted acceptance: release unpaid last-unit test" } });
        const receipt = accepted(result, [200], "Unpaid test cancellation");
        assert.equal(receipt.orderStatus, "cancelled", "Unpaid cancellation is unresolved.");
        await assertOrder(session.orderId, "cancelled");
      } catch { unresolved.push(session.orderId); }
    }
    if (unresolved.length) throw new Error(`Test order cleanup needs review: ${unresolved.join(", ")}. Do not reset inventory manually; inspect /admin/operations and reconcile.`);
    assert.deepEqual((await rows("inventory", "on_hand,reserved", "variant_id", variant))[0], { on_hand: 1, reserved: 0 });
  }
}
