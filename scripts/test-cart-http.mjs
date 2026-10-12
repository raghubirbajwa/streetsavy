import assert from 'node:assert/strict';

// Run against an already-started fixture preview with matching APP_URL.
// This creates two isolated guest carts and clears their items before finishing.
const origin = process.env.M3_TEST_URL;
if (!origin) throw new Error('Set M3_TEST_URL to the fixture preview origin.');
const req = (path, options = {}) => fetch(new URL(path, origin), { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) });
async function data(path, options = {}, expected = 200) {
  const response = await req(path, options); const body = await response.json();
  assert.equal(response.status, expected, `${options.method ?? 'GET'} ${path}: ${JSON.stringify(body)}`);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return { response, body, data: body.data };
}
const headers = cookie => ({ Origin: origin, ...(cookie ? { Cookie: cookie } : {}) });
const mutation = (method, cookie, body) => ({ method, headers: { ...headers(cookie), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const initial = await data('/api/v1/cart');
assert.equal(initial.data.id, null); assert.equal(initial.data.version, 0); assert.equal(initial.response.headers.get('set-cookie'), null);
await data('/api/v1/cart', { method: 'POST' }, 403);
await data('/api/v1/cart', { method: 'POST', headers: { Origin: 'https://other.example' } }, 403);
await data('/api/v1/cart', mutation('POST', null, { userId: 'unauthorized' }), 422);
const created = await data('/api/v1/cart', { method: 'POST', headers: headers() });
const setCookie = created.response.headers.getSetCookie().find(value => value.startsWith('clothing_guest='));
assert.ok(setCookie); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=lax/i); assert.match(setCookie, /Path=\//i); assert.match(setCookie, /Expires=/i);
if (origin.startsWith('https:')) assert.match(setCookie, /Secure/i);
const cookie = setCookie.split(';')[0]; let cart = created.data;
assert.equal((await data('/api/v1/cart', { method: 'POST', headers: headers(cookie) })).data.id, cart.id);
const other = await data('/api/v1/cart', { method: 'POST', headers: headers() });
const otherCookie = other.response.headers.getSetCookie().find(value => value.startsWith('clothing_guest=')).split(';')[0];
assert.notEqual(other.data.id, cart.id);
const listing = await data('/api/v1/products?inStock=true');
const product = await data('/api/v1/products/' + listing.data.items[0].slug);
const variant = product.data.variants.find(option => option.available); assert.ok(variant);
await data('/api/v1/cart/items', mutation('POST', cookie, { variantId: variant.id, quantity: 1, cartVersion: cart.version, pricePaise: 1 }), 422);
await data('/api/v1/cart/items', mutation('POST', cookie, { variantId: variant.id, quantity: 11, cartVersion: cart.version }), 422);
await data('/api/v1/cart/items', mutation('POST', cookie, { title: 'x'.repeat(5000) }), 413);
await data('/api/v1/cart/items', { method: 'POST', headers: { ...headers(cookie), 'Content-Type': 'application/json' }, body: '{' }, 400);
const oldVersion = cart.version;
cart = (await data('/api/v1/cart/items', mutation('POST', cookie, { variantId: variant.id, quantity: 1, cartVersion: cart.version }))).data;
assert.equal(cart.itemCount, 1); assert.equal(cart.subtotalPaise, variant.pricePaise);
assert.equal((await data('/api/v1/cart', { headers: { Cookie: cookie } })).data.id, cart.id);
assert.equal((await data('/api/v1/cart', { headers: { Cookie: otherCookie } })).data.lines.length, 0);
const conflict = await data('/api/v1/cart/items', mutation('POST', cookie, { variantId: variant.id, quantity: 1, cartVersion: oldVersion }), 409);
assert.equal(conflict.body.error.code, 'VERSION_CONFLICT'); assert.equal(conflict.body.error.currentCart.version, cart.version);
await data(`/api/v1/cart/items/${variant.id}`, { method: 'DELETE', headers: { ...headers(otherCookie), 'If-Match': `"${other.data.version}"` } }, 404);
await data(`/api/v1/cart/items/${variant.id}`, { method: 'DELETE', headers: { Cookie: cookie, 'If-Match': `"${cart.version}"` } }, 403);
await data(`/api/v1/cart/items/${variant.id}`, { method: 'DELETE', headers: { ...headers(cookie), 'If-Match': String(cart.version) } }, 422);
cart = (await data(`/api/v1/cart/items/${variant.id}`, mutation('PATCH', cookie, { quantity: 1, cartVersion: cart.version }))).data;
cart = (await data(`/api/v1/cart/items/${variant.id}`, { method: 'DELETE', headers: { ...headers(cookie), 'If-Match': `"${cart.version}"` } })).data;
assert.equal(cart.itemCount, 0); assert.equal(cart.subtotalPaise, 0);
console.log('PASS M3 cart HTTP: opaque HttpOnly session, persistence, isolation, safe prices, version conflicts, bounded JSON, CSRF and versioned removal.');
