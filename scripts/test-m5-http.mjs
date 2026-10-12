import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Explicit local fixture-only smoke. Prepare an isolated DB using prepare:m5,
// start the app, then set M5_TEST_URL. This leaves sample records for UI review.
if (!process.env.M5_TEST_URL) throw Error('Set M5_TEST_URL to the prepared local fixture preview.');
const url = new URL(process.env.M5_TEST_URL);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
const origin = url.origin;
class Session {
  cookies = new Map();
  async raw(path, {method='GET',body,headers={}}={}) {
    const response = await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{...(method!=='GET'?{Origin:origin}:{}),...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    for(const cookie of response.headers.getSetCookie()) {const first=cookie.split(';')[0],i=first.indexOf('=');this.cookies.set(first.slice(0,i),first.slice(i+1));}
    return response;
  }
  async call(path,options={}) {
    const response=await this.raw(path,options),payload=await response.json();
    assert.equal(response.status,options.status??200,`${options.method??'GET'} ${path}: ${JSON.stringify(payload)}`);
    assert.match(response.headers.get('cache-control')??'',/no-store/);
    if(path.startsWith('/api/v1/admin/')||/\/orders\/[^/]+\/(tracking|returns|cancel)$/.test(path))assert.match(response.headers.get('x-robots-tag')??'',/noindex/);
    return response.ok?payload.data:payload.error;
  }
  async login(persona) {
    const response=await fetch(origin+'/api/v1/auth/fixture',{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:`persona=${persona}`});
    assert.equal(response.status,303,'Fixture identity switch unavailable; refusing nonfixture target.');
    for(const c of response.headers.getSetCookie()){const first=c.split(';')[0],i=first.indexOf('=');this.cookies.set(first.slice(0,i),first.slice(i+1));}
  }
}
const anon=new Session(),staff=new Session(),owner=new Session(),nonadmin=new Session();
const marker=await (await anon.raw('/track-order')).text();
assert.match(marker,/FIXTURE CHECKOUT/,'Refusing to mutate a nonfixture preview.');
await staff.login('staff');await owner.login('owner');await nonadmin.login('customer');
assert.equal((await anon.call('/api/v1/admin/orders',{status:401})).code,'UNAUTHENTICATED');
assert.equal((await nonadmin.call('/api/v1/admin/orders',{status:403})).code,'FORBIDDEN');
const products=(await anon.call('/api/v1/products?inStock=true')).items;
const variants=[];
for(const p of products.slice(0,4)){const product=await anon.call('/api/v1/products/'+p.slug);variants.push(...product.variants.filter(v=>v.available).map(v=>({...v,productId:product.id})));}
assert.ok(variants.length>=3);
let nextVariant=0;
const address={fullName:'M5 Fixture Shopper',phone:'9000000000',email:'m5-review@example.invalid',line1:'Local fixture only — do not deliver',line2:'M5 verification',city:'Bengaluru',stateCode:'KA',pincode:'560001',country:'IN'};
async function paidOrder(){
 const shopper=new Session(),initial=await shopper.call('/api/v1/cart',{method:'POST'}),variant=variants[nextVariant++%variants.length];
 const cart=await shopper.call('/api/v1/cart/items',{method:'POST',body:{variantId:variant.id,quantity:1,cartVersion:initial.version}});
 const q=await shopper.call('/api/v1/checkout/quote',{method:'POST',body:{cartVersion:cart.version,address}});
 const session=await shopper.call('/api/v1/checkout/sessions',{method:'POST',body:{quoteId:q.quoteId},headers:{'Idempotency-Key':randomUUID()},status:201});
 assert.equal(session.fixture,true);
 const receipt=await shopper.call('/api/v1/checkout/fixture',{method:'POST',body:{orderId:session.orderId,outcome:'captured'}});
 assert.equal(receipt.fulfillmentStatus,'ready');assert.equal(receipt.canCancel,true);
 return {id:session.orderId,shopper,variant,receipt};
}
const detail=id=>staff.call('/api/v1/admin/orders/'+id);
const parcel={weightG:1200,lengthCm:40,widthCm:30,heightCm:15};
async function book(order){const d=await detail(order.id);const q=await staff.call(`/api/v1/admin/orders/${order.id}/shipping-quotes`,{method:'POST',body:{...parcel,orderVersion:d.version}});const body={shippingQuoteId:q.quotes[0].id,orderVersion:q.orderVersion},key=randomUUID();const shipment=await staff.call(`/api/v1/admin/orders/${order.id}/shipments`,{method:'POST',body,headers:{'Idempotency-Key':key}});assert.equal((await staff.call(`/api/v1/admin/orders/${order.id}/shipments`,{method:'POST',body,headers:{'Idempotency-Key':key}})).id,shipment.id);return shipment;}
const action=(s,a)=>staff.call(`/api/v1/admin/shipments/${s.id}/${a}`,{method:'POST',body:{version:s.version},headers:{'Idempotency-Key':randomUUID()}});
const fixture=(s,body)=>staff.call(`/api/v1/admin/shipments/${s.id}/fixture`,{method:'POST',body});
const order=await paidOrder();const initial=await detail(order.id);
assert.equal(initial.items[0].quantity,1);assert.equal(initial.totalPaise,order.receipt.totalPaise);
const filtered=await staff.call('/api/v1/admin/orders?paymentStatus=captured&fulfillmentStatus=ready&search='+initial.orderNumber);
assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,order.id);
await anon.call(`/api/v1/orders/${order.id}/tracking`,{status:404});
await anon.call(`/api/v1/orders/${order.id}/returns`,{status:404});
await staff.call(`/api/v1/admin/orders/${order.id}/shipping-quotes`,{method:'POST',body:{...parcel,orderVersion:initial.version},headers:{Origin:'https://other.example'},status:403});
let ship=await book(order);assert.equal(ship.bookingStatus,'created');
ship=await action(ship,'assign-awb');assert.ok(ship.awb);const awb=ship.awb;
ship=await action(ship,'label');assert.equal(ship.labelReady,true);
await anon.call(`/api/v1/admin/shipments/${ship.id}/label`,{status:401});
const label=await staff.raw(`/api/v1/admin/shipments/${ship.id}/label`);assert.equal(label.status,200);assert.equal(label.headers.get('content-type'),'application/pdf');assert.match(label.headers.get('cache-control'),/no-store/);assert.equal(Buffer.from(await label.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
await fixture(ship,{action:'failPickupOnce'});ship=await staff.call(`/api/v1/admin/shipments/${ship.id}`);
ship=await action(ship,'pickup');assert.equal(ship.pickupStatus,'failed');
let ops=await owner.call('/api/v1/admin/operations');assert.ok(ops.operations.some(op=>op.shipmentId===ship.id&&op.status==='failed'));
ship=await action(ship,'pickup');assert.equal(ship.pickupStatus,'scheduled');assert.equal(ship.awb,awb);assert.equal(ship.operations.filter(op=>op.action==='create').length,1);
await fixture(ship,{action:'track',status:'delivered'});
const tracking=await order.shopper.call(`/api/v1/orders/${order.id}/tracking`);assert.equal(tracking.shipments[0].transitStatus,'delivered');assert.equal('costPaise'in tracking.shipments[0],false);
assert.equal((await order.shopper.call(`/api/v1/orders/${order.id}`)).canCancel,false);
assert.equal((await detail(order.id)).totalPaise,initial.totalPaise);
await order.shopper.call(`/api/v1/orders/${order.id}/cancel`,{method:'POST',body:{reason:'Too late fixture cancellation'},status:409});
console.log('PASS M5 HTTP: private filtered order snapshots, measured quote, one booking/AWB/label, failed pickup recovery, authoritative fixture tracking.');

const eligibility=await order.shopper.call(`/api/v1/orders/${order.id}/returns`);assert.equal(eligibility.eligible,true);assert.equal(eligibility.windowDays,14);
const requestBody={reason:'Fixture size review',items:[{orderItemId:eligibility.items[0].orderItemId,quantity:1}]};
let ret=await order.shopper.call(`/api/v1/orders/${order.id}/returns`,{method:'POST',body:requestBody});
const customerReturnId=ret.id;
await order.shopper.call(`/api/v1/orders/${order.id}/returns`,{method:'POST',body:requestBody,status:409});
async function returnAction(action,extra={}){ret=await staff.call(`/api/v1/admin/returns/${ret.id}`,{method:'PATCH',body:{action,version:ret.version,notes:'M5 local fixture review only',...extra}});return ret;}
await returnAction('approve');await returnAction('reverse',{reference:'FIXTURE-MANUAL-RETURN-ONLY'});
await returnAction('receive',{items:[{returnItemId:ret.items[0].id,receivedQuantity:1}]});
await returnAction('inspect',{items:[{returnItemId:ret.items[0].id,acceptedQuantity:1,disposition:'sellable'}]});
assert.equal(ret.items[0].restockQuantity,0);
const refundBody={amountPaise:100,reason:'Fixture partial refund',returnRequestId:ret.id};const refundKey=randomUUID();
await staff.call(`/api/v1/admin/orders/${order.id}/refunds`,{method:'POST',body:refundBody,headers:{'Idempotency-Key':refundKey},status:403});
let refund=await owner.call(`/api/v1/admin/orders/${order.id}/refunds`,{method:'POST',body:refundBody,headers:{'Idempotency-Key':refundKey}});
assert.equal(refund.status,'processing');
assert.equal((await owner.call(`/api/v1/admin/orders/${order.id}/refunds`,{method:'POST',body:refundBody,headers:{'Idempotency-Key':refundKey}})).id,refund.id);
let balance=await owner.call(`/api/v1/admin/orders/${order.id}/refunds`);assert.equal(balance.reservedPaise,100);assert.equal(balance.processedPaise,0);
assert.equal((await detail(order.id)).refundReservedPaise,100);
await owner.call(`/api/v1/admin/orders/${order.id}/refunds`,{method:'POST',body:{amountPaise:initial.capturedPaise,reason:'Exceeds reserved balance'},headers:{'Idempotency-Key':randomUUID()},status:409});
refund=await owner.call(`/api/v1/admin/refunds/${refund.id}/fixture`,{method:'POST',body:{outcome:'processed'}});assert.equal(refund.status,'processed');
assert.equal((await staff.call(`/api/v1/admin/returns/${ret.id}`)).items[0].restockQuantity,0,'Refund must not restock.');
const readStock=async()=>{const product=await staff.call('/api/v1/admin/products/'+order.variant.productId);return product.variants.find(v=>v.id===order.variant.id).inventory.onHand;};
const stockBefore=await readStock();
await returnAction('restock',{items:[{returnItemId:ret.items[0].id,quantity:1}]});assert.equal(ret.items[0].restockQuantity,1);
assert.equal(await readStock(),stockBefore+1);
await staff.call(`/api/v1/admin/returns/${ret.id}`,{method:'PATCH',body:{action:'restock',version:ret.version,notes:'Duplicate must fail',items:[{returnItemId:ret.items[0].id,quantity:1}]},status:409});
assert.equal(await readStock(),stockBefore+1);
balance=await owner.call(`/api/v1/admin/orders/${order.id}/refunds`);assert.equal(balance.processedPaise,100);assert.equal(balance.reservedPaise,0);
let finalRefund=await owner.call(`/api/v1/admin/orders/${order.id}/refunds`,{method:'POST',body:{amountPaise:balance.refundablePaise,reason:'Fixture remaining refund',returnRequestId:ret.id},headers:{'Idempotency-Key':randomUUID()}});
finalRefund=await owner.call(`/api/v1/admin/refunds/${finalRefund.id}/fixture`,{method:'POST',body:{outcome:'timeout'}});assert.equal(finalRefund.status,'unknown');
balance=await owner.call(`/api/v1/admin/orders/${order.id}/refunds`);assert.equal(balance.refundablePaise,0);
await staff.call(`/api/v1/admin/operations/${finalRefund.operationId}/retry`,{method:'POST',body:{reason:'Staff cannot reconcile refunds'},status:403});
await owner.call(`/api/v1/admin/refunds/${finalRefund.id}/fixture`,{method:'POST',body:{outcome:'processed'}});
await owner.call(`/api/v1/admin/refunds/${finalRefund.id}/fixture`,{method:'POST',body:{outcome:'processed'}});
const refunded=await detail(order.id);assert.equal(refunded.refundedPaise,refunded.capturedPaise);assert.equal(refunded.paymentStatus,'refunded');
console.log('PASS M5 HTTP: return eligibility/quantity bounds, manual reverse receipt/inspection, separate once-only restock, owner partial/full refund and unknown balance hold.');

const uncertain=await paidOrder();await staff.call(`/api/v1/admin/orders/${uncertain.id}/fixture`,{method:'POST',body:{action:'createTimeout'}});
let uncertainShip=await book(uncertain);assert.equal(uncertainShip.bookingStatus,'unknown');
const createOperation=uncertainShip.operations.find(o=>o.action==='create');
await staff.call(`/api/v1/admin/operations/${createOperation.id}/retry`,{method:'POST',body:{reason:'Fixture create timeout reconciliation'}});
uncertainShip=await staff.call(`/api/v1/admin/shipments/${uncertainShip.id}`);assert.equal(uncertainShip.bookingStatus,'created');assert.equal(uncertainShip.operations.find(o=>o.action==='create').attempts,1);
const cancelled=await uncertain.shopper.call(`/api/v1/orders/${uncertain.id}/cancel`,{method:'POST',body:{reason:'Fixture before pickup cancellation'}});assert.equal(cancelled.orderStatus,'cancelled');
assert.equal((await staff.call(`/api/v1/admin/shipments/${uncertainShip.id}`)).bookingStatus,'cancelled');
const rtoOrder=await paidOrder();let rtoShip=await book(rtoOrder);rtoShip=await action(rtoShip,'assign-awb');await fixture(rtoShip,{action:'track',status:'rto_delivered'});
const rtoDetail=await detail(rtoOrder.id);assert.ok(rtoDetail.attentionReason);assert.equal(rtoDetail.returns.length,0);
const rto=await staff.call(`/api/v1/admin/orders/${rtoOrder.id}/returns/rto`,{method:'POST',body:{reason:'Fixture RTO physical receipt expected',items:[{orderItemId:rtoDetail.items[0].id,quantity:1}]}});assert.equal(rto.kind,'rto');assert.equal(rto.items[0].restockQuantity,0);
await owner.call(`/api/v1/admin/orders/${rtoOrder.id}/resolve`,{method:'POST',body:{version:(await detail(rtoOrder.id)).version,reason:'Cannot erase unresolved RTO hold'},status:409});
ret=rto;
await returnAction('receive',{items:[{returnItemId:ret.items[0].id,receivedQuantity:1}]});
await returnAction('inspect',{items:[{returnItemId:ret.items[0].id,acceptedQuantity:1,disposition:'damaged'}]});
await staff.call(`/api/v1/admin/returns/${ret.id}`,{method:'PATCH',body:{action:'restock',version:ret.version,notes:'Damaged items must not restock',items:[{returnItemId:ret.items[0].id,quantity:1}]},status:409});
await owner.call(`/api/v1/admin/orders/${rtoOrder.id}/resolve`,{method:'POST',body:{version:(await detail(rtoOrder.id)).version,reason:'Refund still required before closing RTO'},status:409});
const rtoRefund=await owner.call(`/api/v1/admin/orders/${rtoOrder.id}/refunds`,{method:'POST',body:{amountPaise:rtoDetail.capturedPaise,reason:'Fixture inspected RTO refund',returnRequestId:ret.id},headers:{'Idempotency-Key':randomUUID()}});
await owner.call(`/api/v1/admin/refunds/${rtoRefund.id}/fixture`,{method:'POST',body:{outcome:'processed'}});
await owner.call(`/api/v1/admin/orders/${rtoOrder.id}/resolve`,{method:'POST',body:{version:(await detail(rtoOrder.id)).version,reason:'Inspected damaged RTO and confirmed full refund'}});
const closedRto=await detail(rtoOrder.id);assert.equal(closedRto.fulfillmentStatus,'returned');assert.equal(closedRto.attentionReason,null);assert.equal(closedRto.returns[0].items[0].restockQuantity,0);
for(const endpoint of ['/api/v1/webhooks/carrier','/api/v1/webhooks/shiprocket'])assert.equal((await anon.raw(endpoint,{method:'POST',body:{awb:rtoShip.awb,status:'DELIVERED'}})).status,404);
for(const page of ['/admin/orders',`/admin/orders/${order.id}`,'/admin/returns',`/admin/returns/${ret.id}`,'/admin/operations']){const response=await owner.raw(page);assert.equal(response.status,200,page);assert.doesNotMatch(await response.text(),/Application error/);}
console.log('PASS M5 HTTP: ambiguous create reconciliation, cancellation before collection, inspected/refunded RTO closure, conservative hold, provider webhook disabled, all admin pages render.');
console.log(JSON.stringify({review:{orderId:order.id,returnId:customerReturnId,cancelledOrderId:uncertain.id,rtoOrderId:rtoOrder.id,rtoReturnId:ret.id},origin}));
console.log('M5 fixture HTTP checks passed. Supabase, Razorpay Test Mode and real carrier acceptance remain unverified.');
