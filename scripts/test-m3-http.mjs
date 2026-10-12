import assert from 'node:assert/strict';
const origin = process.env.M3_TEST_URL;
if (!origin) throw new Error('Set M3_TEST_URL to an already-running fixture preview with matching APP_URL.');
const get = (path) => fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(30000) });
for (const path of ['/', '/collections', '/collections/all', '/collections/all?page=999', '/collections/all?color=stone&minPrice=179900&maxPrice=179900', '/search', '/search?q=washed', '/search?q=does-not-exist', '/products/everyday-oversized-tee', '/products/panelled-street-hoodie', '/products/studio-tote', '/cart', '/wishlist', '/about', '/contact', '/size-guide', '/track-order', '/policies/shipping', '/policies/returns', '/policies/privacy', '/policies/terms']) {
  const response = await get(path); const html = await response.text();
  assert.equal(response.status, 200, path);
  assert.match(html, /<main[^>]*id="main"/, path);
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/, path);
  assert.doesNotMatch(html, /We couldn.t load this section|Application error/, path);
  if (path === '/cart') assert.match(response.headers.get('cache-control') ?? '', /no-store/);
}
for (const path of ['/collections/unknown-collection', '/products/unknown-product', '/policies/unknown-policy', '/does-not-exist']) {
  const response = await get(path);
  assert.equal(response.status, 404, `Real HTTP 404 required: ${path}`);
  assert.match(await response.text(), /find that page/);
}
const corrected = await (await get('/collections/all?minPrice=200000&maxPrice=100000')).text();
assert.match(corrected, /price|Price/);
const filtered = await (await get('/api/v1/products?color=stone&minPrice=179900&maxPrice=179900')).json();
assert.equal(filtered.data.items.length, 1);
assert.equal(filtered.data.items[0].slug, 'contrast-stitch-shirt');
assert.equal(filtered.data.items[0].fromPricePaise, 179900);
assert.equal(filtered.data.pageSize, 12);
const image = await get('/_next/image?url=%2Fapi%2Fv1%2Fmedia%2Ffixtures%2Fcatalog%2Fp01-front.png&w=640&q=75');
assert.equal(image.status, 200, 'Published placeholder image must pass Next image optimization');
assert.match(image.headers.get('content-type') ?? '', /^image\//);
console.log('PASS M3 storefront HTTP: routes, real 404s, safe metadata, matching-variant API prices, image delivery.');
await import('./test-cart-http.mjs');
