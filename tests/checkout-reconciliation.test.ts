import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureAdminDatabase, executeFixtureRpc } from "../src/lib/admin/db.ts";
import { fixtureCheckoutSql } from "../src/data/fixtures/checkout-seed.ts";
import { createCartService } from "../src/lib/cart/service.ts";
import { createCheckoutService } from "../src/lib/checkout/service.ts";
import { readEnvironment } from "../src/config/env.ts";
import { ProviderError, type PaymentProvider, type ProviderOrder, type ProviderPayment, type ProviderRefund } from "../src/lib/checkout/providers.ts";

const address={fullName:"Reconciliation Shopper",phone:"9000000000",email:"reconcile@example.invalid",line1:"Fixture address",city:"Fixture City",stateCode:"KA",pincode:"560001",country:"IN"};
const testEnvironment=readEnvironment({APP_MODE:"test",APP_URL:"http://localhost:3000",RAZORPAY_KEY_ID:"rzp_test_reconciliation",RAZORPAY_KEY_SECRET:"local-unit-test-only"});

async function harness(options:{unknownCreate?:boolean}={}){
  // PGlite stays in fixture mode; only the injected service mode exercises the real-adapter branch.
  process.env.APP_MODE="fixture";process.env.APP_URL="http://localhost:3000";
  const db=await createFixtureAdminDatabase();
  try{
    await db.exec(fixtureCheckoutSql);
    const rpc=<T=unknown>(name:string,args:Record<string,unknown>)=>executeFixtureRpc<T>(db,name,args);
    const state:{order:ProviderOrder|null;payments:ProviderPayment[];refunds:ProviderRefund[];createCalls:number;findCalls:number;paymentsUnavailable:boolean}={order:null,payments:[],refunds:[],createCalls:0,findCalls:0,paymentsUnavailable:false};
    const provider:PaymentProvider={
      mode:"test",keyId:testEnvironment.RAZORPAY_KEY_ID!,
      async create(id,amount){
        state.createCalls++;
        state.order={id:`order_${id.replaceAll("-","")}`,amount,currency:"INR",receipt:`yb_${id.replaceAll("-","")}`,status:"created"};
        if(options.unknownCreate)throw new ProviderError("UPSTREAM_UNKNOWN");
        return state.order;
      },
      async find(){state.findCalls++;return state.order;},
      async order(){assert.ok(state.order);return state.order;},
      async payments(){if(state.paymentsUnavailable)throw new ProviderError("UPSTREAM_UNAVAILABLE");return state.payments;},
      async payment(id){const payment=state.payments.find(row=>row.id===id);assert.ok(payment);return payment;},
      async refunds(){return state.refunds;},
      verify(){return true;},
    };
    const carts=createCartService(rpc);
    const checkout=createCheckoutService({rpc,env:testEnvironment,provider,notify:async()=>({status:"unconfigured",providerId:null,error:"LOCAL_TEST_NO_EMAIL"})});
    const variant=(await db.query<{id:string}>("select v.id from public.product_variants v join public.inventory i on i.variant_id=v.id where v.enabled and i.on_hand>=10 order by v.id limit 1")).rows[0]!.id;
    const stock=async()=>(await db.query<{on_hand:number;reserved:number}>("select on_hand,reserved from public.inventory where variant_id=$1",[variant])).rows[0]!;
    const initialStock=await stock();
    const guest=await carts.create(undefined);
    const cart=await carts.add(guest.token,{variantId:variant,quantity:1,cartVersion:1});
    const quote=await checkout.quote(guest.token,{cartVersion:cart.version,address});
    const session=await checkout.start(guest.token,quote.quoteId,"reconciliation-test-start");
    const payment=(id:string,status:ProviderPayment["status"],changes:Partial<ProviderPayment>={}):ProviderPayment=>({id,order_id:state.order!.id,amount:session.amountPaise,currency:"INR",status,amount_refunded:0,...changes});
    const receipt=()=>checkout.receipt(session.orderId,guest.token);
    const saleCount=async()=>(await db.query<{count:number}>("select count(*)::int count from public.inventory_movements where order_id=$1 and kind='sale'",[session.orderId])).rows[0]!.count;
    return {db,rpc,state,checkout,session,guest,payment,receipt,stock,initialStock,saleCount};
  }catch(error){await db.close();throw error;}
}

test("a failed payment followed by capture and historical failures stays ready with one stock deduction",async()=>{
  const h=await harness();
  try{
    const failed=h.payment("pay_Failed1","failed"),captured=h.payment("pay_Captured1","captured");
    h.state.payments=[failed];await h.checkout.reconcile(h.session.orderId);
    assert.equal((await h.receipt()).paymentStatus,"unpaid");
    h.state.payments=[failed,captured];await h.checkout.reconcile(h.session.orderId);
    let receipt=await h.receipt();assert.equal(receipt.paymentStatus,"captured");assert.equal(receipt.fulfillmentStatus,"ready");assert.equal(receipt.attentionReason,null);
    h.state.payments=[failed];await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.paymentStatus,"captured");assert.equal(receipt.fulfillmentStatus,"ready");assert.equal(receipt.attentionReason,null);
    assert.equal(await h.saleCount(),1);assert.deepEqual(await h.stock(),{on_hand:h.initialStock.on_hand-1,reserved:h.initialStock.reserved});
  }finally{await h.db.close();}
});

test("ambiguous provider create reconciles its existing order and restores payment without a second create",async()=>{
  const h=await harness({unknownCreate:true});
  try{
    assert.equal(h.session.status,"held");assert.equal((await h.receipt()).canPay,false);
    assert.equal((await h.db.query<{status:string}>("select status from public.external_operations where id=$1",[h.session.operationId])).rows[0]!.status,"unknown");
    await h.checkout.reconcile(h.session.orderId);
    const resumed=await h.checkout.resume(h.session.orderId,h.guest.token),receipt=await h.receipt();
    assert.equal(h.state.createCalls,1);assert.equal(h.state.findCalls,1);assert.equal(resumed.status,"ready");assert.equal(resumed.razorpayOrderId,h.state.order!.id);
    assert.equal(receipt.canPay,true);assert.equal(receipt.attentionReason,null);assert.equal(receipt.fulfillmentStatus,"unfulfilled");
    assert.equal(await h.saleCount(),0);assert.deepEqual(await h.stock(),{on_hand:h.initialStock.on_hand,reserved:h.initialStock.reserved+1});
  }finally{await h.db.close();}
});

test("a provider outage after capture holds the order temporarily and healthy reconciliation clears only that hold",async()=>{
  const h=await harness();
  try{
    h.state.payments=[h.payment("pay_Captured1","captured")];await h.checkout.reconcile(h.session.orderId);
    h.state.paymentsUnavailable=true;
    await assert.rejects(h.checkout.reconcile(h.session.orderId),/UPSTREAM_UNAVAILABLE/);
    let receipt=await h.receipt();assert.equal(receipt.fulfillmentStatus,"held");assert.equal(receipt.attentionReason,"PAYMENT_RECONCILIATION_REQUIRED");assert.equal(receipt.capturedPaise,h.session.amountPaise);
    h.state.paymentsUnavailable=false;await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.fulfillmentStatus,"ready");assert.equal(receipt.attentionReason,null);assert.equal(await h.saleCount(),1);
    await h.rpc("checkout_internal",{p_action:"attention",p_id:h.session.orderId,p_payload:{reason:"PAYMENT_MISMATCH"}});
    await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.fulfillmentStatus,"held");assert.equal(receipt.attentionReason,"PAYMENT_MISMATCH");
  }finally{await h.db.close();}
});

test("cancelled released orders remain scheduled and a lost-webhook late capture is found by the worker",async()=>{
  const h=await harness();
  try{
    await h.checkout.refresh(h.session.orderId,h.guest.token,null,true);
    let receipt=await h.receipt();assert.equal(receipt.orderStatus,"cancelled");assert.equal(receipt.reservationExpiresAt,null);assert.deepEqual(await h.stock(),h.initialStock);
    assert.equal((await h.db.query<{status:string}>("select status from public.inventory_reservations where order_id=$1",[h.session.orderId])).rows[0]!.status,"released");
    await h.db.query("update public.orders set next_payment_check_at=now()-interval '1 minute' where id=$1",[h.session.orderId]);
    const due=await h.rpc<string[]>("checkout_internal",{p_action:"due"});assert.ok(due.includes(h.session.orderId));
    h.state.payments=[h.payment("pay_Late1","captured")];
    for(let attempt=0;attempt<6;attempt++){
      const batch=await h.checkout.runJobs();assert.equal(batch.failed,0);
      if((await h.receipt()).capturedPaise>0)break;
    }
    receipt=await h.receipt();assert.equal(receipt.capturedPaise,h.session.amountPaise);assert.equal(receipt.orderStatus,"cancelled");assert.equal(receipt.fulfillmentStatus,"held");assert.equal(receipt.attentionReason,"LATE_CAPTURE_REVIEW");
    assert.deepEqual(await h.stock(),h.initialStock);assert.equal(await h.saleCount(),0);
    assert.equal(h.state.createCalls,1);
  }finally{await h.db.close();}
});

test("only processed refund observations increase refunded money, stale observations cannot undo it, and refunds never restock",async()=>{
  const h=await harness();
  try{
    h.state.payments=[h.payment("pay_Captured1","captured",{amount_refunded:100})];
    const partial:ProviderRefund={id:"rfnd_Partial1",payment_id:"pay_Captured1",amount:100,currency:"INR",status:"pending"};
    h.state.refunds=[partial];await h.checkout.reconcile(h.session.orderId);
    let receipt=await h.receipt();assert.equal(receipt.paymentStatus,"captured");assert.equal(receipt.refundedPaise,0,"provider amount_refunded is not proof of processing");
    const capturedStock=await h.stock();
    h.state.refunds=[{...partial,status:"processed"}];await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.refundedPaise,100);assert.equal(receipt.paymentStatus,"partially_refunded");assert.equal(receipt.attentionReason,null);assert.equal(receipt.fulfillmentStatus,"ready","partial refund does not cancel remaining fulfillment");
    h.state.refunds=[{...partial,status:"pending"}];await h.checkout.reconcile(h.session.orderId);
    assert.equal((await h.receipt()).refundedPaise,100);
    h.state.refunds=[];await h.checkout.reconcile(h.session.orderId);assert.equal((await h.receipt()).refundedPaise,100);
    h.state.refunds=[{...partial,status:"failed"},{id:"rfnd_Remaining1",payment_id:"pay_Captured1",amount:h.session.amountPaise-100,currency:"INR",status:"processed"}];
    h.state.payments=[h.payment("pay_Captured1","refunded",{amount_refunded:h.session.amountPaise})];await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.paymentStatus,"refunded");assert.equal(receipt.refundedPaise,h.session.amountPaise);assert.equal(receipt.fulfillmentStatus,"held");
    assert.deepEqual(await h.stock(),capturedStock);assert.equal(await h.saleCount(),1);
    assert.equal((await h.db.query<{status:string}>("select status from public.provider_refund_observations where provider_refund_id='rfnd_Partial1'")).rows[0]!.status,"processed");
  }finally{await h.db.close();}
});

test("mismatched capture is recorded without allocating stock, and subsequent valid funds cannot erase the review",async()=>{
  const h=await harness();
  try{
    h.state.payments=[h.payment("pay_WrongAmount1","captured",{amount:h.session.amountPaise+100})];await h.checkout.reconcile(h.session.orderId);
    let receipt=await h.receipt();assert.equal(receipt.capturedPaise,0);assert.equal(receipt.attentionReason,"PAYMENT_MISMATCH");assert.equal(receipt.fulfillmentStatus,"held");assert.equal(await h.saleCount(),0);
    const observation=(await h.db.query<{status:string;amount_paise:number}>("select status,amount_paise from public.payment_observations where provider_payment_id='pay_WrongAmount1'")).rows[0]!;
    assert.equal(observation.status,"captured");assert.equal(observation.amount_paise,h.session.amountPaise+100);
    h.state.payments=[h.payment("pay_Valid1","captured")];await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.capturedPaise,h.session.amountPaise);assert.equal(receipt.attentionReason,"PAYMENT_MISMATCH");assert.equal(receipt.fulfillmentStatus,"held");assert.equal(await h.saleCount(),0);
    assert.deepEqual(await h.stock(),{on_hand:h.initialStock.on_hand,reserved:h.initialStock.reserved+1});
    assert.equal((await h.db.query<{count:number}>("select count(*)::int count from public.payment_observations where order_id=$1",[h.session.orderId])).rows[0]!.count,2);
  }finally{await h.db.close();}
});

test("multiple authoritative captures are recorded together and held without allocating either payment",async()=>{
  const h=await harness();
  try{
    h.state.payments=[h.payment("pay_DuplicateCapture1","captured"),h.payment("pay_DuplicateCapture2","refunded"),h.payment("pay_HistoricalFailure","failed")];
    await h.checkout.reconcile(h.session.orderId);
    let receipt=await h.receipt();
    assert.equal(receipt.attentionReason,"PAYMENT_MISMATCH");assert.equal(receipt.fulfillmentStatus,"held");
    assert.equal(receipt.capturedPaise,0);assert.equal(receipt.refundedPaise,0);assert.equal(receipt.canPay,false);
    assert.equal(await h.saleCount(),0);assert.deepEqual(await h.stock(),{on_hand:h.initialStock.on_hand,reserved:h.initialStock.reserved+1});
    const observations=async()=>(await h.db.query<{provider_payment_id:string;status:string;amount_paise:number}>("select provider_payment_id,status,amount_paise from public.payment_observations where order_id=$1 order by provider_payment_id",[h.session.orderId])).rows;
    assert.deepEqual(await observations(),[
      {provider_payment_id:"pay_DuplicateCapture1",status:"captured",amount_paise:h.session.amountPaise},
      {provider_payment_id:"pay_DuplicateCapture2",status:"refunded",amount_paise:h.session.amountPaise},
      {provider_payment_id:"pay_HistoricalFailure",status:"failed",amount_paise:h.session.amountPaise},
    ]);
    await h.checkout.reconcile(h.session.orderId);
    assert.equal((await observations()).length,3);assert.equal(await h.saleCount(),0);
    assert.equal((await h.db.query<{count:number}>("select count(*)::int count from public.notifications where order_id=$1",[h.session.orderId])).rows[0]!.count,0);
    // Even a subsequent incomplete provider snapshot cannot turn this conflict into fulfillment.
    h.state.payments=[h.state.payments[0]!];await h.checkout.reconcile(h.session.orderId);
    receipt=await h.receipt();assert.equal(receipt.attentionReason,"PAYMENT_MISMATCH");assert.equal(receipt.fulfillmentStatus,"held");assert.equal(await h.saleCount(),0);
  }finally{await h.db.close();}
});

test("provider outages and uncertain reservation release preserve stronger payment review reasons",async()=>{
  const h=await harness();
  try{
    h.state.paymentsUnavailable=true;
    for(const reason of ["PAYMENT_MISMATCH","REFUND_REVIEW","LATE_CAPTURE_REVIEW"]){
      await h.db.query("update public.orders set attention_reason=$2,fulfillment_status='held' where id=$1",[h.session.orderId,reason]);
      await assert.rejects(h.checkout.reconcile(h.session.orderId),/UPSTREAM_UNAVAILABLE/);
      assert.equal((await h.receipt()).attentionReason,reason);
      await h.rpc("release_reservation",{p_order_id:h.session.orderId,p_provider_clear:false,p_cancel:true});
      const receipt=await h.receipt();assert.equal(receipt.attentionReason,reason);assert.equal(receipt.fulfillmentStatus,"held");assert.equal(receipt.canPay,false);
    }
    assert.equal(await h.saleCount(),0);assert.deepEqual(await h.stock(),{on_hand:h.initialStock.on_hand,reserved:h.initialStock.reserved+1});
  }finally{await h.db.close();}
});
