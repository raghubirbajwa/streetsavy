import assert from "node:assert/strict";
import {test} from "node:test";
import {createHmac} from "node:crypto";
import {createFixtureAdminDatabase,executeFixtureRpc} from "../src/lib/admin/db.ts";
import {fixtureCheckoutSql} from "../src/data/fixtures/checkout-seed.ts";
import {createCartService,hashGuestToken} from "../src/lib/cart/service.ts";
import {createCheckoutService} from "../src/lib/checkout/service.ts";
import {addressSchema} from "../src/lib/checkout/contracts.ts";
import {validSignature,shippingQuote,paymentProvider,sendOrderNotification} from "../src/lib/checkout/providers.ts";
import {readEnvironment} from "../src/config/env.ts";

const address={fullName:"Fixture Shopper",phone:"9000000000",email:"shopper@example.invalid",line1:"Fixture address",line2:"",city:"Fixture City",stateCode:"KA",pincode:"560001",country:"IN"};
test("checkout boundaries normalize contact details, reject injected totals, and verify exact raw signatures",()=>{
  assert.equal(addressSchema.parse({...address,email:" SHOPPER@example.invalid ",phone:"+91 90000 00000"}).email,address.email);
  for(const value of [{...address,price:1},{...address,pincode:"000000"},{...address,country:"US"},{...address,line1:"Bad\naddress"}])assert.equal(addressSchema.safeParse(value).success,false);
  const raw=Buffer.from('{ "amount": 500 }');const sig=createHmac('sha256','test-secret').update(raw).digest('hex');
  assert.equal(validSignature(raw,sig,'test-secret'),true);assert.equal(validSignature('{"amount":500}',sig,'test-secret'),false);assert.equal(validSignature(raw,'a','test-secret'),false);
});
test("fixture providers make zero external requests and tax/fee examples are explicit",async()=>{
  const env=readEnvironment({APP_MODE:"fixture",APP_URL:"http://localhost:3000"});let calls=0;const transport=(async()=>{calls++;throw new Error('No external call allowed');}) as typeof fetch;
  assert.throws(()=>paymentProvider(env,transport),/INTEGRATION_UNCONFIGURED/);
  const parcel={pickupPincode:'560001',deliveryPincode:'560002',weightG:500,lengthCm:40,widthCm:30,heightCm:15};
  assert.equal((await shippingQuote(parcel,env,transport)).costPaise,7500);assert.equal((await shippingQuote({...parcel,deliveryPincode:'999999'},env,transport)).serviceable,false);
  await assert.rejects(shippingQuote({...parcel,deliveryPincode:'888888'},env,transport),/UPSTREAM_UNAVAILABLE/);
  assert.equal((await sendOrderNotification({id:'test',email:address.email,orderNumber:'TEST',orderId:'test',firstAttemptAt:null},env,transport)).status,'unconfigured');assert.equal(calls,0);
});
test("checkout SQL: immutable quote, reservations, duplicate capture, receipt ownership, late capture and outbox",async()=>{
  process.env.APP_MODE='fixture';process.env.APP_URL='http://localhost:3000';
  const db=await createFixtureAdminDatabase();const rpc=<T=unknown>(name:string,args:Record<string,unknown>)=>executeFixtureRpc<T>(db,name,args);
  const carts=createCartService(rpc),checkout=createCheckoutService({rpc});
  try{
    await db.exec(fixtureCheckoutSql);
    const variant=(await db.query<{id:string}>("select v.id from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand>=10 order by v.id limit 1")).rows[0]!.id;
    const a=await carts.create(undefined),b=await carts.create(undefined);
    let cart=await carts.add(a.token,{variantId:variant,quantity:1,cartVersion:1});
    const initial=(await db.query<{on_hand:number;reserved:number}>('select on_hand,reserved from public.inventory where variant_id=$1',[variant])).rows[0]!;
    const quote=await checkout.quote(a.token,{cartVersion:cart.version,address});assert.equal(quote.shippingFeePaise,7500);assert.equal(quote.taxBreakdown[0]?.includedPaise,0);
    assert.deepEqual((await db.query('select on_hand,reserved from public.inventory where variant_id=$1',[variant])).rows[0],initial,'quote never reserves');
    await assert.rejects(db.query('update public.shipping_quotes set total_paise=total_paise+1,shipping_fee_paise=shipping_fee_paise+1 where id=$1',[quote.quoteId]),/IMMUTABLE_QUOTE/);
    const session=await checkout.start(a.token,quote.quoteId,'test-checkout-1');assert.equal(session.status,'ready');
    assert.equal((await checkout.start(a.token,quote.quoteId,'test-checkout-1')).orderId,session.orderId);
    await assert.rejects(checkout.start(b.token,quote.quoteId,'test-checkout-1'),/NOT_FOUND/);
    await assert.rejects(checkout.receipt(session.orderId,b.token),/NOT_FOUND/);
    await assert.rejects(carts.update(a.token,variant,{quantity:2,cartVersion:cart.version}),/checkout is already pending/);
    assert.equal((await db.query<{reserved:number}>('select reserved from public.inventory where variant_id=$1',[variant])).rows[0]?.reserved,initial.reserved+1);
    const captured=await checkout.simulate(a.token,{orderId:session.orderId,outcome:'captured'});assert.equal(captured.paymentStatus,'captured');assert.equal(captured.fulfillmentStatus,'ready');
    await checkout.reconcile(session.orderId);await checkout.reconcile(session.orderId);
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.inventory_movements where order_id=$1 and kind='sale'",[session.orderId])).rows[0]?.n,1);
    assert.equal((await db.query<{n:number}>('select count(*)::int n from public.notifications where order_id=$1',[session.orderId])).rows[0]?.n,1);
    assert.equal((await carts.get(a.token)).lines.length,0);
    for(let i=0;i<8;i++){const batch=await checkout.runJobs();assert.equal(batch.failed,0);if(!batch.claimed)break;}assert.equal((await checkout.receipt(session.orderId,a.token)).notificationStatus,'unconfigured');
    // Recovery remains server-only; knowing an ID or wrong email cannot grant access.
    await assert.rejects(rpc('checkout_recover',{p_order_number:captured.orderNumber,p_email:'wrong@example.invalid',p_token_hash:hashGuestToken(b.token)}),/NOT_FOUND/);
    await rpc('checkout_recover',{p_order_number:captured.orderNumber,p_email:address.email,p_token_hash:hashGuestToken(b.token)});
    assert.equal((await checkout.receipt(session.orderId,b.token)).id,session.orderId);
    // Expired/cancelled and late capture require independent provider-state reconciliation.
    cart=await carts.get(a.token);cart=await carts.add(a.token,{variantId:variant,quantity:1,cartVersion:cart.version});
    const q2=await checkout.quote(a.token,{cartVersion:cart.version,address});const second=await checkout.start(a.token,q2.quoteId,'test-checkout-2');
    await checkout.refresh(second.orderId,a.token,null,true);assert.equal((await checkout.receipt(second.orderId,a.token)).orderStatus,'cancelled');
    await rpc('checkout_internal',{p_action:'fixturePayment',p_id:second.orderId,p_payload:{state:'captured'}});await checkout.reconcile(second.orderId);
    const late=await checkout.receipt(second.orderId,a.token);assert.equal(late.capturedPaise,late.totalPaise);assert.equal(late.attentionReason,'LATE_CAPTURE_REVIEW');assert.equal(late.fulfillmentStatus,'held');
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.inventory_movements where order_id=$1 and kind='sale'",[second.orderId])).rows[0]?.n,0);
    await db.exec('set role anon');await assert.rejects(db.query('select public.reserve_checkout(null,null,null,null)'),/permission denied/);await db.exec('reset role;set role authenticated');await assert.rejects(db.query('select public.apply_verified_payment(null,null,null)'),/permission denied/);await db.exec('reset role');
  }finally{await db.close();}
});
test("stale quotes and last-unit reservations cannot create competing orders; authorization holds stock",async()=>{
  process.env.APP_MODE='fixture';process.env.APP_URL='http://localhost:3000';const db=await createFixtureAdminDatabase();const rpc=<T=unknown>(n:string,a:Record<string,unknown>)=>executeFixtureRpc<T>(db,n,a);const carts=createCartService(rpc),checkout=createCheckoutService({rpc});
  try{
    await db.exec(fixtureCheckoutSql);const variant=(await db.query<{id:string}>("select v.id from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand>=10 order by v.id limit 1")).rows[0]!.id;
    await db.query('update public.inventory set on_hand=1 where variant_id=$1',[variant]);const a=await carts.create(undefined),b=await carts.create(undefined);
    const ca=await carts.add(a.token,{variantId:variant,quantity:1,cartVersion:1}),cb=await carts.add(b.token,{variantId:variant,quantity:1,cartVersion:1});
    const qa=await checkout.quote(a.token,{cartVersion:ca.version,address}),qb=await checkout.quote(b.token,{cartVersion:cb.version,address});
    const sa=await checkout.start(a.token,qa.quoteId,'last-unit-a');await assert.rejects(checkout.start(b.token,qb.quoteId,'last-unit-b'),/STOCK_CONFLICT/);
    await checkout.simulate(a.token,{orderId:sa.orderId,outcome:'authorized'});await checkout.refresh(sa.orderId,a.token,null,true);
    assert.equal((await checkout.receipt(sa.orderId,a.token)).paymentStatus,'authorized');assert.equal((await db.query<{reserved:number}>('select reserved from public.inventory where variant_id=$1',[variant])).rows[0]?.reserved,1);
    assert.equal((await db.query<{n:number}>('select count(*)::int n from public.orders')).rows[0]?.n,1);
  }finally{await db.close();}
});
