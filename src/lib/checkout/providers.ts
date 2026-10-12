import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { integrationConfig, readEnvironment, type Environment } from "../../config/env.ts";
import { paise } from "./contracts.ts";

export class ProviderError extends Error {
  readonly code: "UPSTREAM_UNKNOWN" | "UPSTREAM_REJECTED" | "UPSTREAM_UNAVAILABLE" | "INTEGRATION_UNCONFIGURED" | "PAYMENT_MISMATCH";
  constructor(code:ProviderError["code"]) {super(code);this.code=code;}
}
export function validSignature(bytes: string | Uint8Array, signature: string | null, secret: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac("sha256",secret).update(bytes).digest(),Buffer.from(signature,"hex"));
}
const orderSchema=z.object({id:z.string(),amount:paise,currency:z.string(),receipt:z.string().nullable(),status:z.string()});
export const paymentSchema=z.object({id:z.string(),order_id:z.string(),amount:paise,currency:z.string(),status:z.enum(["created","authorized","captured","refunded","failed"]),amount_refunded:paise.default(0)});
export type ProviderPayment=z.infer<typeof paymentSchema>;
export type ProviderOrder=z.infer<typeof orderSchema>;
export const refundSchema=z.object({
  id:z.string().regex(/^rfnd_[A-Za-z0-9]+$/),payment_id:z.string().regex(/^pay_[A-Za-z0-9]+$/),
  amount:paise.min(1),currency:z.string().regex(/^[A-Z]{3}$/),status:z.enum(["pending","processed","failed"]),
});
export type ProviderRefund=z.infer<typeof refundSchema>;
export interface PaymentProvider {
  keyId:string|null; mode:"test"|"live";
  create(orderId:string,amount:number):Promise<ProviderOrder>;
  find(orderId:string,createdAt:string):Promise<ProviderOrder|null>;
  order(id:string):Promise<ProviderOrder>;
  payments(id:string):Promise<ProviderPayment[]>;
  payment(id:string):Promise<ProviderPayment>;
  refunds(paymentId:string):Promise<ProviderRefund[]>;
  verify(storedOrderId:string,paymentId:string,signature:string):boolean;
}
const receipt=(id:string)=>`yb_${id.replaceAll("-","")}`;
/** REST adapter has no retry on POST. A timeout is ambiguous and must be reconciled. */
export function paymentProvider(env:Environment=readEnvironment(),transport:typeof fetch=fetch):PaymentProvider {
  const mode=env.APP_MODE==="live"?"live":"test";
  if(env.APP_MODE==="fixture") throw new ProviderError("INTEGRATION_UNCONFIGURED"); // durable fixture state is supplied by the service/database
  const config=integrationConfig("razorpay",env);
  async function request(path:string,body?:unknown):Promise<unknown>{
    let response:Response;
    try {response=await transport(`https://api.razorpay.com/v1/${path}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString("base64")}`,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000),cache:"no-store"});}
    catch{throw new ProviderError(body===undefined?"UPSTREAM_UNAVAILABLE":"UPSTREAM_UNKNOWN");}
    if(!response.ok) throw new ProviderError(body!==undefined && response.status>=500?"UPSTREAM_UNKNOWN":response.status>=500?"UPSTREAM_UNAVAILABLE":"UPSTREAM_REJECTED");
    try{return await response.json();}catch{throw new ProviderError(body===undefined?"UPSTREAM_UNAVAILABLE":"UPSTREAM_UNKNOWN");}
  }
  return {keyId:config.RAZORPAY_KEY_ID,mode,
    async create(id,amount){return orderSchema.parse(await request("orders",{amount,currency:"INR",receipt:receipt(id),partial_payment:false,notes:{store_order_id:id}}));},
    async find(id,createdAt){
      // Bounded time-window pagination, matching our own receipt. An absent result is NOT permission to repeat a create.
      const found:ProviderOrder[]=[]; const from=Math.max(0,Math.floor(new Date(createdAt).getTime()/1000)-60);
      for(let skip=0;skip<1000;skip+=100){
        const page=z.object({items:z.array(orderSchema)}).parse(await request(`orders?from=${from}&count=100&skip=${skip}`));
        found.push(...page.items.filter(o=>o.receipt===receipt(id)));
        if(found.length>1) throw new ProviderError("PAYMENT_MISMATCH");
        if(page.items.length<100) return found[0]??null;
      }
      throw new ProviderError("UPSTREAM_UNKNOWN");
    },
    async order(id){return orderSchema.parse(await request(`orders/${encodeURIComponent(id)}`));},
    async payments(id){return z.object({items:z.array(paymentSchema)}).parse(await request(`orders/${encodeURIComponent(id)}/payments`)).items;},
    async payment(id){return paymentSchema.parse(await request(`payments/${encodeURIComponent(id)}`));},
    async refunds(paymentId){
      z.string().regex(/^pay_[A-Za-z0-9]+$/).parse(paymentId);
      // This endpoint defaults to ten rows. Never report a partial page scan as a settled total.
      // https://razorpay.com/docs/api/refunds/fetch-multiple-refund-payment
      const found=new Map<string,ProviderRefund>();
      for(let skip=0;skip<1000;skip+=100){
        const parsed=z.object({items:z.array(refundSchema).max(100)}).safeParse(await request(`payments/${encodeURIComponent(paymentId)}/refunds?count=100&skip=${skip}`));
        if(!parsed.success)throw new ProviderError("PAYMENT_MISMATCH");
        for(const refund of parsed.data.items){
          if(refund.payment_id!==paymentId||refund.currency!=="INR")throw new ProviderError("PAYMENT_MISMATCH");
          const previous=found.get(refund.id);
          if(previous&&(previous.amount!==refund.amount||previous.status!==refund.status))throw new ProviderError("UPSTREAM_UNKNOWN");
          found.set(refund.id,refund);
        }
        if(parsed.data.items.length<100)return [...found.values()];
      }
      throw new ProviderError("UPSTREAM_UNKNOWN");
    },
    verify(id,payment,signature){return validSignature(`${id}|${payment}`,signature,config.RAZORPAY_KEY_SECRET);},
  };
}

export type Parcel={pickupPincode:string;deliveryPincode:string;weightG:number;lengthCm:number;widthCm:number;heightCm:number};
export type ShippingQuote={serviceable:boolean;costPaise:number;serviceKey:string;label:string};
export async function shippingQuote(parcel:Parcel,env:Environment=readEnvironment(),transport:typeof fetch=fetch):Promise<ShippingQuote>{
  if(env.APP_MODE!=="live"){
    if(parcel.deliveryPincode==="999999") return {serviceable:false,costPaise:0,serviceKey:"fixture-unavailable",label:"Fixture delivery unavailable"};
    if(parcel.deliveryPincode==="888888") throw new ProviderError("UPSTREAM_UNAVAILABLE");
    return {serviceable:true,costPaise:7500,serviceKey:"fixture-standard",label:"Fixture standard delivery — ₹75 sample courier rate; no shipment"};
  }
  const config=integrationConfig("shiprocket",env);
  try{
    const login=await transport("https://apiv2.shiprocket.in/v1/external/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:config.SHIPROCKET_API_EMAIL,password:config.SHIPROCKET_API_PASSWORD}),signal:AbortSignal.timeout(10000),cache:"no-store"});
    if(!login.ok)throw new ProviderError("UPSTREAM_UNAVAILABLE");
    const {token}=z.object({token:z.string().min(1)}).parse(await login.json());
    const query=new URLSearchParams({pickup_postcode:parcel.pickupPincode,delivery_postcode:parcel.deliveryPincode,cod:"0",weight:String(parcel.weightG/1000),length:String(parcel.lengthCm),breadth:String(parcel.widthCm),height:String(parcel.heightCm)});
    const response=await transport(`https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${query}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000),cache:"no-store"});
    if(!response.ok)throw new ProviderError("UPSTREAM_UNAVAILABLE");
    const courier=z.object({courier_company_id:z.number().int(),courier_name:z.string(),rate:z.coerce.number().finite().nonnegative().max(100000)});
    const data=z.object({data:z.object({available_courier_companies:z.array(courier)})}).parse(await response.json());
    const selected=data.data.available_courier_companies.sort((a,b)=>a.rate-b.rate||a.courier_company_id-b.courier_company_id)[0];
    return selected?{serviceable:true,costPaise:Math.round(selected.rate*100),serviceKey:String(selected.courier_company_id),label:"Standard delivery — estimate confirmed by carrier"}:{serviceable:false,costPaise:0,serviceKey:"unavailable",label:"Delivery unavailable"};
  }catch{throw new ProviderError("UPSTREAM_UNAVAILABLE");}
}

export async function sendOrderNotification(input:{id:string;email:string;orderNumber:string;orderId:string;firstAttemptAt:string|null},env:Environment=readEnvironment(),transport:typeof fetch=fetch){
  if(env.APP_MODE==="fixture") return {status:"unconfigured" as const,providerId:null,error:"FIXTURE_NO_EMAIL"};
  let config:ReturnType<typeof integrationConfig<"notifications">>;
  try{config=integrationConfig("notifications",env);}catch{return {status:"unconfigured" as const,providerId:null,error:"INTEGRATION_UNCONFIGURED"};}
  if(config.TRANSACTIONAL_EMAIL_PROVIDER!=="resend")return {status:"unconfigured" as const,providerId:null,error:"INTEGRATION_UNCONFIGURED"};
  // Resend retains idempotency for 24h. Never risk a duplicate after that window.
  if(input.firstAttemptAt&&Date.now()-new Date(input.firstAttemptAt).getTime()>23*3600000)return {status:"failed" as const,providerId:null,error:"RECONCILIATION_REQUIRED"};
  try{
    const response=await transport("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${config.TRANSACTIONAL_EMAIL_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`order-notification/${input.id}`},body:JSON.stringify({from:config.TRANSACTIONAL_EMAIL_FROM,to:[input.email],subject:`Payment received for ${input.orderNumber}`,text:`We received your payment for ${input.orderNumber}. View the current order status securely at ${env.APP_URL}/orders/${input.orderId}. Use Track order to verify your email if this browser no longer has access.`}),signal:AbortSignal.timeout(10000),cache:"no-store"});
    if(!response.ok) throw new ProviderError("UPSTREAM_UNAVAILABLE");
    const {id}=z.object({id:z.string()}).parse(await response.json());return {status:"sent" as const,providerId:id,error:null};
  }catch{return {status:"failed" as const,providerId:null,error:"UPSTREAM_UNKNOWN"};}
}
