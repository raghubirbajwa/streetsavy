import assert from 'node:assert/strict';
import test from 'node:test';
import {createFixtureAdminDatabase,executeFixtureRpc} from '../src/lib/admin/db.ts';
import {fixtureCheckoutSql} from '../src/data/fixtures/checkout-seed.ts';
import {fixtureIdentities} from '../src/lib/auth/fixture.ts';
import {createCartService} from '../src/lib/cart/service.ts';
import {createCheckoutService} from '../src/lib/checkout/service.ts';
import {createReturnsService} from '../src/lib/fulfillment/returns-service.ts';
import {readEnvironment} from '../src/config/env.ts';
import type {RefundProvider,RefundObservation} from '../src/lib/fulfillment/refund-provider.ts';
const owner=fixtureIdentities.owner.id,staff=fixtureIdentities.staff.id;
async function harness(quantity=3,capture=true){
 process.env.APP_MODE='fixture';process.env.APP_URL='http://localhost:3000';
 const db=await createFixtureAdminDatabase();
 try{
  await db.exec(fixtureCheckoutSql);
  await db.exec("update public.store_settings set value=jsonb_set(value,'{returnWindowDays}','14') where key='commerce'");
  const rpc=<T=unknown>(name:string,args:Record<string,unknown>)=>executeFixtureRpc<T>(db,name,args);
  const checkout=createCheckoutService({rpc}),carts=createCartService(rpc);
  const variant=(await db.query<{id:string}>('select variant_id id from public.inventory where on_hand>=10 order by variant_id limit 1')).rows[0]!.id;
  const stock=async()=>(await db.query<{on_hand:number}>('select on_hand from public.inventory where variant_id=$1',[variant])).rows[0]!.on_hand;
  const initial=await stock();const guest=await carts.create(undefined),cart=await carts.add(guest.token,{variantId:variant,quantity,cartVersion:1});
  const quote=await checkout.quote(guest.token,{cartVersion:cart.version,address:{fullName:'Returns fixture',phone:'9000000000',email:'returns@example.invalid',line1:'Fixture address',city:'Fixture City',stateCode:'KA',pincode:'560001',country:'IN'}});
  const session=await checkout.start(guest.token,quote.quoteId,'returns-fixture-payment');if(capture)await checkout.simulate(guest.token,{orderId:session.orderId,outcome:'captured'});
  const receipt=await checkout.receipt(session.orderId,guest.token),item=receipt.items[0]!;
  const service=createReturnsService({rpc,reconcilePayment:checkout.reconcile,cancelShipping:async()=> 'clear'});
  async function delivered(status='delivered'){
   const shipment=(await db.query<{id:string}>("insert into public.shipments(order_id,direction,booking_status,pickup_status,transit_status,actual_weight_g,length_cm,width_cm,height_cm,quoted_cost_paise,fixture) values($1,'forward','awb_assigned','picked_up',$2,1500,40,30,15,7500,true) returning id",[session.orderId,status])).rows[0]!.id;
   await db.query("insert into public.shipment_events(shipment_id,environment,raw_status,normalized_status,occurred_at,source) values($1,'test',$2,$2,now(),'fixture')",[shipment,status]);
   await db.query('update public.orders set fulfillment_status=$2 where id=$1',[session.orderId,status==='delivered'?'delivered':'held']);
   return shipment;
  }
  return {db,rpc,checkout,service,session,guest,item,stock,initial,delivered};
 }catch(error){await db.close();throw error;}
}

test('customer return ownership, delivery policy, overlapping quantities and inspection gate stock changes',async()=>{
 const h=await harness();try{
  const input={items:[{orderItemId:h.item.id,quantity:2}],reason:'The size does not fit'};
  await assert.rejects(h.service.request(h.session.orderId,h.guest.token,input),/RETURN_INELIGIBLE/);
  await h.delivered();await assert.rejects(h.service.request(h.session.orderId,undefined,input),/NOT_FOUND/);
  let request=await h.service.request(h.session.orderId,h.guest.token,input);
  await assert.rejects(h.service.request(h.session.orderId,h.guest.token,input),/RETURN_QUANTITY_CONFLICT/);
  const eligibility=await h.service.eligibility(h.session.orderId,h.guest.token);assert.equal(eligibility.items[0]!.returnableQuantity,1);
  await assert.rejects(h.service.adminAction(fixtureIdentities.customer.id,request.id,{action:'approve',version:request.version,notes:'Approved return'}),/FORBIDDEN/);
  request=await h.service.adminAction(staff,request.id,{action:'approve',version:request.version,notes:'Approved eligible return'});
  await assert.rejects(h.service.adminAction(staff,request.id,{action:'approve',version:1,notes:'Old browser tab'}),/VERSION_CONFLICT/);
  await assert.rejects(h.service.adminAction(staff,request.id,{action:'restock',version:request.version,notes:'Unsafe early stock',items:[{returnItemId:request.items[0]!.id,quantity:1}]}),/RETURN_STATE_CONFLICT/);
  request=await h.service.adminAction(staff,request.id,{action:'reverse',version:request.version,reference:'MANUAL-RETURN-001',notes:'Arranged return through dashboard'});
  request=await h.service.adminAction(staff,request.id,{action:'receive',version:request.version,notes:'Only one physical unit received',items:[{returnItemId:request.items[0]!.id,receivedQuantity:1}]});
  await assert.rejects(h.service.adminAction(staff,request.id,{action:'inspect',version:request.version,notes:'Cannot accept an absent unit',items:[{returnItemId:request.items[0]!.id,acceptedQuantity:2,disposition:'sellable'}]}),/RETURN_QUANTITY_CONFLICT/);
  request=await h.service.adminAction(staff,request.id,{action:'inspect',version:request.version,notes:'One unit inspected and sellable',items:[{returnItemId:request.items[0]!.id,acceptedQuantity:1,disposition:'sellable'}]});
  assert.equal(await h.stock(),h.initial-3);assert.equal((await h.service.eligibility(h.session.orderId,h.guest.token)).items[0]!.returnableQuantity,2,'inspected request reserves only physically received units; missing unit remains returnable');
  const restock={action:'restock',version:request.version,notes:'Move inspected unit into stock',items:[{returnItemId:request.items[0]!.id,quantity:1}]};
  request=await h.service.adminAction(staff,request.id,restock);assert.equal(await h.stock(),h.initial-2);
  await assert.rejects(h.service.adminAction(staff,request.id,restock),/VERSION_CONFLICT/);
  await assert.rejects(h.service.adminAction(staff,request.id,{...restock,version:request.version}),/RETURN_QUANTITY_CONFLICT/);
  await h.checkout.reconcile(h.session.orderId);assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).fulfillmentStatus,'delivered');
 }finally{await h.db.close();}
});

test('RTO delivery tracking alone never restocks and damaged receipt is not sellable',async()=>{
 const h=await harness(1);try{
  await h.delivered('rto_delivered');assert.equal(await h.stock(),h.initial-1);
  let r=await h.service.createRto(staff,h.session.orderId,{reason:'Carrier returned failed delivery',items:[{orderItemId:h.item.id,quantity:1}]});assert.equal(r.kind,'rto');
  r=await h.service.adminAction(staff,r.id,{action:'receive',version:r.version,notes:'Warehouse physically received parcel',items:[{returnItemId:r.items[0]!.id,receivedQuantity:1}]});
  r=await h.service.adminAction(staff,r.id,{action:'inspect',version:r.version,notes:'Item damaged during transit',items:[{returnItemId:r.items[0]!.id,acceptedQuantity:1,disposition:'damaged'}]});
  await assert.rejects(h.service.adminAction(staff,r.id,{action:'restock',version:r.version,notes:'Cannot restock damaged goods',items:[{returnItemId:r.items[0]!.id,quantity:1}]}),/RETURN_QUANTITY_CONFLICT/);
  assert.equal(await h.stock(),h.initial-1);
 }finally{await h.db.close();}
});

test('owner refunds reserve remaining balance, confirm once, and partial refund leaves fulfillment intact',async()=>{
 const h=await harness(1);try{
  await assert.rejects(h.service.refund(staff,h.session.orderId,{amountPaise:100,reason:'Staff must not refund'},'staff-refund-test'),/FORBIDDEN/);
  const total=h.session.amountPaise;
  const first=await h.service.refund(owner,h.session.orderId,{amountPaise:total-100,reason:'First partial refund'},'first-partial-refund');assert.equal(first.status,'processing');
  await assert.rejects(h.service.refund(owner,h.session.orderId,{amountPaise:200,reason:'Excess second refund'},'second-excess-refund'),/REFUND_BALANCE_EXCEEDED/);
  const summary=await h.service.refundSummary(owner,h.session.orderId);assert.equal(summary.reservedPaise,total-100);assert.equal(summary.refundablePaise,100);assert.equal(summary.processedPaise,0);
  const confirmed=await h.service.fixtureRefund(owner,first.id,{outcome:'processed'});assert.equal(confirmed.status,'processed');
  await h.service.fixtureRefund(owner,first.id,{outcome:'processed'});assert.equal((await h.service.refundSummary(owner,h.session.orderId)).processedPaise,total-100);
  assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).fulfillmentStatus,'ready');
  await h.checkout.reconcile(h.session.orderId);assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).fulfillmentStatus,'ready');assert.equal(await h.stock(),h.initial-1);
  const retry=await h.service.refund(owner,h.session.orderId,{amountPaise:total-100,reason:'First partial refund'},'first-partial-refund');assert.equal(retry.id,first.id);
  await assert.rejects(h.service.refund(owner,h.session.orderId,{amountPaise:100,reason:'Changed payload'},'first-partial-refund'),/IDEMPOTENCY_CONFLICT/);
 }finally{await h.db.close();}
});

test('ambiguous refund create is queried by correlation and never sent twice, even if not found',async()=>{
 const h=await harness(1);try{
  await h.db.query('update public.orders set fixture=false where id=$1',[h.session.orderId]);
  const env=readEnvironment({APP_MODE:'test',APP_URL:'http://localhost:3000',RAZORPAY_KEY_ID:'rzp_test_refundunit',RAZORPAY_KEY_SECRET:'local-test-only'});
  let createCount=0,findCount=0,found:RefundObservation|null=null;
  const paymentId=(await h.db.query<{id:string}>('select provider_payment_id id from public.payment_attempts where order_id=$1',[h.session.orderId])).rows[0]!.id;
  const provider:RefundProvider={mode:'test',async create(_payment,id,amount){createCount++;found={id:'rfnd_ambiguous',payment_id:paymentId,amount,currency:'INR',status:'pending',receipt:`rf_${id.replaceAll('-','')}`};throw new Error('Network response lost');},async find(){findCount++;return null;},async get(){assert.ok(found);return found;}};
  const service=createReturnsService({rpc:h.rpc,env,provider});
  const refund=await service.refund(owner,h.session.orderId,{amountPaise:100,reason:'Refund lost response'},'refund-lost-response');assert.equal(refund.status,'unknown');
  await service.reconcileRefund(owner,refund.id);assert.equal(createCount,1);assert.equal(findCount,1);assert.equal((await service.refundSummary(owner,h.session.orderId)).reservedPaise,100);
  provider.find=async()=>{findCount++;return found;};assert.equal((await service.reconcileRefund(owner,refund.id)).status,'processing');assert.equal(createCount,1);
  found={...found!,status:'processed'};assert.equal((await service.reconcileRefund(owner,refund.id)).status,'processed');assert.equal(createCount,1);
  assert.equal(await h.stock(),h.initial-1);
 }finally{await h.db.close();}
});

test('prepickup cancellation blocks dispatch and restocks captured unshipped units once; pickup blocks cancellation',async()=>{
 const h=await harness(1);try{
  assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).canCancel,true,'paid uncollected receipt exposes cancellation');
  await h.db.query("update public.orders set attention_reason='PAYMENT_MISMATCH' where id=$1",[h.session.orderId]);assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).canCancel,false);
  await h.db.query('update public.orders set attention_reason=null where id=$1',[h.session.orderId]);
  const result=await h.service.cancelCustomer(h.session.orderId,h.guest.token,{reason:'No longer need this order'});assert.equal(result.status,'cancelled');assert.equal(result.refundRequired,true);assert.equal(await h.stock(),h.initial);assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).canCancel,false);
  await h.service.cancelCustomer(h.session.orderId,h.guest.token,{reason:'Repeat cancellation request'});assert.equal(await h.stock(),h.initial);assert.equal((await h.service.runJobs()).done,1);
  await h.checkout.reconcile(h.session.orderId);assert.equal(await h.stock(),h.initial);assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).fulfillmentStatus,'cancelled');
 }finally{await h.db.close();}
 const collected=await harness(1);try{await collected.delivered('in_transit');assert.equal((await collected.checkout.receipt(collected.session.orderId,collected.guest.token)).canCancel,false,'collected shipment blocks receipt cancellation');await assert.rejects(collected.service.cancelAdmin(staff,collected.session.orderId,{reason:'Cannot cancel collected parcel'}),/CANCELLATION_TOO_LATE/);assert.equal(await collected.stock(),collected.initial-1);}finally{await collected.db.close();}
});

test('concurrent partial refunds cannot over-reserve, including externally observed pending refunds',async()=>{
 const h=await harness(1);try{
  const amount=h.session.amountPaise-100;
  const attempts=await Promise.allSettled([h.service.refund(owner,h.session.orderId,{amountPaise:amount,reason:'First simultaneous refund'},'concurrent-refund-one'),h.service.refund(owner,h.session.orderId,{amountPaise:amount,reason:'Second simultaneous refund'},'concurrent-refund-two')]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
  const first=attempts.find(x=>x.status==='fulfilled');assert.equal(first?.status,'fulfilled');if(first?.status!=='fulfilled')throw new Error('Missing refund');
  await h.service.fixtureRefund(owner,first.value.id,{outcome:'failed'});
  const paymentId=(await h.db.query<{id:string}>('select provider_payment_id id from public.payment_attempts where order_id=$1',[h.session.orderId])).rows[0]!.id;
  await h.db.query("insert into public.provider_refund_observations(mode,provider_refund_id,provider_payment_id,order_id,amount_paise,status) values('test','rfnd_dashboard',$1,$2,$3,'pending')",[paymentId,h.session.orderId,amount]);
  assert.equal((await h.service.refundSummary(owner,h.session.orderId)).refundablePaise,100);
  await assert.rejects(h.service.refund(owner,h.session.orderId,{amountPaise:200,reason:'Cannot spend pending dashboard refund'},'dashboard-cap-test'),/REFUND_BALANCE_EXCEEDED/);
 }finally{await h.db.close();}
});

test('return policy closure and mode isolation deny mutations; browser roles cannot execute private refund RPCs',async()=>{
 const h=await harness(1);try{
  await h.delivered();await h.db.exec("update public.store_settings set value=jsonb_set(value,'{returnWindowDays}','0') where key='commerce'");
  assert.equal((await h.service.eligibility(h.session.orderId,h.guest.token)).eligible,false);
  await assert.rejects(h.service.request(h.session.orderId,h.guest.token,{reason:'Return policy is disabled',items:[{orderItemId:h.item.id,quantity:1}]}),/RETURN_INELIGIBLE/);
  const privileges=(await h.db.query<{anon:boolean;authenticated:boolean}>("select has_function_privilege('anon','public.refunds_reserve(uuid,uuid,jsonb,text,text,boolean)','execute') anon,has_function_privilege('authenticated','public.refunds_reserve(uuid,uuid,jsonb,text,text,boolean)','execute') authenticated")).rows[0]!;assert.deepEqual(privileges,{anon:false,authenticated:false});
  await h.db.query('update public.admin_memberships set enabled=false where user_id=$1',[owner]);await assert.rejects(h.service.refund(owner,h.session.orderId,{amountPaise:100,reason:'Revoked membership'},'revoked-refund-key'),/FORBIDDEN/);
  await h.db.query('update public.orders set fixture=false where id=$1',[h.session.orderId]);await assert.rejects(h.service.createRto(staff,h.session.orderId,{reason:'Wrong mode call',items:[{orderItemId:h.item.id,quantity:1}]}),/FORBIDDEN/);
 }finally{await h.db.close();}
});

test('uncertain cancellation retains sold stock and a durable job finishes once provider becomes clear',async()=>{
 const h=await harness(1);try{
  let clear=false;const service=createReturnsService({rpc:h.rpc,reconcilePayment:h.checkout.reconcile,cancelShipping:async()=>clear?'clear':'unknown'});
  const first=await service.cancelCustomer(h.session.orderId,h.guest.token,{reason:'Cancel while carrier status unknown'});assert.equal(first.status,'pending');assert.equal(await h.stock(),h.initial-1);
  clear=true;const jobs=await service.runJobs();assert.equal(jobs.done,1);assert.equal(jobs.failed,0);assert.equal(await h.stock(),h.initial);
  assert.equal((await h.checkout.receipt(h.session.orderId,h.guest.token)).orderStatus,'cancelled');
  await service.runJobs();assert.equal(await h.stock(),h.initial);
 }finally{await h.db.close();}
});

test('authorization followed by cancellation intent and eventual capture stays held until cancellation worker finishes',async()=>{
 const h=await harness(1,false);try{
  await h.checkout.simulate(h.guest.token,{orderId:h.session.orderId,outcome:'authorized'});
  assert.equal((await h.service.cancelCustomer(h.session.orderId,h.guest.token,{reason:'Cancel before payment resolves'})).status,'pending');assert.equal(await h.stock(),h.initial);
  const captured=await h.checkout.simulate(h.guest.token,{orderId:h.session.orderId,outcome:'captured'});
  assert.equal(captured.orderStatus,'confirmed');assert.equal(captured.attentionReason,'CANCELLATION_REQUESTED');assert.equal(captured.fulfillmentStatus,'held');assert.equal(await h.stock(),h.initial-1);
  assert.equal((await h.service.runJobs()).done,1);const final=await h.checkout.receipt(h.session.orderId,h.guest.token);
  assert.equal(final.orderStatus,'cancelled');assert.equal(final.attentionReason,'REFUND_REVIEW');assert.equal(await h.stock(),h.initial);
 }finally{await h.db.close();}
});
