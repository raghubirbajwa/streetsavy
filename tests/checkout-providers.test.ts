import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { readEnvironment } from "../src/config/env.ts";
import { paymentProvider, shippingQuote, sendOrderNotification, validSignature, ProviderError } from "../src/lib/checkout/providers.ts";

const env=readEnvironment({APP_MODE:"test",APP_URL:"http://localhost:3000",RAZORPAY_KEY_ID:"rzp_test_fixture",RAZORPAY_KEY_SECRET:"provider-unit-test-only"});
const fixture=readEnvironment({APP_MODE:"fixture",APP_URL:"http://localhost:3000"});
const paymentId="pay_UnitTest1";
const refund=(id:string,status="processed",amount=100)=>({id:`rfnd_${id}`,payment_id:paymentId,amount,currency:"INR",status});
const errorCode=(code:ProviderError["code"])=>(error:unknown)=>error instanceof ProviderError&&error.code===code;

test("fixture providers cannot make network calls and email remains explicitly unsent",async()=>{
  const never:typeof fetch=async()=>{assert.fail("fixture called a provider");};
  assert.throws(()=>paymentProvider(fixture,never),errorCode("INTEGRATION_UNCONFIGURED"));
  const parcel={pickupPincode:"560001",deliveryPincode:"110001",weightG:500,lengthCm:30,widthCm:20,heightCm:5};
  assert.equal((await shippingQuote(parcel,fixture,never)).costPaise,7500);
  assert.equal((await shippingQuote(parcel,env,never)).costPaise,7500);
  assert.equal((await shippingQuote({...parcel,deliveryPincode:"999999"},fixture,never)).serviceable,false);
  await assert.rejects(shippingQuote({...parcel,deliveryPincode:"888888"},fixture,never),errorCode("UPSTREAM_UNAVAILABLE"));
  assert.deepEqual(await sendOrderNotification({id:"notice1",email:"test@example.invalid",orderNumber:"YB-TEST",orderId:"order1",firstAttemptAt:null},fixture,never),{status:"unconfigured",providerId:null,error:"FIXTURE_NO_EMAIL"});
});

test("callback signatures use the stored order ID and webhook signatures use exact bytes",()=>{
  const adapter=paymentProvider(env,async()=>{assert.fail("signature verification used network");});
  const signature=createHmac("sha256","provider-unit-test-only").update("order_Test1|pay_Test1").digest("hex");
  assert.equal(adapter.verify("order_Test1","pay_Test1",signature),true);
  assert.equal(adapter.verify("order_Other","pay_Test1",signature),false);
  const bytes=Buffer.from('{ "event": "payment.captured" }\n');
  const hook=createHmac("sha256","webhook-unit-test-only").update(bytes).digest("hex");
  assert.equal(validSignature(bytes,hook,"webhook-unit-test-only"),true);
  assert.equal(validSignature(JSON.stringify(JSON.parse(bytes.toString())),hook,"webhook-unit-test-only"),false);
  assert.equal(validSignature(bytes,"f","webhook-unit-test-only"),false);
});

test("ambiguous order creation is not automatically retried",async()=>{
  let calls=0;
  const adapter=paymentProvider(env,async(_url,options)=>{calls++;assert.equal(options?.method,"POST");throw new Error("connection closed after send");});
  await assert.rejects(adapter.create("11111111-1111-4111-8111-111111111111",97500),errorCode("UPSTREAM_UNKNOWN"));
  assert.equal(calls,1);
});

test("refund retrieval paginates, retains distinct states and strips unrelated provider data",async()=>{
  const calls:URL[]=[];
  const adapter=paymentProvider(env,async(url,options)=>{
    assert.equal(options?.method,"GET");assert.equal(options?.cache,"no-store");
    const parsed=new URL(String(url));calls.push(parsed);
    if(parsed.searchParams.get("skip")==="0")return Response.json({items:Array.from({length:100},(_,i)=>({...refund(`Page${i}`,i===0?"pending":i===1?"failed":"processed"),notes:{customer:"private"}}))});
    return Response.json({items:[refund("Last")]});
  });
  const result=await adapter.refunds(paymentId);
  assert.equal(result.length,101);assert.equal(result[0]?.status,"pending");assert.equal(result[1]?.status,"failed");
  assert.deepEqual(Object.keys(result[0]!).sort(),["amount","currency","id","payment_id","status"]);
  assert.deepEqual(calls.map(url=>url.search),["?count=100&skip=0","?count=100&skip=100"]);
  assert.equal(calls[0]?.pathname,`/v1/payments/${paymentId}/refunds`);
});

test("refund retrieval rejects wrong payment, currency, amount or lifecycle before returning rows",async()=>{
  for(const change of [{payment_id:"pay_Other"},{currency:"USD"},{amount:1.5},{amount:-1},{amount:Number.MAX_SAFE_INTEGER+1},{status:"created"}]){
    const adapter=paymentProvider(env,async()=>Response.json({items:[{...refund("Bad"),...change}]}));
    await assert.rejects(adapter.refunds(paymentId),errorCode("PAYMENT_MISMATCH"));
  }
});

test("refund scans dedupe identical rows and fail closed on conflicting rows or unbounded pages",async()=>{
  let calls=0;
  const identical=paymentProvider(env,async()=>Response.json({items:[refund("Same"),refund("Same")]}));
  assert.equal((await identical.refunds(paymentId)).length,1);
  const conflicting=paymentProvider(env,async()=>Response.json({items:[refund("Same","pending"),refund("Same","processed")]}));
  await assert.rejects(conflicting.refunds(paymentId),errorCode("UPSTREAM_UNKNOWN"));
  const bounded=paymentProvider(env,async()=>{calls++;return Response.json({items:Array.from({length:100},(_,i)=>refund(`Page${calls}Row${i}`))});});
  await assert.rejects(bounded.refunds(paymentId),errorCode("UPSTREAM_UNKNOWN"));
  assert.equal(calls,10);
});

test("refund retrieval cannot use live keys in test mode or return a partial result after provider failure",async()=>{
  assert.throws(()=>readEnvironment({APP_MODE:"test",APP_URL:"http://localhost:3000",RAZORPAY_KEY_ID:"rzp_live_fixture",RAZORPAY_KEY_SECRET:"test-only"}));
  let calls=0;
  const adapter=paymentProvider(env,async()=>{
    calls++;
    return calls===1?Response.json({items:Array.from({length:100},(_,i)=>refund(`Page${i}`))}):new Response("unavailable",{status:503});
  });
  await assert.rejects(adapter.refunds(paymentId),errorCode("UPSTREAM_UNAVAILABLE"));assert.equal(calls,2);
});
