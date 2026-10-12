import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readEnvironment, type Environment } from "../../config/env.ts";
import { adminRpc } from "../admin/db.ts";
import { hashGuestToken, type CartRpc } from "../cart/service.ts";
import { jobSchema, operationSchema } from "../jobs/contracts.ts";
import { quoteInputSchema, quoteSchema, sessionSchema, receiptSchema, verifyInputSchema, fixturePaymentSchema, paise } from "./contracts.ts";
import { paymentProvider, shippingQuote, sendOrderNotification, ProviderError, type ProviderPayment, type PaymentProvider } from "./providers.ts";

const contextSchema=z.object({order:z.object({id:z.string().uuid(),order_number:z.string(),mode:z.enum(["test","live"]),fixture:z.boolean(),total_paise:paise,currency:z.literal("INR"),created_at:z.string(),order_status:z.string(),payment_status:z.string(),captured_paise:paise,attention_reason:z.string().nullable()}),attempt:z.object({id:z.string().uuid(),provider_order_id:z.string().nullable(),provider_payment_id:z.string().nullable(),status:z.string(),fixture_state:z.enum(["created","authorized","captured","failed","refunded"])}),operation:operationSchema,reservationExpiresAt:z.string(),hasHeld:z.boolean()});
type Context=z.infer<typeof contextSchema>;
export type CheckoutDeps={rpc?:CartRpc;env?:Environment;provider?:PaymentProvider;shipping?:typeof shippingQuote;notify?:typeof sendOrderNotification};
export function createCheckoutService(deps:CheckoutDeps={}){
  const rpc=deps.rpc??adminRpc; const environment=()=>deps.env??readEnvironment();
  const internal=(action:string,id:string|null=null,payload:Record<string,unknown>={})=>rpc("checkout_internal",{p_action:action,p_id:id,p_payload:payload});
  const context=async(id:string)=>contextSchema.parse(await rpc("checkout_payment_context",{p_order_id:id}));
  const checkMode=(ctx:Context)=>{const env=environment();if(ctx.order.fixture!==(env.APP_MODE==="fixture")||ctx.order.mode!==(env.APP_MODE==="live"?"live":"test"))throw new ProviderError("PAYMENT_MISMATCH");};
  const provider=()=>deps.provider??paymentProvider(environment());
  async function access(id:string,token:string|undefined,userId:string|null=null){
    z.string().uuid().parse(id);
    if(!await rpc("checkout_order_access",{p_order_id:id,p_token_hash:hashGuestToken(token),p_user_id:userId}))throw new Error("NOT_FOUND");
  }
  async function receipt(id:string,token:string|undefined,userId:string|null=null){return receiptSchema.parse(await rpc("checkout_receipt",{p_order_id:id,p_token_hash:hashGuestToken(token),p_user_id:userId}));}
  async function createPayment(id:string){
    const ctx=await context(id);checkMode(ctx);
    if(ctx.attempt.provider_order_id)return;
    let op:z.infer<typeof operationSchema>;
    try{op=operationSchema.parse(await rpc("claim_operation",{p_id:ctx.operation.id,p_lease_seconds:60}));}
    catch(error){if(error instanceof Error&&error.message==="OPERATION_BUSY")return;throw error;}
    if(op.status==="succeeded")return;
    const env=environment();
    if(env.APP_MODE==="fixture"){
      await rpc("checkout_bind_provider",{p_order_id:id,p_provider_order_id:`fixture_order_${id.replaceAll("-","")}`,p_amount:ctx.order.total_paise,p_currency:"INR",p_mode:"test"});return;
    }
    const adapter=provider();
    try{
      const result=op.status==="running"&&op.lease_token?await adapter.create(id,ctx.order.total_paise):await adapter.find(id,ctx.order.created_at);
      if(!result){await internal("attention",id,{reason:"PAYMENT_RECONCILIATION_REQUIRED"});return;}
      await rpc("checkout_bind_provider",{p_order_id:id,p_provider_order_id:result.id,p_amount:result.amount,p_currency:result.currency,p_mode:adapter.mode});
    }catch(error){
      if(op.lease_token)await rpc("finish_operation",{p_id:op.id,p_lease_token:op.lease_token,p_status:"unknown",p_error_code:"UPSTREAM_UNKNOWN"}).catch(()=>undefined);
      await internal("attention",id,{reason:error instanceof ProviderError&&error.code==="PAYMENT_MISMATCH"?"PAYMENT_MISMATCH":"PAYMENT_RECONCILIATION_REQUIRED"});
      // Unknown operation never becomes queued again. The worker may only retrieve/reconcile it.
    }
  }
  function fixturePayment(ctx:Context):ProviderPayment{return {id:`fixture_pay_${ctx.order.id.replaceAll("-","")}`,order_id:ctx.attempt.provider_order_id!,amount:ctx.order.total_paise,currency:"INR",status:ctx.attempt.fixture_state,amount_refunded:ctx.attempt.fixture_state==="refunded"?ctx.order.total_paise:0};}
  async function apply(id:string,payment:ProviderPayment){
    const refunds=payment.status==='captured'||payment.status==='refunded'?(environment().APP_MODE==='fixture'?(payment.status==='refunded'?[{id:`fixture_refund_${id}`,payment_id:payment.id,amount:payment.amount,currency:'INR',status:'processed'}]:[]):await provider().refunds(payment.id)):[];
    await rpc("apply_verified_payment",{p_order_id:id,p_payment:{...payment,refunds},p_mode:environment().APP_MODE==="live"?"live":"test"});
  }
  async function reconcile(id:string,cancel=false){
    await createPayment(id);let ctx=await context(id);checkMode(ctx);
    if(!ctx.attempt.provider_order_id){await rpc("release_reservation",{p_order_id:id,p_provider_clear:false,p_cancel:cancel});await internal('checked',id);return;}
    try{
      const payments=ctx.order.fixture?[fixturePayment(ctx)]:await provider().payments(ctx.attempt.provider_order_id);
      if(new Set(payments.filter(p=>p.status==="captured"||p.status==="refunded").map(p=>p.id)).size>1){
        // Preserve the authoritative evidence and hold before any individual capture can allocate stock.
        await rpc("checkout_hold_payment_conflict",{p_order_id:id,p_payments:payments,p_mode:ctx.order.mode});return;
      }
      // A stale failure cannot downgrade a capture; processing order prioritizes authoritative success.
      const ranked=[...payments].sort((a,b)=>({refunded:0,captured:1,authorized:2,created:3,failed:4}[a.status]-{refunded:0,captured:1,authorized:2,created:3,failed:4}[b.status]));
      for(const payment of ranked)await apply(id,payment);
      ctx=await context(id);
      const clear=payments.every(p=>p.status==="failed"||p.status==="created")&&ctx.order.captured_paise===0&&ctx.order.payment_status!=="authorized"&&ctx.order.attention_reason!=="PAYMENT_MISMATCH";
      if(cancel||new Date(ctx.reservationExpiresAt).getTime()<=Date.now())await rpc("release_reservation",{p_order_id:id,p_provider_clear:clear,p_cancel:cancel});
    }catch(error){await internal("attention",id,{reason:"PAYMENT_RECONCILIATION_REQUIRED"});throw error;}finally{await internal('checked',id);}
  }
  async function session(id:string){
    const ctx=await context(id);checkMode(ctx);
    const held=ctx.order.attention_reason!==null||ctx.order.order_status!=='pending_payment'||ctx.order.payment_status!=='unpaid'||!ctx.hasHeld||new Date(ctx.reservationExpiresAt).getTime()<=Date.now();
    return sessionSchema.parse({orderId:id,paymentAttemptId:ctx.attempt.id,operationId:ctx.operation.id,status:held?"held":ctx.attempt.provider_order_id?"ready":"processing",keyId:ctx.order.fixture||held?null:environment().RAZORPAY_KEY_ID??null,razorpayOrderId:held?null:ctx.attempt.provider_order_id,amountPaise:ctx.order.total_paise,currency:"INR",reservationExpiresAt:ctx.reservationExpiresAt,fixture:ctx.order.fixture});
  }
  async function notification(id:string){
    const raw=await internal("notification",id);
    const row=z.object({id:z.string(),order_id:z.string(),orderNumber:z.string(),recipient:z.string(),status:z.string(),first_attempt_at:z.string().nullable()}).parse(raw);
    if(row.status==="sent"||row.status==="unconfigured")return;
    const started=z.object({first_attempt_at:z.string()}).parse(await internal("notificationStart",id));
    const result=await (deps.notify??sendOrderNotification)({id,email:row.recipient,orderNumber:row.orderNumber,orderId:row.order_id,firstAttemptAt:started.first_attempt_at},environment());
    await internal("notificationFinish",id,result);
    if(result.status==="failed")throw new ProviderError("UPSTREAM_UNKNOWN");
  }
  async function webhookEvent(id:string){
    const event=z.object({environment:z.enum(["test","live"]),verification_result:z.string(),payload:z.object({providerOrderId:z.string().optional(),providerPaymentId:z.string().optional()})}).parse(await internal("webhook",id));
    if(event.verification_result!=="verified"||event.environment!==(environment().APP_MODE==="live"?"live":"test"))throw new ProviderError("PAYMENT_MISMATCH");
    const raw=await internal("lookupPayment",null,event.payload);
    if(!raw)throw new ProviderError("UPSTREAM_UNKNOWN"); // unmapped signed events remain durable and visible for review
    const attempt=z.object({order_id:z.string().uuid()}).parse(raw);
    await reconcile(attempt.order_id);
  }
  return {
    access,receipt,reconcile,createPayment,
    async quote(token:string|undefined,input:unknown){
      const data=quoteInputSchema.parse(input);const tokenHash=hashGuestToken(token);
      const raw=await rpc<Record<string,unknown>>("checkout_context",{p_token_hash:tokenHash,p_cart_version:data.cartVersion});
      const ctx=z.object({weightG:z.number().int().positive(),warehouse:z.object({address:z.object({pincode:z.string().regex(/^[1-9]\d{5}$/)})}),packaging:z.object({length_cm:z.coerce.number(),width_cm:z.coerce.number(),height_cm:z.coerce.number()})}).parse(raw);
      const shipping=await (deps.shipping??shippingQuote)({pickupPincode:ctx.warehouse.address.pincode,deliveryPincode:data.address.pincode,weightG:ctx.weightG,lengthCm:ctx.packaging.length_cm,widthCm:ctx.packaging.width_cm,heightCm:ctx.packaging.height_cm},environment());
      return quoteSchema.parse(await rpc("checkout_quote",{p_token_hash:tokenHash,p_cart_version:data.cartVersion,p_address:data.address,p_context:raw,p_shipping:shipping,p_fixture:environment().APP_MODE==="fixture"}));
    },
    async start(token:string|undefined,quoteId:string,key:string){
      z.string().uuid().parse(quoteId);z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/).parse(key);
      // Fail missing real integration configuration before reserving stock.
      if(environment().APP_MODE!=="fixture")provider();
      const id=z.string().uuid().parse(await rpc("reserve_checkout",{p_token_hash:hashGuestToken(token),p_quote_id:quoteId,p_key:key,p_mode:environment().APP_MODE==="live"?"live":"test",p_fixture:environment().APP_MODE==="fixture"}));
      await createPayment(id);return session(id);
    },
    async resume(id:string,token:string|undefined,userId:string|null=null){await access(id,token,userId);return session(id);},
    async operation(id:string,token:string|undefined,userId:string|null=null){
      const found=z.object({orderId:z.string().uuid()}).parse(await internal("operation",id));await access(found.orderId,token,userId);return session(found.orderId);
    },
    async verify(token:string|undefined,input:unknown,userId:string|null=null){
      const value=verifyInputSchema.parse(input);await access(value.orderId,token,userId);const ctx=await context(value.orderId);checkMode(ctx);
      if(ctx.order.fixture)throw new Error("FORBIDDEN");const adapter=provider();
      if(ctx.attempt.provider_order_id!==value.razorpayOrderId||!adapter.verify(ctx.attempt.provider_order_id,value.razorpayPaymentId,value.razorpaySignature))throw new Error("INVALID_SIGNATURE");
      await apply(value.orderId,await adapter.payment(value.razorpayPaymentId));return receipt(value.orderId,token,userId);
    },
    async simulate(token:string|undefined,input:unknown){
      if(environment().APP_MODE!=="fixture")throw new Error("NOT_FOUND");
      const value=fixturePaymentSchema.parse(input);await access(value.orderId,token);const ctx=await context(value.orderId);checkMode(ctx);
      if(!ctx.attempt.provider_order_id||ctx.order.order_status!=="pending_payment")throw new Error("CHECKOUT_IN_PROGRESS");
      await internal("fixturePayment",value.orderId,{state:value.outcome==="timeout"?"captured":value.outcome});
      if(value.outcome!=="timeout")await reconcile(value.orderId);
      await rpc("enqueue_job",{p_type:"payment.reconcile",p_dedupe_key:`fixture-reconcile:${value.orderId}:${value.outcome}`,p_payload:{orderId:value.orderId},p_max_attempts:8});
      return receipt(value.orderId,token);
    },
    async refresh(id:string,token:string|undefined,userId:string|null=null,cancel=false){await access(id,token,userId);await reconcile(id,cancel);return receipt(id,token,userId);},
    async runJobs(){
      const due=z.array(z.string().uuid()).parse(await internal("due"));
      const minute=Math.floor(Date.now()/60000);
      for(const id of due)await rpc("enqueue_job",{p_type:"payment.reconcile",p_dedupe_key:`reconcile:${id}:${minute}`,p_payload:{orderId:id},p_max_attempts:8});
      const jobs=z.array(jobSchema).parse(await rpc("checkout_claim_jobs",{p_limit:1}));let done=0,failed=0;
      for(const job of jobs){
        try{
          if(job.type==="payment.create")await createPayment(z.string().uuid().parse(job.payload.orderId));
          else if(job.type==="payment.reconcile")await reconcile(z.string().uuid().parse(job.payload.orderId));
          else if(job.type==="notification.send")await notification(z.string().uuid().parse(job.payload.notificationId));
          else await webhookEvent(z.string().uuid().parse(job.payload.webhookEventId));
          if(job.type.startsWith("webhook."))await rpc("finish_webhook",{p_event_id:job.payload.webhookEventId,p_job_id:job.id,p_lease_token:job.lease_token});
          else await rpc("complete_job",{p_id:job.id,p_lease_token:job.lease_token});done++;
        }catch{
          if(job.type.startsWith("webhook."))await rpc("finish_webhook",{p_event_id:job.payload.webhookEventId,p_job_id:job.id,p_lease_token:job.lease_token,p_error_code:"RECONCILIATION_REQUIRED"});
          else await rpc("fail_job",{p_id:job.id,p_lease_token:job.lease_token,p_error_code:"RECONCILIATION_REQUIRED"});failed++;
        }
      }
      return {claimed:jobs.length,done,failed};
    },
    async receiveWebhook(bytes:Uint8Array,eventId:string|null){
      const value=z.object({event:z.string(),payload:z.object({payment:z.object({entity:z.object({id:z.string(),order_id:z.string()})}).optional(),refund:z.object({entity:z.object({payment_id:z.string()})}).optional(),order:z.object({entity:z.object({id:z.string()})}).optional()})}).parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
      const references={...(value.payload.payment?{providerPaymentId:value.payload.payment.entity.id,providerOrderId:value.payload.payment.entity.order_id}:{}),...(value.payload.refund?{providerPaymentId:value.payload.refund.entity.payment_id}:{}),...(value.payload.order?{providerOrderId:value.payload.order.entity.id}:{})};
      if(!Object.keys(references).length)throw new Error("INVALID_PAYLOAD");
      // Signature checked by HTTP boundary over raw bytes. Persist minimal references and raw-byte hash, never payment PII.
      await rpc("receive_webhook",{p_provider:"razorpay",p_environment:environment().APP_MODE==="live"?"live":"test",p_provider_event_id:eventId,p_payload_hash:createHash("sha256").update(bytes).digest("hex"),p_verification_result:"verified",p_payload:{event:value.event,...references}});
      return {received:true};
    },
  };
}
export const checkoutService=createCheckoutService();
