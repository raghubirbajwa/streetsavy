import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run only against a local, already-started fixture preview prepared with
// scripts/prepare-m4-fixture.ts. It records labelled sample orders in that DB.
// No provider calls, card data, auth secrets or external server targets are used.
const configured = process.env.M4_TEST_URL;
if (!configured) throw new Error('Set M4_TEST_URL to the prepared fixture preview origin.');
const target = new URL(configured);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'M4 HTTP smoke is restricted to a local fixture server.');
const origin = target.origin;
const request = (path, options = {}) => fetch(new URL(path, origin), { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) });
class BrowserSession {
  cookies = new Map();
  async call(path, { method = 'GET', body, headers = {}, expected = 200, privateResponse = true } = {}) {
    const response = await request(path, { method, headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(this.cookies.size ? { Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const entry of response.headers.getSetCookie()) {
      const first = entry.split(';', 1)[0];
      const separator = first.indexOf('=');
      const name = first.slice(0, separator), value = first.slice(separator + 1);
      if (!value || /max-age=0(?:;|$)/i.test(entry)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    if (privateResponse) assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (/\/(checkout|orders|operations|payments|webhooks|internal)\//.test(path)) assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
    return { data: value.data, body: value, response };
  }
}
const observer = new BrowserSession();
for (const path of ['/checkout', '/track-order', `/orders/${randomUUID()}`]) {
  const response = await request(path); const html = await response.text();
  assert.equal(response.status, 200, path);
  assert.match(html, /name="robots" content="[^"]*noindex/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.doesNotMatch(html, /fixture_order_|razorpay_payment_id/);
  if (path === '/track-order') assert.match(html, /FIXTURE CHECKOUT/, 'Refusing to mutate a nonfixture preview.');
}
const address = { fullName: 'Fixture HTTP Shopper', phone: '+91 90000 00000', email: `m4-${randomUUID()}@example.invalid`, line1: 'Fixture address — do not deliver', line2: 'M4 HTTP verification only', city: 'Bengaluru', stateCode: 'KA', pincode: '560001', country: 'IN' };
const listing = (await observer.call('/api/v1/products?inStock=true')).data;
const variants = [];
for (const card of listing.items.slice(0, 4)) {
  const product = (await observer.call(`/api/v1/products/${card.slug}`)).data;
  variants.push(...product.variants.filter(variant => variant.available));
}
assert.ok(variants.length >= 4, 'Prepare a fresh fixture DB with at least four available variants.');
let selected = 0;
async function shopper() {
  const browser = new BrowserSession();
  const created = await browser.call('/api/v1/cart', { method: 'POST' });
  const cookie = created.response.headers.getSetCookie().find(value => value.startsWith('clothing_guest='));
  assert.ok(cookie); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=lax/i);
  const variant = variants[selected++ % variants.length];
  const cart = (await browser.call('/api/v1/cart/items', { method: 'POST', body: { variantId: variant.id, quantity: 1, cartVersion: created.data.version } })).data;
  return { browser, cart, variant };
}
async function quoteFor(customer, suppliedAddress = address) {
  const quote = (await customer.browser.call('/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: customer.cart.version, address: suppliedAddress } })).data;
  assert.equal(quote.fixture, true); assert.equal(quote.currency, 'INR'); assert.equal(quote.cartVersion, customer.cart.version);
  assert.equal(quote.itemsPayablePaise, customer.cart.subtotalPaise);
  assert.equal(quote.totalPaise, quote.itemsPayablePaise + quote.shippingFeePaise, 'Included tax must not be added again.');
  assert.ok(quote.totalPaise > 0 && Number.isSafeInteger(quote.totalPaise));
  assert.ok(new Date(quote.expiresAt).getTime() > Date.now());
  for (const key of ['costPaise', 'courierCostPaise', 'address', 'warehouse', 'packaging']) assert.equal(Object.hasOwn(quote, key), false);
  return quote;
}
async function start(customer, quote, key = randomUUID()) {
  const session = (await customer.browser.call('/api/v1/checkout/sessions', { method: 'POST', body: { quoteId: quote.quoteId }, headers: { 'Idempotency-Key': key }, expected: 201 })).data;
  assert.equal(session.fixture, true); assert.equal(session.status, 'ready'); assert.equal(session.keyId, null); assert.match(session.razorpayOrderId, /^fixture_order_/);
  assert.equal(session.amountPaise, quote.totalPaise); assert.equal(session.currency, 'INR');
  return { session, key };
}
const receipt = async (browser, id) => (await browser.call(`/api/v1/orders/${id}`)).data;
const simulate = async (browser, id, outcome) => (await browser.call('/api/v1/checkout/fixture', { method: 'POST', body: { orderId: id, outcome } })).data;
const reconcile = async (browser, id) => (await browser.call(`/api/v1/orders/${id}/reconcile`, { method: 'POST', body: {} })).data;
const cancel = async (browser, id) => (await browser.call(`/api/v1/orders/${id}/cancel`, { method: 'POST', body: { reason: 'Fixture HTTP test cancellation' } })).data;
async function expectError(browser, path, options, status, code) {
  const result = await browser.call(path, { ...options, expected: status });
  assert.equal(result.body.error.code, code); return result;
}
const first = await shopper();
await expectError(first.browser, '/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: first.cart.version, address }, headers: { Origin: 'https://other.example' } }, 403, 'FORBIDDEN');
await expectError(first.browser, '/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: first.cart.version, address: { ...address, pincode: '000000' } } }, 422, 'INVALID_FIELDS');
await expectError(first.browser, '/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: first.cart.version, address, totalPaise: 1 } }, 422, 'INVALID_FIELDS');
await expectError(first.browser, '/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: first.cart.version - 1, address } }, 409, 'QUOTE_STALE');
await expectError(first.browser, '/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: first.cart.version, address: { ...address, pincode: '999999' } } }, 422, 'UNSERVICEABLE_PIN');
await expectError(first.browser, '/api/v1/checkout/quote', { method: 'POST', body: { cartVersion: first.cart.version, address: { ...address, pincode: '888888' } } }, 503, 'UPSTREAM_UNAVAILABLE');
const staleQuote = await quoteFor(first);
first.cart = (await first.browser.call(`/api/v1/cart/items/${first.variant.id}`, { method: 'PATCH', body: { quantity: 1, cartVersion: first.cart.version } })).data;
await expectError(first.browser, '/api/v1/checkout/sessions', { method: 'POST', body: { quoteId: staleQuote.quoteId }, headers: { 'Idempotency-Key': randomUUID() } }, 409, 'QUOTE_STALE');
const approved = await quoteFor(first);
const alternative = await quoteFor(first, { ...address, line2: 'Different quote for idempotency conflict' });
await expectError(first.browser, '/api/v1/checkout/sessions', { method: 'POST', body: { quoteId: approved.quoteId } }, 422, 'INVALID_FIELDS');
const firstStart = await start(first, approved); const firstId = firstStart.session.orderId;
const repeated = await start(first, approved, firstStart.key);
assert.deepEqual(repeated.session, firstStart.session, 'A retry must reuse the same store order, attempt and provider order.');
await expectError(first.browser, '/api/v1/checkout/sessions', { method: 'POST', body: { quoteId: alternative.quoteId }, headers: { 'Idempotency-Key': firstStart.key } }, 409, 'IDEMPOTENCY_CONFLICT');
await expectError(first.browser, '/api/v1/checkout/sessions', { method: 'POST', body: { quoteId: alternative.quoteId }, headers: { 'Idempotency-Key': randomUUID() } }, 409, 'CHECKOUT_IN_PROGRESS');
const pending = await receipt(first.browser, firstId);
assert.equal(pending.orderStatus, 'pending_payment'); assert.equal(pending.capturedPaise, 0); assert.equal(pending.canPay, true);
assert.equal(pending.address.phone, '9000000000'); assert.equal(pending.address.email, address.email);
assert.equal((await first.browser.call('/api/v1/cart')).data.pendingCheckout.orderId, firstId);
await expectError(first.browser, `/api/v1/cart/items/${first.variant.id}`, { method: 'PATCH', body: { quantity: 2, cartVersion: first.cart.version } }, 409, 'CHECKOUT_IN_PROGRESS');
assert.equal((await first.browser.call(`/api/v1/operations/${firstStart.session.operationId}`)).data.orderId, firstId);
await expectError(observer, `/api/v1/orders/${firstId}`, {}, 404, 'NOT_FOUND');
await expectError(observer, `/api/v1/operations/${firstStart.session.operationId}`, {}, 404, 'NOT_FOUND');
await expectError(observer, '/api/v1/checkout/fixture', { method: 'POST', body: { orderId: firstId, outcome: 'captured' } }, 404, 'NOT_FOUND');
await expectError(observer, `/api/v1/orders/${firstId}/cancel`, { method: 'POST', body: { reason: 'Other browser cannot cancel' } }, 404, 'NOT_FOUND');
await expectError(first.browser, '/api/v1/payments/razorpay/verify', { method: 'POST', body: { orderId: firstId, razorpayPaymentId: 'pay_untrusted', razorpayOrderId: firstStart.session.razorpayOrderId, razorpaySignature: '0'.repeat(64) } }, 403, 'FORBIDDEN');
const invalidWebhook = await request('/api/v1/webhooks/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': '0'.repeat(64), 'X-Razorpay-Event-Id': 'm4-fixture-ignored' }, body: '{ raw invalid JSON }' });
assert.equal(invalidWebhook.status, 404, 'Fixture mode must reject the real Razorpay webhook boundary.');
assert.equal((await receipt(first.browser, firstId)).capturedPaise, 0);
const paid = await simulate(first.browser, firstId, 'captured');
assert.equal(paid.orderStatus, 'confirmed'); assert.equal(paid.paymentStatus, 'captured'); assert.equal(paid.fulfillmentStatus, 'ready');
assert.equal(paid.capturedPaise, approved.totalPaise); assert.equal(paid.totalPaise, approved.totalPaise);
assert.equal(paid.canPay, false); assert.equal(paid.canCancel, true);
const cleared = (await first.browser.call('/api/v1/cart')).data;
assert.equal(cleared.itemCount, 0); assert.equal(cleared.pendingCheckout, null);
const replayedReceipt = await reconcile(first.browser, firstId);
assert.equal(replayedReceipt.capturedPaise, paid.capturedPaise); assert.deepEqual(replayedReceipt.items, paid.items);
assert.equal((await first.browser.call('/api/v1/cart')).data.version, cleared.version, 'Duplicate capture reconciliation must clear cart once.');
console.log('PASS M4 HTTP: validated immutable quote, stale cart rejection, explicit fixture session, idempotent creation, private receipt/operation, capture and once-only cart clearing.');

// A failed attempt stays on its existing unresolved order; retry reuses it.
const retrying = await shopper(); const retryQuote = await quoteFor(retrying); const retryStart = await start(retrying, retryQuote); const retryId = retryStart.session.orderId;
const failed = await simulate(retrying.browser, retryId, 'failed');
assert.equal(failed.paymentStatus, 'unpaid'); assert.equal(failed.orderStatus, 'pending_payment'); assert.equal(failed.canPay, true); assert.equal(failed.capturedPaise, 0);
assert.equal((await retrying.browser.call(`/api/v1/orders/${retryId}/payment`, { method: 'POST', body: {} })).data.razorpayOrderId, retryStart.session.razorpayOrderId);
assert.equal((await simulate(retrying.browser, retryId, 'captured')).orderStatus, 'confirmed');
// Closing a browser sends no failure/cancel action. The same cookie later resumes the same order.
const closing = await shopper(); const closeQuote = await quoteFor(closing); const closeStart = await start(closing, closeQuote); const closeId = closeStart.session.orderId;
const reopened = new BrowserSession(); reopened.cookies = new Map(closing.browser.cookies);
assert.equal((await receipt(reopened, closeId)).orderStatus, 'pending_payment');
assert.equal((await reopened.call(`/api/v1/orders/${closeId}/payment`, { method: 'POST', body: {} })).data.orderId, closeId);
const cancelled = await cancel(reopened, closeId);
assert.equal(cancelled.orderStatus, 'cancelled'); assert.equal(cancelled.capturedPaise, 0); assert.equal(cancelled.canPay, false);
const preserved = (await reopened.call('/api/v1/cart')).data;
assert.equal(preserved.itemCount, 1); assert.equal(preserved.pendingCheckout, null);
await reopened.call(`/api/v1/cart/items/${closing.variant.id}`, { method: 'DELETE', headers: { 'If-Match': `"${preserved.version}"` } });
// Authorization is not capture, and an uncertain cancellation keeps inventory/payment held.
const authorizing = await shopper(); const authQuote = await quoteFor(authorizing); const authStart = await start(authorizing, authQuote); const authId = authStart.session.orderId;
const authorized = await simulate(authorizing.browser, authId, 'authorized');
assert.equal(authorized.paymentStatus, 'authorized'); assert.equal(authorized.capturedPaise, 0); assert.equal(authorized.canPay, false);
const held = await cancel(authorizing.browser, authId);
assert.equal(held.orderStatus, 'pending_payment'); assert.equal(held.fulfillmentStatus, 'held'); assert.equal(held.capturedPaise, 0); assert.ok(held.attentionReason);
const cancellationCapture = await simulate(authorizing.browser, authId, 'captured');
assert.equal(cancellationCapture.orderStatus, 'confirmed'); assert.equal(cancellationCapture.fulfillmentStatus, 'held'); assert.equal(cancellationCapture.attentionReason, 'CANCELLATION_REQUESTED');
// M5 retains the cancellation intent after capture; its durable cancellation job resolves shipping and refunds.
// Lost confirmation has a provider capture but the browser must still show pending until reconciliation.
const losing = await shopper(); const lostQuote = await quoteFor(losing); const lostStart = await start(losing, lostQuote); const lostId = lostStart.session.orderId;
const lost = await simulate(losing.browser, lostId, 'timeout');
assert.equal(lost.orderStatus, 'pending_payment'); assert.equal(lost.capturedPaise, 0);
assert.equal((await reconcile(losing.browser, lostId)).capturedPaise, lostQuote.totalPaise);
console.log('PASS M4 HTTP: failed retry, close/reopen, unpaid cancellation, authorized hold, eventual capture and lost callback reconciliation.');

// Every valid recovery request has the same public shape, including nonexistent pairs.
const recovery = new BrowserSession(), nonexistent = new BrowserSession();
const requestBody = { orderNumber: paid.orderNumber, email: address.email };
const accepted = await recovery.call('/api/v1/orders/access/request', { method: 'POST', body: requestBody });
const unknown = await nonexistent.call('/api/v1/orders/access/request', { method: 'POST', body: { ...requestBody, orderNumber: 'YB-DOES-NOT-EXIST' } });
assert.deepEqual(Object.keys(accepted.data).sort(), Object.keys(unknown.data).sort());
assert.equal(accepted.data.accepted, true); assert.equal(unknown.data.accepted, true); assert.equal(accepted.data.message, unknown.data.message);
assert.match(accepted.data.message, /Fixture.*no email/i); assert.match(accepted.data.fixtureToken, /^\d{6}$/); assert.match(unknown.data.fixtureToken, /^\d{6}$/);
const challengeCookie = accepted.response.headers.getSetCookie().find(value => value.startsWith('clothing_fixture_recovery='));
assert.ok(challengeCookie); assert.match(challengeCookie, /HttpOnly/i); assert.match(challengeCookie, /SameSite=lax/i);
await expectError(recovery, '/api/v1/orders/access/verify', { method: 'POST', body: { ...requestBody, token: accepted.data.fixtureToken === '000000' ? '111111' : '000000' } }, 400, 'OTP_INVALID');
await expectError(observer, '/api/v1/orders/access/verify', { method: 'POST', body: { ...requestBody, token: accepted.data.fixtureToken } }, 400, 'OTP_INVALID');
const granted = (await recovery.call('/api/v1/orders/access/verify', { method: 'POST', body: { ...requestBody, token: accepted.data.fixtureToken } })).data;
assert.equal(granted.orderId, firstId); assert.equal(granted.href, `/orders/${firstId}`);
assert.equal((await receipt(recovery, firstId)).address.email, address.email);
await expectError(recovery, '/api/v1/orders/access/verify', { method: 'POST', body: { ...requestBody, token: accepted.data.fixtureToken } }, 400, 'OTP_INVALID');
await expectError(nonexistent, '/api/v1/orders/access/verify', { method: 'POST', body: { ...requestBody, orderNumber: 'YB-DOES-NOT-EXIST', token: unknown.data.fixtureToken } }, 404, 'NOT_FOUND');
// Bound the fixture worker drain. This invokes no delivery adapter outside fixture mode.
for (let attempt = 0; attempt < 12; attempt++) {
  const jobs = (await observer.call('/api/v1/internal/jobs/run', { method: 'POST' })).data;
  assert.equal(jobs.failed, 0, 'Fixture jobs should settle without delivery/provider calls.');
  if (!jobs.claimed) break;
}
assert.equal((await receipt(first.browser, firstId)).notificationStatus, 'unconfigured');
console.log('PASS M4 HTTP: uniform fixture recovery request, cookie-bound OTP, wrong/replayed code rejection, authorized receipt grant and truthful no-email outbox.');
console.log('M4 fixture HTTP checks passed. Sample orders remain in the isolated fixture DB; no real Supabase, Razorpay, Shiprocket or email service was verified.');
