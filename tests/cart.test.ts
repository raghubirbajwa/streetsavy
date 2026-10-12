import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureAdminDatabase, executeFixtureRpc } from "../src/lib/admin/db.ts";
import { CartError, createCartService, hashGuestToken, newGuestToken, type CartRpc } from "../src/lib/cart/service.ts";
import { addCartItemSchema, cartSchema } from "../src/lib/cart/contracts.ts";

const code = (expected: string) => (error: unknown) => error instanceof CartError && error.code === expected;

test("cart capabilities are opaque, validated and hashed; browser fields cannot set prices or ownership", () => {
  const one = newGuestToken(), two = newGuestToken();
  assert.equal(one.length, 43); assert.notEqual(one, two); assert.match(hashGuestToken(one)!, /^[0-9a-f]{64}$/);
  assert.notEqual(hashGuestToken(one), one); assert.equal(hashGuestToken("not-a-session"), null); assert.equal(hashGuestToken(undefined), null);
  const item = { variantId: "00000000-0000-4000-8000-000000000001", quantity: 1, cartVersion: 1 };
  for (const invalid of [{ ...item, pricePaise: 1 }, { ...item, guestSessionId: item.variantId }, { ...item, quantity: 0 }, { ...item, quantity: 1.5 }, { ...item, quantity: 11 }, { ...item, cartVersion: 0 }]) assert.equal(addCartItemSchema.safeParse(invalid).success, false);
});

test("guest cart SQL persists, merges, reprices, isolates sessions, reports conflicts and never reserves stock", async () => {
  const prior = { mode: process.env.APP_MODE, url: process.env.APP_URL };
  process.env.APP_MODE = "fixture"; process.env.APP_URL = "http://localhost:3000";
  const db = await createFixtureAdminDatabase();
  const rpc: CartRpc = (name, args) => executeFixtureRpc(db, name, args);
  const service = createCartService(rpc);
  try {
    const variants = (await db.query<{ id: string; product_id: string; price_paise: number }>("select v.id,v.product_id,v.price_paise from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand-i.reserved>=10 order by v.id limit 2")).rows;
    const first = variants[0]!, second = variants[1]!;
    const baseline = (await db.query("select variant_id,on_hand,reserved from public.inventory order by variant_id")).rows;
    assert.equal((await service.get(undefined)).id, null);
    const a = await service.create(undefined); const b = await service.create(undefined);
    assert.notEqual(a.token, b.token); assert.notEqual(a.cart.id, b.cart.id);
    assert.equal((await service.create(a.token)).cart.id, a.cart.id, "create reuses an unexpired session/cart");
    const stored = (await db.query<{ token_hash: string; expires_at: Date }>("select token_hash,expires_at from public.guest_sessions where token_hash=$1", [hashGuestToken(a.token)])).rows[0]!;
    assert.equal(stored.token_hash, hashGuestToken(a.token)); assert.ok(new Date(stored.expires_at).getTime() > Date.now()+29*86400_000);
    let cart = await service.add(a.token, { variantId: first.id, quantity: 2, cartVersion: a.cart.version });
    assert.equal(cart.version, 2); assert.equal(cart.lines.length, 1); assert.equal(cart.itemCount, 2);
    cart = await service.add(a.token, { variantId: first.id, quantity: 3, cartVersion: cart.version });
    assert.equal(cart.lines.length, 1); assert.equal(cart.lines[0]!.quantity, 5);
    cart = await service.add(a.token, { variantId: second.id, quantity: 1, cartVersion: cart.version });
    assert.equal(cart.lines.length, 2); assert.equal(cart.itemCount, 6);
    const beforeConflict = cart;
    await assert.rejects(service.update(a.token, first.id, { quantity: 1, cartVersion: 1 }), (error: unknown) => error instanceof CartError && error.code === "VERSION_CONFLICT" && error.currentCart.version === beforeConflict.version && error.currentCart.itemCount === 6);
    assert.deepEqual(await service.get(a.token), beforeConflict);
    assert.equal((await service.get(b.token)).lines.length, 0);
    await assert.rejects(service.remove(b.token, first.id, b.cart.version), code("NOT_FOUND"));
    await assert.rejects(service.add(undefined, { variantId: first.id, quantity: 1, cartVersion: 1 }), code("SESSION_REQUIRED"));
    await assert.rejects(service.add(a.token, { variantId: first.id, quantity: 6, cartVersion: cart.version }), code("QUANTITY_LIMIT"));
    await db.query("update public.product_variants set price_paise=12345,compare_at_paise=null where id=$1", [first.id]);
    const repriced = await service.get(a.token);
    assert.equal(repriced.lines.find((line) => line.variantId === first.id)!.unitPricePaise, 12345);
    assert.equal(repriced.subtotalPaise, 12345*5+Number(second.price_paise));
    assert.equal(repriced.version, cart.version, "catalog changes resolve current prices without pretending a cart mutation happened");
    assert.deepEqual((await db.query("select variant_id,on_hand,reserved from public.inventory order by variant_id")).rows, baseline);
    await db.query("update public.inventory set on_hand=2,reserved=0 where variant_id=$1", [first.id]);
    cart = await service.get(a.token);
    assert.equal(cart.hasUnavailableItems, true); assert.equal(cart.lines.find((line) => line.variantId === first.id)!.unavailableReason, "insufficient_stock");
    await assert.rejects(service.update(a.token, first.id, { quantity: 3, cartVersion: cart.version }), code("STOCK_CONFLICT"));
    cart = await service.update(a.token, first.id, { quantity: 2, cartVersion: cart.version });
    assert.equal(cart.lines.find((line) => line.variantId === first.id)!.available, true);
    await db.query("update public.product_variants set enabled=false where id=$1", [first.id]);
    cart = await service.get(a.token);
    assert.equal(cart.lines.find((line) => line.variantId === first.id)!.unavailableReason, "variant_unavailable");
    await db.query("update public.products set status='draft',title='Private draft title' where id=$1", [first.product_id]);
    cart = await service.get(a.token); const hidden = cart.lines.find((line) => line.variantId === first.id)!;
    assert.equal(hidden.title, "Unavailable item"); assert.equal(hidden.slug, null); assert.equal(hidden.unitPricePaise, null); assert.equal(hidden.image, null);
    assert.equal(JSON.stringify(cart).includes("Private draft"), false);
    cart = await service.remove(a.token, first.id, cart.version); assert.equal(cart.lines.some((line) => line.variantId === first.id), false);
    assert.equal(cartSchema.safeParse(cart).success, true);
    await db.query("update public.guest_sessions set revoked_at=now() where token_hash=$1", [hashGuestToken(a.token)]);
    assert.equal((await service.get(a.token)).id, null);
    await assert.rejects(service.remove(a.token, second.id, cart.version), code("SESSION_REQUIRED"));
    const rotated = await service.create(a.token); assert.notEqual(rotated.token, a.token); assert.notEqual(rotated.cart.id, a.cart.id);
    // Age the second session while retaining its original 30-day validity invariant.
    await db.query("update public.guest_sessions set created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where token_hash=$1", [hashGuestToken(b.token)]);
    assert.equal((await service.get(b.token)).id, null); assert.notEqual((await service.create(b.token)).token, b.token);
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.guest_cart('get',$1)", [hashGuestToken(rotated.token)]), /permission denied/);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(db.query("select public.guest_cart_resolve($1)", [rotated.cart.id]), /permission denied/);
    await assert.rejects(db.query("select * from public.cart_items"), /permission denied/);
    await db.exec("reset role");
    await assert.rejects(rpc("guest_cart", { p_action: "add", p_token_hash: hashGuestToken(rotated.token), p_payload: { variantId: second.id, quantity: 1, cartVersion: 1, pricePaise: 1 } }), /INVALID_PAYLOAD/);
  } finally {
    await db.close();
    if (prior.mode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = prior.mode;
    if (prior.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = prior.url;
  }
});

test("cart mutations expire quotes and a pending checkout blocks changes with recovery information", async () => {
  const prior = { mode: process.env.APP_MODE, url: process.env.APP_URL };
  process.env.APP_MODE = "fixture"; process.env.APP_URL = "http://localhost:3000";
  const db = await createFixtureAdminDatabase();
  const service = createCartService((name, args) => executeFixtureRpc(db, name, args));
  try {
    const variant = (await db.query<{ id: string }>("select v.id from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand>=5 order by v.id limit 1")).rows[0]!;
    const session = await service.create(undefined);
    let cart = await service.add(session.token, { variantId: variant.id, quantity: 1, cartVersion: 1 });
    const warehouse = (await db.query<{ id: string }>("insert into public.warehouse(name,pickup_location,contact,address,active) values('Cart test','Cart test','{}','{}',false) returning id")).rows[0]!;
    const quote = (await db.query<{ id: string }>("insert into public.shipping_quotes(cart_id,cart_version,address_fingerprint,address_snapshot,warehouse_id,packaging_snapshot,eligible_services,selected_service_key,courier_cost_paise,shipping_fee_paise,item_subtotal_paise,total_paise,pricing_version) values($1,$2,'test','{}',$3,'{}','[]','test',0,0,100,100,1) returning id", [cart.id, cart.version, warehouse.id])).rows[0]!;
    cart = await service.update(session.token, variant.id, { quantity: 2, cartVersion: cart.version });
    assert.equal((await db.query<{ status: string }>("select status from public.shipping_quotes where id=$1", [quote.id])).rows[0]!.status, "expired");
    const order = (await db.query<{ id: string }>("insert into public.orders(order_number,guest_session_id,customer_email,customer_phone,shipping_address_snapshot,items_payable_paise,shipping_fee_paise,total_paise,quote_id,source_cart_id,source_cart_version,shipping_snapshot,packaging_snapshot,mode) select 'CART-GUARD-TEST',guest_session_id,'test@example.invalid','0000000000','{}',100,0,100,$2,id,version,'{}','{}','test' from public.carts where id=$1 returning id", [cart.id, quote.id])).rows[0]!;
    await assert.rejects(service.remove(session.token, variant.id, cart.version), (error: unknown) => error instanceof CartError && error.code === "CHECKOUT_IN_PROGRESS" && error.currentCart.pendingCheckout?.orderId === order.id);
    assert.equal((await service.get(session.token)).itemCount, 2);
  } finally {
    await db.close();
    if (prior.mode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = prior.mode;
    if (prior.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = prior.url;
  }
});
