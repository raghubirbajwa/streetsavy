import assert from 'node:assert/strict';
import test from 'node:test';
import {createFixtureAdminDatabase, executeFixtureRpc} from '../src/lib/admin/db.ts';
import {fixtureCheckoutSql} from '../src/data/fixtures/checkout-seed.ts';
import {fixtureIdentities} from '../src/lib/auth/fixture.ts';
import {createCartService} from '../src/lib/cart/service.ts';
import {createCheckoutService} from '../src/lib/checkout/service.ts';
import {createShippingService} from '../src/lib/fulfillment/shipping-service.ts';

const address = {fullName:'M6 Fixture Shopper', phone:'9000000000', email:'m6@example.invalid', line1:'Fixture address', city:'Fixture City', stateCode:'KA', pincode:'560001', country:'IN'};
const staff = fixtureIdentities.staff.id;

async function harness() {
  process.env.APP_MODE='fixture'; process.env.APP_URL='http://localhost:3000';
  const db=await createFixtureAdminDatabase();
  await db.exec(fixtureCheckoutSql);
  const rpc=<T=unknown>(name:string,args:Record<string,unknown>)=>executeFixtureRpc<T>(db,name,args);
  const carts=createCartService(rpc), checkout=createCheckoutService({rpc}), shipping=createShippingService({rpc});
  const variant=(await db.query<{id:string}>('select v.id from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand>10 order by v.id limit 1')).rows[0]!.id;
  async function shopper(quantity=1) {
    const guest=await carts.create(undefined);
    const cart=await carts.add(guest.token,{variantId:variant,quantity,cartVersion:1});
    const quote=await checkout.quote(guest.token,{cartVersion:cart.version,address});
    return {guest,cart,quote};
  }
  const stock=async()=>(await db.query<{on_hand:number;reserved:number}>('select on_hand,reserved from public.inventory where variant_id=$1',[variant])).rows[0]!;
  const version=async(id:string)=>(await db.query<{version:number}>('select version from public.orders where id=$1',[id])).rows[0]!.version;
  return {db,rpc,carts,checkout,shipping,variant,shopper,stock,version};
}

test('M6 Q03: nonzero inclusive tax remains inside integer totals and changed fee settings invalidate a quote', async()=>{
  const h=await harness();
  try {
    // Nonzero sample tax is isolated to this in-memory database, not a business policy.
    await h.db.exec("update public.store_settings set value=value||'{\"taxRatePercent\":5,\"shippingMode\":\"flat\",\"shippingFeePaise\":101}'::jsonb where key='commerce'");
    const a=await h.shopper(3), q=a.quote;
    const expectedIncluded=Math.round(q.itemsPayablePaise*5/105)+Math.round(q.shippingFeePaise*5/105);
    assert.equal(q.taxBreakdown[0]!.includedPaise,expectedIncluded);
    assert.ok(expectedIncluded>0);
    assert.equal(q.totalPaise,q.itemsPayablePaise+101);
    assert.ok(Number.isSafeInteger(q.totalPaise));
    const s=await h.checkout.start(a.guest.token,q.quoteId,'m6-nonzero-inclusive-tax');
    assert.equal(s.amountPaise,q.totalPaise);
    const row=(await h.db.query<{order_total:number;payment_total:number}>('select o.total_paise::float8 order_total,a.amount_paise::float8 payment_total from public.orders o join public.payment_attempts a on a.order_id=o.id where o.id=$1',[s.orderId])).rows[0]!;
    assert.deepEqual(row,{order_total:q.totalPaise,payment_total:q.totalPaise});
    const b=await h.shopper();
    await h.db.exec("update public.store_settings set value=jsonb_set(value,'{shippingFeePaise}','102') where key='commerce'");
    await assert.rejects(h.checkout.start(b.guest.token,b.quote.quoteId,'m6-stale-shipping-fee'),/QUOTE_STALE/);
    assert.equal((await h.db.query<{count:number}>('select count(*)::int count from public.orders')).rows[0]!.count,1);
  } finally {await h.db.close();}
});

test('M6 Q04: simultaneous tabs with separate keys reserve a cart only once', async()=>{
  const h=await harness();
  try {
    const before=await h.stock(), a=await h.shopper();
    const secondQuote=await h.checkout.quote(a.guest.token,{cartVersion:a.cart.version,address});
    const attempts=await Promise.allSettled([
      h.checkout.start(a.guest.token,a.quote.quoteId,'m6-checkout-tab-one'),
      h.checkout.start(a.guest.token,secondQuote.quoteId,'m6-checkout-tab-two'),
    ]);
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    const rejected=attempts.find(x=>x.status==='rejected');
    assert.equal(rejected?.status,'rejected');
    if(rejected?.status==='rejected')assert.match(String(rejected.reason),/CHECKOUT_IN_PROGRESS/);
    assert.deepEqual(await h.stock(),{on_hand:before.on_hand,reserved:before.reserved+1});
    assert.equal((await h.db.query<{count:number}>('select count(*)::int count from public.orders')).rows[0]!.count,1);
    assert.equal((await h.db.query<{count:number}>('select count(*)::int count from public.payment_attempts')).rows[0]!.count,1);
  } finally {await h.db.close();}
});

test('M6 Q04: expired last-unit reservation followed by another buyer and delayed duplicate capture never oversells', async()=>{
  const h=await harness();
  try {
    await h.db.query('update public.inventory set on_hand=1,reserved=0 where variant_id=$1',[h.variant]);
    const a=await h.shopper();
    const first=await h.checkout.start(a.guest.token,a.quote.quoteId,'m6-expired-first-buyer');
    await h.db.query("update public.inventory_reservations set expires_at=now()-interval '1 second' where order_id=$1",[first.orderId]);
    await h.checkout.reconcile(first.orderId);
    assert.deepEqual(await h.stock(),{on_hand:1,reserved:0});
    const b=await h.shopper();
    const second=await h.checkout.start(b.guest.token,b.quote.quoteId,'m6-final-unit-new-buyer');
    await h.checkout.simulate(b.guest.token,{orderId:second.orderId,outcome:'captured'});
    await h.rpc('checkout_internal',{p_action:'fixturePayment',p_id:first.orderId,p_payload:{state:'captured'}});
    await h.checkout.reconcile(first.orderId);
    await h.checkout.reconcile(first.orderId);
    const late=await h.checkout.receipt(first.orderId,a.guest.token);
    assert.equal(late.capturedPaise,first.amountPaise);
    assert.equal(late.attentionReason,'LATE_CAPTURE_REVIEW');
    assert.equal(late.fulfillmentStatus,'held');
    assert.deepEqual(await h.stock(),{on_hand:0,reserved:0});
    assert.equal((await h.db.query<{count:number}>("select count(*)::int count from public.inventory_movements where kind='sale' and variant_id=$1",[h.variant])).rows[0]!.count,1);
  } finally {await h.db.close();}
});

test('M6 Q05: wrong-mode and wrong-currency capture evidence cannot allocate inventory', async()=>{
  const h=await harness();
  try {
    const before=await h.stock(), a=await h.shopper();
    const s=await h.checkout.start(a.guest.token,a.quote.quoteId,'m6-invalid-capture-evidence');
    const payment={id:'pay_M6WrongCurrency',order_id:s.razorpayOrderId,amount:s.amountPaise,currency:'INR',status:'captured',refunds:[]};
    await assert.rejects(h.rpc('apply_verified_payment',{p_order_id:s.orderId,p_payment:payment,p_mode:'live'}),/PAYMENT_MISMATCH/);
    await h.rpc('apply_verified_payment',{p_order_id:s.orderId,p_payment:{...payment,currency:'USD'},p_mode:'test'});
    const receipt=await h.checkout.receipt(s.orderId,a.guest.token);
    assert.equal(receipt.capturedPaise,0);
    assert.equal(receipt.attentionReason,'PAYMENT_MISMATCH');
    assert.equal(receipt.fulfillmentStatus,'held');
    assert.deepEqual(await h.stock(),{on_hand:before.on_hand,reserved:before.reserved+1});
    assert.equal((await h.db.query<{count:number}>("select count(*)::int count from public.inventory_movements where order_id=$1 and kind='sale'",[s.orderId])).rows[0]!.count,0);
  } finally {await h.db.close();}
});

test('M6 Q07: actual parcel changes alter carrier cost without changing paid totals and warehouse changes invalidate dispatch quotes', async()=>{
  const h=await harness();
  try {
    const a=await h.shopper(), s=await h.checkout.start(a.guest.token,a.quote.quoteId,'m6-actual-dispatch-parcel');
    await h.checkout.simulate(a.guest.token,{orderId:s.orderId,outcome:'captured'});
    const parcel={weightG:1200,lengthCm:40,widthCm:30,heightCm:15};
    const original=await h.shipping.quotes(staff,s.orderId,{...parcel,orderVersion:await h.version(s.orderId)});
    const actual={...parcel,weightG:2200,heightCm:20};
    const remeasured=await h.shipping.quotes(staff,s.orderId,{...actual,orderVersion:await h.version(s.orderId)});
    assert.ok(remeasured.quotes[0]!.costPaise>original.quotes[0]!.costPaise);
    await h.db.exec("update public.warehouse set name='Updated fixture pickup' where active");
    await assert.rejects(h.shipping.book(staff,s.orderId,{shippingQuoteId:remeasured.quotes[0]!.id,orderVersion:remeasured.orderVersion},'m6-warehouse-stale-book'),/QUOTE_STALE/);
    const fresh=await h.shipping.quotes(staff,s.orderId,{...actual,orderVersion:await h.version(s.orderId)});
    const shipment=await h.shipping.book(staff,s.orderId,{shippingQuoteId:fresh.quotes[0]!.id,orderVersion:fresh.orderVersion},'m6-actual-parcel-booking');
    assert.deepEqual(shipment.parcel,actual);
    assert.equal(shipment.costPaise,fresh.quotes[0]!.costPaise);
    assert.equal((await h.checkout.receipt(s.orderId,a.guest.token)).totalPaise,s.amountPaise);
  } finally {await h.db.close();}
});

test('M6 Q12: worker-specific claims recover leases, fence stale workers and keep ambiguous operations non-replayable after audited job retry', async()=>{
  const h=await harness();
  try {
    const operation=await h.rpc<{id:string}>('begin_operation',{p_scope:'shipping.create',p_actor_or_session_key:'m6-fixture-worker',p_idempotency_key:'m6-worker-operation',p_request_hash:'a'.repeat(64)});
    const claimed=await h.rpc<{lease_token:string}>('claim_operation',{p_id:operation.id});
    const job=await h.rpc<{id:string}>('enqueue_job',{p_type:'shipping.operation',p_dedupe_key:'m6-crashed-shipping-worker',p_payload:{operationId:operation.id},p_max_attempts:1});
    const shipmentJobs=await h.rpc<Array<{id:string;lease_token:string}>>('shipping_claim_jobs',{});
    assert.equal(shipmentJobs[0]!.id,job.id);
    await h.db.query("update public.jobs set locked_until=now()-interval '1 second' where id=$1",[job.id]);
    await h.db.query("update public.external_operations set locked_until=now()-interval '1 second' where id=$1",[operation.id]);
    // The checkout worker also reclaims expired leases, but may not consume carrier work.
    assert.deepEqual(await h.rpc('checkout_claim_jobs',{p_limit:1}),[]);
    assert.deepEqual((await h.db.query('select state,last_error from public.jobs where id=$1',[job.id])).rows[0],{state:'dead',last_error:'LEASE_EXPIRED'});
    await assert.rejects(h.rpc('complete_job',{p_id:job.id,p_lease_token:shipmentJobs[0]!.lease_token}),/LEASE_LOST/);
    await assert.rejects(h.rpc('finish_operation',{p_id:operation.id,p_lease_token:claimed.lease_token,p_status:'succeeded'}),/LEASE_LOST/);
    await h.rpc('fulfillment_retry_job',{p_actor:staff,p_id:job.id,p_reason:'Inspect crashed fixture shipping operation before reconcile'});
    assert.deepEqual(await h.rpc('checkout_claim_jobs',{p_limit:1}),[]);
    const retried=await h.rpc<Array<{id:string;lease_token:string}>>('shipping_claim_jobs',{});
    assert.equal(retried[0]!.id,job.id);
    assert.notEqual(retried[0]!.lease_token,shipmentJobs[0]!.lease_token);
    const guarded=await h.rpc<{status:string;attempts:number;lease_token:null}>('claim_operation',{p_id:operation.id});
    assert.equal(guarded.status,'unknown');
    assert.equal(guarded.attempts,1);
    assert.equal(guarded.lease_token,null);
    assert.equal((await h.db.query<{count:number}>("select count(*)::int count from public.audit_logs where action='job.retry' and entity_id=$1",[job.id])).rows[0]!.count,1);
  } finally {await h.db.close();}
});
