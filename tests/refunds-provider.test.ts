import assert from 'node:assert/strict';
import test from 'node:test';
import {readEnvironment} from '../src/config/env.ts';
import {razorpayRefundProvider,refundReceipt} from '../src/lib/fulfillment/refund-provider.ts';
const env=readEnvironment({APP_MODE:'test',APP_URL:'http://localhost:3000',RAZORPAY_KEY_ID:'rzp_test_unit',RAZORPAY_KEY_SECRET:'unit-only'});
const id='a0000000-0000-4000-8000-000000000001';
const refund={id:'rfnd_unit1',payment_id:'pay_unit1',amount:100,currency:'INR',status:'pending',receipt:refundReceipt(id)};
test('real refund adapter rejects fixture mode before network, explicit mode-specific config is required',()=>{
 let calls=0;const transport=async()=>{calls++;return Response.json(refund);};
 assert.throws(()=>razorpayRefundProvider(readEnvironment({APP_MODE:'fixture',APP_URL:'http://localhost:3000'}),transport),/FORBIDDEN/);assert.equal(calls,0);
 assert.throws(()=>razorpayRefundProvider(readEnvironment({APP_MODE:'test',APP_URL:'http://localhost:3000'}),transport),/INTEGRATION_UNCONFIGURED/);assert.equal(calls,0);
});
test('refund create uses explicit amount and durable receipt; response loss never retries POST',async()=>{
 let calls=0;const adapter=razorpayRefundProvider(env,async(url,init)=>{calls++;assert.equal(url,'https://api.razorpay.com/v1/payments/pay_unit1/refund');assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{amount:100,speed:'normal',receipt:refundReceipt(id),notes:{store_refund_id:id}});throw new Error('response lost');});
 await assert.rejects(adapter.create('pay_unit1',id,100),/UPSTREAM_UNKNOWN/);assert.equal(calls,1);
});
test('refund reconciliation paginates and only matches receipt or exact store refund note',async()=>{
 let calls=0;
 const adapter=razorpayRefundProvider(env,async(url,init)=>{assert.equal(init?.method,'GET');calls++;const skip=new URL(String(url)).searchParams.get('skip');return Response.json({items:skip==='0'?Array.from({length:100},(_,i)=>({...refund,id:`rfnd_other${i}`,receipt:`unrelated${i}`})):[{...refund,receipt:null,notes:{store_refund_id:id}}]});});
 assert.equal((await adapter.find('pay_unit1',id))?.id,refund.id);assert.equal(calls,2);
});
test('ambiguous duplicate correlation, payment mismatch and malformed monetary response fail closed',async()=>{
 const dup=razorpayRefundProvider(env,async()=>Response.json({items:[refund,{...refund,id:'rfnd_another'}]}));await assert.rejects(dup.find('pay_unit1',id),/REFUND_MISMATCH/);
 const mismatch=razorpayRefundProvider(env,async()=>Response.json({items:[{...refund,payment_id:'pay_wrong'}]}));await assert.rejects(mismatch.find('pay_unit1',id),/REFUND_MISMATCH/);
 const malformed=razorpayRefundProvider(env,async()=>Response.json({...refund,amount:'100'}));await assert.rejects(malformed.get(refund.id),/UPSTREAM_UNKNOWN/);
 const wrongId=razorpayRefundProvider(env,async()=>Response.json({...refund,id:'rfnd_wrong'}));await assert.rejects(wrongId.get(refund.id),/REFUND_MISMATCH/);
});
