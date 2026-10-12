import 'server-only';
import { createHash,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '../auth/server.ts';
import { readJson,ApiError } from '../http/admin.ts';
import { allowAuthAttempt } from '../http/security.ts';
import { guestToken } from '../cart/http.ts';
import { verifiedUserId,entry,rawBytes } from '../checkout/http.ts';
import { integrationConfig,readEnvironment } from '../../config/env.ts';
import { shippingService } from './shipping-service.ts';
import { returnsService } from './returns-service.ts';
import { fulfillmentAdminService } from './admin-service.ts';
import { shipmentActionSchema } from './shipping-contracts.ts';
const uuid=z.string().uuid();
const missing=():never=>{throw new ApiError(404,'NOT_FOUND','This endpoint does not exist.');};
const empty=(input:unknown)=>z.object({}).strict().parse(input);
export async function adminFulfillmentGet(request:Request,resource:string,path:string[]){
 const actor=await requireAdmin();const id=path[0];if(id)uuid.parse(id);
 if(resource==='orders'){
  if(!id)return fulfillmentAdminService.list(actor.id,Object.fromEntries(new URL(request.url).searchParams));
  if(path.length===1)return fulfillmentAdminService.detail(actor.id,id);
  if(path.length===2&&path[1]==='refunds')return returnsService.refundSummary(actor.id,id);
 }
 if(resource==='shipments'&&id){if(path.length===1)return shippingService.detail(actor.id,id);if(path.length===2&&path[1]==='label'){const label=await shippingService.label(actor.id,id);return new Response(new Uint8Array(label.bytes),{headers:{'Content-Type':label.contentType,'Content-Disposition':`attachment; filename="${label.fileName}"`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});}}
 if(resource==='returns'){if(!id)return returnsService.adminList(actor.id);if(path.length===1)return returnsService.adminGet(actor.id,id);}
 if(resource==='operations'&&!id)return fulfillmentAdminService.operations(actor.id);
 return missing();
}
export async function adminFulfillmentMutate(request:Request,resource:string,path:string[]){
 const actor=await requireAdmin(resource==='refunds'||(resource==='orders'&&(path[1]==='refunds'||path[1]==='resolve')));
 const id=uuid.parse(path[0]);
 if(!allowAuthAttempt(`m5:${actor.id}:${resource}:${path[1]??'edit'}`))throw new ApiError(429,'RATE_LIMIT','Too many requests. Wait a minute and retry.');
 const body=await readJson(request,32768);const key=request.headers.get('idempotency-key')??'';
 if(request.method==='POST'&&resource==='orders'){
  if(path.length===2){switch(path[1]){
   case 'shipping-quotes':return shippingService.quotes(actor.id,id,body);
   case 'shipments':return shippingService.book(actor.id,id,body,key);
   case 'refunds':return returnsService.refund(actor.id,id,body,key);
   case 'cancel':return returnsService.cancelAdmin(actor.id,id,body);
   case 'resolve':return fulfillmentAdminService.resolve(actor.id,id,body);
   case 'fixture':return shippingService.fixture(actor.id,id,z.object({action:z.literal('createTimeout')}).strict().parse(body));
  }}
  if(path.length===3&&path[1]==='returns'&&path[2]==='rto')return returnsService.createRto(actor.id,id,body);
 }
 if(resource==='shipments'&&request.method==='POST'&&path.length===2){if(path[1]==='fixture')return shippingService.fixture(actor.id,id,body);return shippingService.action(actor.id,id,shipmentActionSchema.parse(path[1]),body,key);}
 if(resource==='returns'&&request.method==='PATCH'&&path.length===1)return returnsService.adminAction(actor.id,id,body);
 if(resource==='refunds'&&request.method==='POST'&&path.length===2){if(path[1]==='fixture')return returnsService.fixtureRefund(actor.id,id,body);if(path[1]==='sync'){empty(body);return returnsService.reconcileRefund(actor.id,id);}}
 if(resource==='operations'&&request.method==='POST'&&path.length===2&&path[1]==='retry')return fulfillmentAdminService.retry(actor.id,id,body);
 if(resource==='jobs'&&request.method==='POST'&&path.length===2&&path[1]==='retry')return fulfillmentAdminService.retryJob(actor.id,id,body);
 return missing();
}
export async function customerFulfillmentGet(request:NextRequest,id:string,action:string){uuid.parse(id);const user=await verifiedUserId();if(action==='tracking')return shippingService.tracking(id,guestToken(request),user);if(action==='returns')return returnsService.eligibility(id,guestToken(request),user);return missing();}
export async function customerReturn(request:NextRequest,id:string){entry(request,'returns');const user=await verifiedUserId();return returnsService.request(uuid.parse(id),guestToken(request),await readJson(request,16384),user);}
export async function carrierWebhook(request:NextRequest){
 const env=readEnvironment();if(env.APP_MODE!=='live')throw new ApiError(404,'NOT_FOUND','This endpoint is unavailable in this mode.');
 const token=integrationConfig('shiprocketWebhook',env).SHIPROCKET_WEBHOOK_TOKEN;
 const supplied=request.headers.get('x-api-key')??'';
 if(!timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(token).digest()))throw new ApiError(403,'FORBIDDEN','Webhook authentication failed.');
 const bytes=await rawBytes(request);return shippingService.receiveWebhook(bytes);
}
