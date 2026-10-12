import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFixtureAdminDatabase,executeFixtureRpc} from '../src/lib/admin/db.ts';
import {fixtureCheckoutSql} from '../src/data/fixtures/checkout-seed.ts';
import {fixtureIdentities} from '../src/lib/auth/fixture.ts';
import {createCartService} from '../src/lib/cart/service.ts';
import {createCheckoutService} from '../src/lib/checkout/service.ts';
import {createShippingService} from '../src/lib/fulfillment/shipping-service.ts';
import {createReturnsService} from '../src/lib/fulfillment/returns-service.ts';
import {adminOrderListSchema,orderDetailBaseSchema,operationsSchema} from '../src/lib/fulfillment/admin-contracts.ts';
const owner=fixtureIdentities.owner.id,staff=fixtureIdentities.staff.id,customer=fixtureIdentities.customer.id;
const reason='Reviewed the recorded provider result';
const address={fullName:'Fixture Shopper',phone:'9000000000',email:'shopper@example.invalid',line1:'Fixture address',line2:'',city:'Fixture City',stateCode:'KA',pincode:'560001',country:'IN'};
async function setup(quantity=1){
 process.env.APP_MODE='fixture';process.env.APP_URL='http://localhost:3000';const db=await createFixtureAdminDatabase();await db.exec(fixtureCheckoutSql);
 const rpc=<T=unknown>(name:string,args:Record<string,unknown>)=>executeFixtureRpc<T>(db,name,args);
 const cart=createCartService(rpc),checkout=createCheckoutService({rpc}),shipping=createShippingService({rpc});
 const variant=(await db.query<{id:string}>('select v.id from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand>10 order by v.id limit 1')).rows[0]!.id;
 const guest=await cart.create(undefined),c=await cart.add(guest.token,{variantId:variant,quantity,cartVersion:1}),q=await checkout.quote(guest.token,{cartVersion:c.version,address}),session=await checkout.start(guest.token,q.quoteId,'fulfillment-admin-checkout');
 await checkout.simulate(guest.token,{orderId:session.orderId,outcome:'captured'});
 return {db,rpc,shipping,checkout,returns:createReturnsService({rpc,reconcilePayment:checkout.reconcile}),orderId:session.orderId,paymentId:session.paymentAttemptId,variant};
}
test('fulfillment admin list/detail/operations compile, validate DTOs and enforce membership',async()=>{
 const {db,rpc,shipping,orderId}=await setup();try{
  const list=adminOrderListSchema.parse(await rpc('fulfillment_admin_orders',{p_actor:staff,p_filters:{}}));assert.equal(list.total,1);assert.equal(list.items[0]!.id,orderId);assert.equal('address' in list.items[0]!,false);
  const exact=adminOrderListSchema.parse(await rpc('fulfillment_admin_orders',{p_actor:staff,p_filters:{search:list.items[0]!.orderNumber,paymentStatus:'captured',fulfillmentStatus:'ready',attention:false}}));assert.equal(exact.total,1);
  assert.equal(adminOrderListSchema.parse(await rpc('fulfillment_admin_orders',{p_actor:staff,p_filters:{paymentStatus:'unpaid'}})).total,0);
  assert.equal(adminOrderListSchema.parse(await rpc('fulfillment_admin_orders',{p_actor:staff,p_filters:{page:2}})).items.length,0);
  await assert.rejects(rpc('fulfillment_admin_orders',{p_actor:staff,p_filters:{untrustedField:true}}),/INVALID_PAYLOAD/);
  const detail=orderDetailBaseSchema.parse(await rpc('fulfillment_admin_order',{p_actor:staff,p_order_id:orderId}));assert.equal(detail.email,address.email);assert.equal(detail.items.length,1);assert.equal(detail.refundablePaise,detail.capturedPaise);assert.equal(detail.refundReservedPaise,0);
  const q=await shipping.quotes(staff,orderId,{orderVersion:detail.version,weightG:1200,lengthCm:40,widthCm:30,heightCm:15});await shipping.fixture(staff,orderId,{action:'createTimeout'});const shipment=await shipping.book(staff,orderId,{shippingQuoteId:q.quotes[0]!.id,orderVersion:q.orderVersion},'admin-unknown-shipping');
  const queue=operationsSchema.parse(await rpc('fulfillment_operations',{p_actor:staff}));assert.equal(queue.heldOrders[0]!.id,orderId);const shippingOp=queue.operations.find(o=>o.shipmentId===shipment.id)!;assert.equal(shippingOp.orderId,orderId);assert.equal(shippingOp.status,'unknown');
  const target=await rpc('fulfillment_operation_target',{p_actor:staff,p_id:shippingOp.id,p_reason:reason});assert.deepEqual(target,{orderId,shipmentId:shipment.id,refundId:null});
  for(const [name,args] of [['fulfillment_admin_orders',{}],['fulfillment_admin_order',{p_order_id:orderId}],['fulfillment_operations',{}]] as const)await assert.rejects(rpc(name,{p_actor:customer,...args}),/FORBIDDEN/);
  await db.query('update public.admin_memberships set enabled=false where user_id=$1',[staff]);await assert.rejects(rpc('fulfillment_operations',{p_actor:staff}),/FORBIDDEN/);
  await db.exec('set role anon');await assert.rejects(db.query('select public.fulfillment_admin_orders($1)',[owner]),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
test('owner resolutions preserve uncertainty and audited job retries enforce role and state',async()=>{
 const {db,rpc,orderId,paymentId}=await setup();try{
  await db.query("update public.orders set payment_status='partially_refunded',refunded_paise=100,fulfillment_status='held',attention_reason='REFUND_REVIEW' where id=$1",[orderId]);
  const get=async()=>orderDetailBaseSchema.parse(await rpc('fulfillment_admin_order',{p_actor:owner,p_order_id:orderId}));let detail=await get();
  await assert.rejects(rpc('fulfillment_resolve',{p_actor:staff,p_order_id:orderId,p_version:detail.version,p_reason:reason}),/FORBIDDEN/);
  await assert.rejects(rpc('fulfillment_resolve',{p_actor:owner,p_order_id:orderId,p_version:detail.version+1,p_reason:reason}),/VERSION_CONFLICT/);
  const providerPaymentId=(await db.query<{provider_payment_id:string}>('select provider_payment_id from public.payment_attempts where id=$1',[paymentId])).rows[0]!.provider_payment_id;
  await db.query("insert into public.provider_refund_observations(mode,provider_refund_id,provider_payment_id,order_id,amount_paise,status) values('test','rfnd_admin_pending',$1,$2,200,'pending')",[providerPaymentId,orderId]);
  detail=await get();assert.equal(detail.refundReservedPaise,200);assert.equal(detail.refundablePaise,detail.capturedPaise-300);
  await assert.rejects(rpc('fulfillment_resolve',{p_actor:owner,p_order_id:orderId,p_version:detail.version,p_reason:reason}),/RECONCILIATION_REQUIRED/);
  await db.query("update public.provider_refund_observations set status='failed' where provider_refund_id='rfnd_admin_pending'");
  await rpc('fulfillment_resolve',{p_actor:owner,p_order_id:orderId,p_version:detail.version,p_reason:reason});detail=await get();assert.equal(detail.attentionReason,null);assert.equal(detail.fulfillmentStatus,'ready');assert.ok(detail.audit.some(a=>a.action==='order.resolve'));
  await db.query("update public.orders set attention_reason='PAYMENT_MISMATCH',fulfillment_status='held' where id=$1",[orderId]);detail=await get();await assert.rejects(rpc('fulfillment_resolve',{p_actor:owner,p_order_id:orderId,p_version:detail.version,p_reason:reason}),/RECONCILIATION_REQUIRED/);
  const job=await rpc<{id:string}>('enqueue_job',{p_type:'shipping.sync',p_dedupe_key:'admin-job-retry',p_payload:{shipmentId:'00000000-0000-4000-8000-000000000001'}});
  await assert.rejects(rpc('fulfillment_retry_job',{p_actor:staff,p_id:job.id,p_reason:reason}),/OPERATION_BUSY/);await db.query("update public.jobs set state='dead',attempts=max_attempts,last_error='UPSTREAM_UNKNOWN' where id=$1",[job.id]);await rpc('fulfillment_retry_job',{p_actor:staff,p_id:job.id,p_reason:reason});assert.deepEqual((await db.query('select state,attempts,last_error from public.jobs where id=$1',[job.id])).rows[0],{state:'queued',attempts:0,last_error:null});
  const refundJob=await rpc<{id:string}>('enqueue_job',{p_type:'refund.reconcile',p_dedupe_key:'admin-refund-job',p_payload:{refundId:'00000000-0000-4000-8000-000000000001'}});await db.query("update public.jobs set state='retry' where id=$1",[refundJob.id]);await assert.rejects(rpc('fulfillment_retry_job',{p_actor:staff,p_id:refundJob.id,p_reason:reason}),/FORBIDDEN/);await rpc('fulfillment_retry_job',{p_actor:owner,p_id:refundJob.id,p_reason:reason});const cancellationJob=await rpc<{id:string}>('enqueue_job',{p_type:'order.cancel',p_dedupe_key:'admin-cancellation-job',p_payload:{orderId}});await db.query("update public.jobs set state='dead',attempts=max_attempts,last_error='RECONCILIATION_REQUIRED' where id=$1",[cancellationJob.id]);await rpc('fulfillment_retry_job',{p_actor:staff,p_id:cancellationJob.id,p_reason:reason});assert.deepEqual((await db.query('select state,attempts,last_error from public.jobs where id=$1',[cancellationJob.id])).rows[0],{state:'queued',attempts:0,last_error:null});assert.equal((await db.query<{n:number}>("select count(*)::int n from public.audit_logs where action='job.retry'",[])).rows[0]!.n,3);
 }finally{await db.close();}
});

async function returnedParcel(quantity:number){
 const h=await setup(quantity);
 const detail=async()=>orderDetailBaseSchema.parse(await h.rpc('fulfillment_admin_order',{p_actor:owner,p_order_id:h.orderId}));
 const before=await detail(),item=before.items[0]!;
 const q=await h.shipping.quotes(staff,h.orderId,{orderVersion:before.version,weightG:3000,lengthCm:40,widthCm:30,heightCm:15});
 let shipment=await h.shipping.book(staff,h.orderId,{shippingQuoteId:q.quotes[0]!.id,orderVersion:q.orderVersion},'rto-resolution-shipment');
 shipment=await h.shipping.action(staff,shipment.id,'assign-awb',{version:shipment.version},'rto-resolution-awb');
 await h.shipping.fixture(staff,shipment.id,{action:'track',status:'rto_in_transit'});
 await h.shipping.fixture(staff,shipment.id,{action:'track',status:'rto_delivered'});
 assert.equal((await detail()).attentionReason,'DELIVERY_EXCEPTION');
 const resolve=async(actor:string=owner,version?:number)=>h.rpc('fulfillment_resolve',{p_actor:actor,p_order_id:h.orderId,p_version:version??(await detail()).version,p_reason:reason});
 const stock=async()=>(await h.db.query<{on_hand:number}>('select on_hand from public.inventory where variant_id=$1',[h.variant])).rows[0]!.on_hand;
 const movements=async()=>(await h.db.query<{n:number}>('select count(*)::int n from public.inventory_movements where order_id=$1',[h.orderId])).rows[0]!.n;
 return {...h,detail,resolve,stock,movements,item,shipment};
}

test('RTO resolution needs every received and inspected unit, sellable restock, confirmed money and a clear owner-reviewed hold',async()=>{
 const h=await returnedParcel(2);try{
  const soldStock=await h.stock();
  const refund=await h.returns.refund(owner,h.orderId,{amountPaise:(await h.detail()).capturedPaise,reason:'Full refund for returned failed delivery'},'rto-complete-refund');
  await h.returns.fixtureRefund(owner,refund.id,{outcome:'processed'});
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'carrier return scan and refund do not establish physical receipt');
  assert.equal(await h.stock(),soldStock);

  let damaged=await h.returns.createRto(staff,h.orderId,{reason:'Two units expected from carrier',items:[{orderItemId:h.item.id,quantity:2}]});
  damaged=await h.returns.adminAction(staff,damaged.id,{action:'receive',version:damaged.version,notes:'One unit physically received; second unit missing',items:[{returnItemId:damaged.items[0]!.id,receivedQuantity:1}]});
  await h.returns.adminAction(staff,damaged.id,{action:'inspect',version:damaged.version,notes:'Received unit inspected with transit damage',items:[{returnItemId:damaged.items[0]!.id,acceptedQuantity:1,disposition:'damaged'}]});
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'requested quantity cannot substitute for physically received quantity');

  let sellable=await h.returns.createRto(staff,h.orderId,{reason:'Missing unit arrived in a separate carrier bag',items:[{orderItemId:h.item.id,quantity:1}]});
  sellable=await h.returns.adminAction(staff,sellable.id,{action:'receive',version:sellable.version,notes:'Second unit physically received',items:[{returnItemId:sellable.items[0]!.id,receivedQuantity:1}]});
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'receipt needs recorded final inspection');
  sellable=await h.returns.adminAction(staff,sellable.id,{action:'inspect',version:sellable.version,notes:'Second unit inspected and sellable',items:[{returnItemId:sellable.items[0]!.id,acceptedQuantity:1,disposition:'sellable'}]});
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'accepted sellable units need explicit restock');
  await h.returns.adminAction(staff,sellable.id,{action:'restock',version:sellable.version,notes:'Return sellable unit to inventory',items:[{returnItemId:sellable.items[0]!.id,quantity:1}]});
  assert.equal(await h.stock(),soldStock+1,'damaged unit stays out of sellable stock');
  await assert.rejects(h.resolve(staff),/FORBIDDEN/);

  await h.db.query("update public.orders set attention_reason='PAYMENT_MISMATCH' where id=$1",[h.orderId]);
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'completed RTO must preserve unrelated financial holds');
  await h.db.query("update public.orders set attention_reason='DELIVERY_EXCEPTION' where id=$1",[h.orderId]);
  await h.db.query("update public.provider_refund_observations set status='failed' where order_id=$1",[h.orderId]);
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'order refund counter alone is not provider confirmation');
  await h.db.query("update public.provider_refund_observations set status='processed' where order_id=$1",[h.orderId]);
  const payment=(await h.db.query<{provider_payment_id:string;idempotency_operation_id:string}>('select provider_payment_id,idempotency_operation_id from public.payment_attempts where id=$1',[h.paymentId])).rows[0]!;
  await h.db.query("insert into public.provider_refund_observations(mode,provider_refund_id,provider_payment_id,order_id,amount_paise,status) values('test','rfnd_rto_external_pending',$1,$2,100,'pending')",[payment.provider_payment_id,h.orderId]);
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'pending external provider money remains unresolved');
  await h.db.query("update public.provider_refund_observations set status='failed' where provider_refund_id='rfnd_rto_external_pending'");
  const shippingOperation=(await h.db.query<{operation_id:string}>('select operation_id from public.shipping_operations where shipment_id=$1 limit 1',[h.shipment.id])).rows[0]!.operation_id;
  for(const operation of [payment.idempotency_operation_id,refund.operationId,shippingOperation]){
   await h.db.query("update public.external_operations set status='unknown' where id=$1",[operation]);
   await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'unknown provider operations cannot be cleared manually');
   await h.db.query("update public.external_operations set status='succeeded' where id=$1",[operation]);
  }

  const before=await h.detail(),movementCount=await h.movements();
  await h.resolve(owner,before.version);
  const closed=await h.detail();assert.equal(closed.fulfillmentStatus,'returned');assert.equal(closed.attentionReason,null);assert.equal(closed.paymentStatus,'refunded');
  assert.ok(closed.audit.some(a=>a.action==='order.resolve'&&a.actor==='owner'&&a.reason===reason));
  await assert.rejects(h.resolve(owner,before.version),/VERSION_CONFLICT/);
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/);
  await h.checkout.reconcile(h.orderId);
  assert.equal((await h.detail()).fulfillmentStatus,'returned');assert.equal(await h.stock(),soldStock+1);assert.equal(await h.movements(),movementCount,'resolution and its replay never create inventory movements');
 }finally{await h.db.close();}
});

test('physically completed RTO stays held through partial and pending refunds until the full captured amount is confirmed',async()=>{
 const h=await returnedParcel(1);try{
  let r=await h.returns.createRto(staff,h.orderId,{reason:'Carrier returned whole order',items:[{orderItemId:h.item.id,quantity:1}]});
  r=await h.returns.adminAction(staff,r.id,{action:'receive',version:r.version,notes:'All ordered units received',items:[{returnItemId:r.items[0]!.id,receivedQuantity:1}]});
  r=await h.returns.adminAction(staff,r.id,{action:'inspect',version:r.version,notes:'All ordered units inspected sellable',items:[{returnItemId:r.items[0]!.id,acceptedQuantity:1,disposition:'sellable'}]});
  await h.returns.adminAction(staff,r.id,{action:'restock',version:r.version,notes:'Return all accepted units to stock',items:[{returnItemId:r.items[0]!.id,quantity:1}]});
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'physical completion does not refund money');
  const first=await h.returns.refund(owner,h.orderId,{amountPaise:(await h.detail()).capturedPaise-100,reason:'Partial RTO refund',returnRequestId:r.id},'rto-partial-refund');
  await h.returns.fixtureRefund(owner,first.id,{outcome:'processed'});
  await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'partial confirmation is not a complete RTO refund');
  const remaining=await h.returns.refund(owner,h.orderId,{amountPaise:100,reason:'Remaining RTO balance',returnRequestId:r.id},'rto-remaining-refund');
  assert.equal(remaining.status,'processing');await assert.rejects(h.resolve(),/RECONCILIATION_REQUIRED/,'reserved pending refund is not processed money');
  await h.returns.fixtureRefund(owner,remaining.id,{outcome:'processed'});
  const stock=await h.stock(),movementCount=await h.movements();await h.resolve();
  assert.equal((await h.detail()).fulfillmentStatus,'returned');assert.equal((await h.detail()).attentionReason,null);assert.equal(await h.stock(),stock);assert.equal(await h.movements(),movementCount);
 }finally{await h.db.close();}
});
