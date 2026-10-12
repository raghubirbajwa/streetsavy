import 'server-only';
import { z } from 'zod';
import { integrationConfig, type Environment } from '../../config/env.ts';
import { ProviderError } from '../checkout/providers.ts';
export const providerRefundSchema=z.object({id:z.string().min(1).max(200),payment_id:z.string().min(1),amount:z.number().int().min(100).max(Number.MAX_SAFE_INTEGER),currency:z.literal('INR'),status:z.enum(['pending','processed','failed']),receipt:z.string().nullable().optional(),notes:z.union([z.record(z.unknown()),z.array(z.unknown())]).optional()});
export type RefundObservation=z.infer<typeof providerRefundSchema>;
export type RefundProvider={mode:'test'|'live';create(paymentId:string,refundId:string,amount:number):Promise<RefundObservation>;get(id:string):Promise<RefundObservation>;find(paymentId:string,refundId:string):Promise<RefundObservation|null>};
export const refundReceipt=(id:string)=>`rf_${id.replaceAll('-','')}`;
/** The receipt/notes correlate ambiguous creates; neither is assumed to be provider idempotency. */
export function razorpayRefundProvider(env:Environment,transport:typeof fetch=fetch):RefundProvider{
 if(env.APP_MODE==='fixture')throw new Error('FORBIDDEN');
 const config=integrationConfig('razorpay',env); const mode=env.APP_MODE==='live'?'live':'test';
 const headers={Authorization:`Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')}`,'Content-Type':'application/json'};
 async function request(path:string,body?:unknown){
  try{
   const response=await transport(`https://api.razorpay.com/v1/${path}`,{method:body===undefined?'GET':'POST',headers,signal:AbortSignal.timeout(10000),...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok)throw new ProviderError(body===undefined?'UPSTREAM_UNAVAILABLE':'UPSTREAM_UNKNOWN');
   return await response.json() as unknown;
  }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError(body===undefined?'UPSTREAM_UNAVAILABLE':'UPSTREAM_UNKNOWN');}
 }
 const parse=(value:unknown)=>{const parsed=providerRefundSchema.safeParse(value);if(!parsed.success)throw new ProviderError('UPSTREAM_UNKNOWN');return parsed.data;};
 return {mode,
  async create(paymentId,refundId,amount){return parse(await request(`payments/${encodeURIComponent(paymentId)}/refund`,{amount,speed:'normal',receipt:refundReceipt(refundId),notes:{store_refund_id:refundId}}));},
  async get(id){const result=parse(await request(`refunds/${encodeURIComponent(id)}`));if(result.id!==id)throw new Error('REFUND_MISMATCH');return result;},
  async find(paymentId,refundId){
   const found=new Map<string,RefundObservation>();
   for(let skip=0;skip<1000;skip+=100){
    const page=z.object({items:z.array(providerRefundSchema).max(100)}).safeParse(await request(`payments/${encodeURIComponent(paymentId)}/refunds?count=100&skip=${skip}`));
    if(!page.success)throw new ProviderError('UPSTREAM_UNKNOWN');
    for(const row of page.data.items){
     if(row.payment_id!==paymentId)throw new Error('REFUND_MISMATCH');
     const note=row.notes&&!Array.isArray(row.notes)?row.notes.store_refund_id:undefined;
     if(row.receipt===refundReceipt(refundId)||note===refundId){if(found.has(row.id)&&JSON.stringify(found.get(row.id))!==JSON.stringify(row))throw new Error('REFUND_MISMATCH');found.set(row.id,row);}
    }
    if(found.size>1)throw new Error('REFUND_MISMATCH');
    if(page.data.items.length<100)return [...found.values()][0]??null;
   }
   throw new ProviderError('UPSTREAM_UNKNOWN');
  },
 };
}
