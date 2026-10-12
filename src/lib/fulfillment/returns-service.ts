import 'server-only';
import { z } from 'zod';
import { readEnvironment, type Environment } from '../../config/env.ts';
import { adminRpc } from '../admin/db.ts';
import { hashGuestToken, type CartRpc } from '../cart/service.ts';
import { jobSchema, operationSchema } from '../jobs/contracts.ts';
import { checkoutService } from '../checkout/service.ts';
import { returnRequestInputSchema,returnActionSchema,returnSchema,returnEligibilitySchema,refundInputSchema,refundSchema,refundSummarySchema,cancellationInputSchema,cancellationSchema,fixtureRefundInputSchema } from './returns-contracts.ts';
import { razorpayRefundProvider,refundReceipt,type RefundProvider } from './refund-provider.ts';
const uuid=z.string().uuid();
const contextSchema=z.object({refund:refundSchema,operation:operationSchema,paymentId:z.string(),orderMode:z.enum(['test','live']),fixtureOutcome:z.enum(['pending','processed','failed','timeout'])});
export type ReturnsDeps={rpc?:CartRpc;env?:Environment;provider?:RefundProvider;cancelShipping?:(orderId:string)=>Promise<'clear'|'unknown'|'too_late'>;reconcilePayment?:(id:string,cancel?:boolean)=>Promise<void>};
export function createReturnsService(deps:ReturnsDeps={}){
 const rpc=deps.rpc??adminRpc,environment=()=>deps.env??readEnvironment();
 const internal=(action:string,id:string|null=null,payload:Record<string,unknown>={})=>rpc('refunds_internal',{p_action:action,p_id:id,p_payload:payload});
 async function authorize(actor:string,owner=false){uuid.parse(actor);await rpc('require_admin_actor',{p_actor:actor,p_owner_only:owner});}
 const context=async(id:string)=>contextSchema.parse(await rpc('refunds_context',{p_id:uuid.parse(id)}));
 const mode=()=>environment().APP_MODE==='live'?'live':'test';
 async function processRefund(id:string){
  const ctx=await context(id),env=environment();
  if(ctx.refund.fixture!==(env.APP_MODE==='fixture')||ctx.orderMode!==mode())throw new Error('REFUND_MISMATCH');
  if(ctx.refund.status==='processed'||ctx.refund.status==='failed')return ctx.refund;
  let op;
  try{op=operationSchema.parse(await rpc('claim_operation',{p_id:ctx.operation.id,p_lease_seconds:60}));}
  catch(error){if(error instanceof Error&&error.message==='OPERATION_BUSY')return ctx.refund;throw error;}
  try{
   const provider=env.APP_MODE==='fixture'?null:deps.provider??razorpayRefundProvider(env);
   if(provider&&provider.mode!==mode())throw new Error('REFUND_MISMATCH');
   const observation=env.APP_MODE==='fixture'?(ctx.fixtureOutcome==='timeout'?null:{id:`fixture_rfnd_${id.replaceAll('-','')}`,payment_id:ctx.paymentId,amount:ctx.refund.amountPaise,currency:'INR',status:ctx.fixtureOutcome}):ctx.refund.providerRefundId?await provider!.get(ctx.refund.providerRefundId):op.status==='running'&&op.lease_token?await provider!.create(ctx.paymentId,id,ctx.refund.amountPaise):await provider!.find(ctx.paymentId,id);
   if(!observation){await internal('unknown',id);return refundSchema.parse((await context(id)).refund);}
   if(env.APP_MODE!=='fixture'&&!ctx.refund.providerRefundId){const correlated=observation as {receipt?:string|null;notes?:Record<string,unknown>|unknown[]};if(correlated.receipt!==refundReceipt(id)&&(!correlated.notes||Array.isArray(correlated.notes)||correlated.notes.store_refund_id!==id))throw new Error('REFUND_MISMATCH');}
   return refundSchema.parse(await rpc('refunds_apply',{p_id:id,p_result:observation,p_mode:mode(),p_fixture:env.APP_MODE==='fixture'}));
  }catch{await internal('unknown',id);return (await context(id)).refund;}
 }
 async function cancel(orderId:string,token:string|undefined,input:unknown,userId:string|null,actor:string|null){
  const value=cancellationInputSchema.parse(input);uuid.parse(orderId);
  const requested=cancellationSchema.parse(await rpc('returns_cancel_request',{p_order_id:orderId,p_token_hash:hashGuestToken(token),p_user_id:userId,p_actor:actor,p_reason:value.reason,p_mode:mode(),p_fixture:environment().APP_MODE==='fixture'}));
  return finishCancellation(orderId,actor,requested);
 }
 async function finishCancellation(orderId:string,actor:string|null,requested:z.infer<typeof cancellationSchema>){
  if(requested.status==='cancelled')return requested;
  const current=z.object({order:z.object({mode:z.string(),fixture:z.boolean(),captured_paise:z.number(),refunded_paise:z.number(),order_status:z.string()})}).parse(await rpc('checkout_payment_context',{p_order_id:orderId}));
  if(current.order.mode!==mode()||current.order.fixture!==(environment().APP_MODE==='fixture'))throw new Error('FORBIDDEN');
  if(current.order.order_status==='cancelled')return {orderId,status:'cancelled' as const,refundRequired:current.order.captured_paise>current.order.refunded_paise};
  let shipping:'clear'|'unknown'|'too_late';
  if(deps.cancelShipping)shipping=await deps.cancelShipping(orderId);
  else {const {shippingService}=await import('./shipping-service.ts');shipping=await shippingService.cancelForOrder(orderId);}
  if(shipping==='too_late')return {...requested,status:'too_late' as const};
  if(shipping==='unknown')return requested;
  // Payment reconciliation is authoritative. An authorization or unknown provider result keeps stock held.
  try{await (deps.reconcilePayment??checkoutService.reconcile)(orderId,current.order.captured_paise===0);}catch{return requested;}
  return cancellationSchema.parse(await rpc('returns_cancel_finish',{p_order_id:orderId,p_actor:actor}));
 }

 return {
  processRefund,
  async eligibility(orderId:string,token:string|undefined,userId:string|null=null){return returnEligibilitySchema.parse(await rpc('returns_eligibility',{p_order_id:uuid.parse(orderId),p_token_hash:hashGuestToken(token),p_user_id:userId}));},
  async request(orderId:string,token:string|undefined,input:unknown,userId:string|null=null){return returnSchema.parse(await rpc('returns_request',{p_order_id:uuid.parse(orderId),p_token_hash:hashGuestToken(token),p_user_id:userId,p_input:returnRequestInputSchema.parse(input),p_mode:mode(),p_fixture:environment().APP_MODE==='fixture'}));},
  async adminList(actor:string){return z.array(returnSchema).parse(await rpc('returns_admin_read',{p_actor:uuid.parse(actor)}));},
  async forOrder(actor:string,orderId:string){return z.array(returnSchema).parse(await rpc('returns_admin_read',{p_actor:uuid.parse(actor),p_order_id:uuid.parse(orderId)}));},
  async adminGet(actor:string,id:string){return returnSchema.parse(await rpc('returns_admin_read',{p_actor:uuid.parse(actor),p_id:uuid.parse(id)}));},
  async adminAction(actor:string,id:string,input:unknown){return returnSchema.parse(await rpc('returns_admin_action',{p_actor:uuid.parse(actor),p_id:uuid.parse(id),p_input:returnActionSchema.parse(input),p_mode:mode(),p_fixture:environment().APP_MODE==='fixture'}));},
  async createRto(actor:string,orderId:string,input:unknown){return returnSchema.parse(await rpc('returns_request',{p_order_id:uuid.parse(orderId),p_token_hash:null,p_user_id:null,p_actor:uuid.parse(actor),p_input:returnRequestInputSchema.parse(input),p_rto:true,p_mode:mode(),p_fixture:environment().APP_MODE==='fixture'}));},
  async refundSummary(actor:string,orderId:string){return refundSummarySchema.parse(await rpc('refunds_summary',{p_actor:uuid.parse(actor),p_order_id:uuid.parse(orderId)}));},
  async refund(actor:string,orderId:string,input:unknown,key:string){
   const value=refundInputSchema.parse(input);z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/).parse(key);
   await authorize(actor,true);if(environment().APP_MODE!=='fixture'&&!deps.provider)razorpayRefundProvider(environment());
   const id=uuid.parse(await rpc('refunds_reserve',{p_actor:actor,p_order_id:uuid.parse(orderId),p_input:value,p_key:key,p_mode:mode(),p_fixture:environment().APP_MODE==='fixture'}));
   return processRefund(id);
  },
  async reconcileRefund(actor:string,id:string){await authorize(actor,true);return processRefund(uuid.parse(id));},
  async fixtureRefund(actor:string,id:string,input:unknown){await authorize(actor,true);if(environment().APP_MODE!=='fixture')throw new Error('NOT_FOUND');const value=fixtureRefundInputSchema.parse(input);await internal('fixture',uuid.parse(id),{actor,...value});return processRefund(id);},
  async retryOperation(actor:string,operationId:string){const {refundId}=z.object({refundId:uuid}).parse(await internal('operation',uuid.parse(operationId),{actor:uuid.parse(actor)}));return processRefund(refundId);},
  async cancelCustomer(orderId:string,token:string|undefined,input:unknown,userId:string|null=null){return cancel(orderId,token,input,userId,null);},
  async cancelAdmin(actor:string,orderId:string,input:unknown){await authorize(actor);return cancel(orderId,undefined,input,null,actor);},
  async runJobs(){
   await rpc('reclaim_expired_jobs',{p_limit:100});
   const ids=z.array(uuid).parse(await internal('due'));
   for(const id of ids)await rpc('enqueue_job',{p_type:'refund.reconcile',p_dedupe_key:`refund:${id}:${Math.floor(Date.now()/60000)}`,p_payload:{refundId:id},p_max_attempts:8});
   const jobs=z.array(jobSchema).parse(await rpc('refunds_claim_jobs',{}));let done=0,failed=0;
   for(const job of jobs){try{if(job.type==='order.cancel'){const id=uuid.parse(job.payload.orderId);const done=await finishCancellation(id,null,{orderId:id,status:'pending',refundRequired:false});if(done.status!=='cancelled')throw new Error('RECONCILIATION_REQUIRED');}else{const refund=await processRefund(uuid.parse(job.payload.refundId));if(refund.status==='unknown')throw new Error('RECONCILIATION_REQUIRED');}await rpc('complete_job',{p_id:job.id,p_lease_token:job.lease_token});done++;}catch{await rpc('fail_job',{p_id:job.id,p_lease_token:job.lease_token,p_error_code:'RECONCILIATION_REQUIRED'});failed++;}}
   return {claimed:jobs.length,done,failed};
  },
 };
}
export const returnsService=createReturnsService();
