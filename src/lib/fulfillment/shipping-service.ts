import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {readEnvironment,type Environment} from '../../config/env.ts';
import {adminRpc} from '../admin/db.ts';
import {hashGuestToken,type CartRpc} from '../cart/service.ts';
import {operationSchema,jobSchema} from '../jobs/contracts.ts';
import {shipmentSchema,fulfillmentQuoteSchema,shippingTrackingSchema,shippingQuoteInputSchema,shippingBookInputSchema,shippingActionInputSchema,shippingFixtureInputSchema,shipmentActionSchema,type ShipmentAction,type Parcel} from './shipping-contracts.ts';
import {shippingProvider,ShippingProviderError,type ShippingProvider,type ShippingObservation,type ShippingCreate} from './shipping-provider.ts';
const address=z.object({fullName:z.string(),line1:z.string(),line2:z.string().optional(),city:z.string(),stateCode:z.string(),pincode:z.string(),email:z.string(),phone:z.string()});
const contextSchema=z.object({order:z.object({id:z.string(),version:z.number(),mode:z.enum(['test','live']),fixture:z.boolean(),created_at:z.string(),items_payable_paise:z.number(),shipping_fee_paise:z.number(),shipping_address_snapshot:address}),warehouse:z.object({pickup_location:z.string(),address:z.object({pincode:z.string()}).passthrough()}).passthrough(),items:z.array(z.object({product_title:z.string(),sku:z.string(),quantity:z.number(),unit_price_paise:z.number()}))});
const rawShipment=z.object({id:z.string().uuid(),order_id:z.string().uuid(),fixture:z.boolean(),version:z.number(),booking_status:z.string(),pickup_status:z.string(),transit_status:z.string(),provider_order_id:z.string().nullable(),provider_shipment_id:z.string().nullable(),awb:z.string().nullable(),courier_id:z.string(),actual_weight_g:z.number(),length_cm:z.coerce.number(),width_cm:z.coerce.number(),height_cm:z.coerce.number(),fixture_controls:z.record(z.unknown())});
const operationContext=z.object({action:z.enum(['create','assign-awb','label','pickup','cancel','sync']),operation:operationSchema,shipment:rawShipment,context:contextSchema});
const observationSchema=z.object({providerOrderId:z.string(),providerShipmentId:z.string(),awb:z.string().nullable(),pickupScheduled:z.boolean(),status:z.enum(['not_shipped','in_transit','out_for_delivery','delivered','exception','rto_in_transit','rto_delivered','cancelled','unknown']),rawStatus:z.string(),occurredAt:z.string()});
const idKey=z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);
function fixturePdf(id:string,awb:string|null){const text=`FIXTURE LABEL - NOT VALID FOR CARRIER USE | Shipment ${id} | AWB ${awb??'pending'}`;const stream=`BT /F1 10 Tf 30 750 Td (${text}) Tj ET`;const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);}
export function createShippingService(deps:{rpc?:CartRpc;env?:Environment;provider?:ShippingProvider}={}){
 const rpc=deps.rpc??adminRpc,env=()=>deps.env??readEnvironment(),adapter=()=>deps.provider??shippingProvider(env());
 const internal=(action:string,id:string|null=null,data:Record<string,unknown>={})=>rpc('shipping_internal',{p_action:action,p_id:id,p_data:data});
 const admin=(actor:string,action:string,id:string,data:Record<string,unknown>={})=>rpc('shipping_admin',{p_actor:actor,p_action:action,p_id:id,p_data:data});
 const detail=async(actor:string,id:string)=>shipmentSchema.parse(await admin(actor,'detail',id));
 const mode=(s:z.infer<typeof rawShipment>,ctx:z.infer<typeof contextSchema>)=>{if(s.fixture!==(env().APP_MODE!=='live')||ctx.order.mode!==(env().APP_MODE==='live'?'live':'test')||ctx.order.fixture!==(env().APP_MODE==='fixture'))throw new ShippingProviderError('INTEGRATION_UNCONFIGURED');};
 const parcel=(s:z.infer<typeof rawShipment>):Parcel=>({weightG:s.actual_weight_g,lengthCm:s.length_cm,widthCm:s.width_cm,heightCm:s.height_cm});
 async function observe(s:z.infer<typeof rawShipment>,source='poll'):Promise<ShippingObservation>{
  if(!s.fixture){if(!s.provider_order_id||!s.provider_shipment_id)throw new ShippingProviderError();return adapter().inspect(s.provider_order_id,s.provider_shipment_id);}
  const stored=observationSchema.safeParse(s.fixture_controls.provider);
  if(!stored.success)throw new ShippingProviderError();
  const value=stored.data;
  await internal('event',s.id,{status:value.status,rawStatus:value.rawStatus,occurredAt:value.occurredAt,source});
  return value;
 }
 async function applyObservation(s:z.infer<typeof rawShipment>,value:ShippingObservation,source='poll'){
  if(s.provider_shipment_id&&s.provider_shipment_id!==value.providerShipmentId||s.provider_order_id&&s.provider_order_id!==value.providerOrderId)throw new ShippingProviderError();
  for(const event of [...(value.events??[])].sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)))await internal('event',s.id,{...event,source});
  await internal('event',s.id,{status:value.status,rawStatus:value.rawStatus,occurredAt:value.occurredAt,pickupScheduled:value.pickupScheduled,source});
 }
 async function processOperation(id:string){
  const ctx=operationContext.parse(await internal('operation',id));mode(ctx.shipment,ctx.context);let op=ctx.operation;
  if(op.status==='succeeded')return;
  if(op.status==='failed')throw new ShippingProviderError('UPSTREAM_REJECTED');
  try{op=operationSchema.parse(await rpc('shipping_claim_operation',{p_id:id}));}catch(error){if(error instanceof Error&&error.message==='OPERATION_BUSY')return;throw error;}
  const s=ctx.shipment;
  let result:Record<string,unknown>={};
  try{
   if(op.status==='unknown'){
    const found=ctx.action==='create'?(s.fixture?observationSchema.safeParse(s.fixture_controls.provider).data??null:await adapter().find(s.id)):await observe(s);
    if(!found)throw new ShippingProviderError();
    if(ctx.action==='create')result={providerOrderId:found.providerOrderId,providerShipmentId:found.providerShipmentId};
    else if(ctx.action==='assign-awb'&&found.awb)result={awb:found.awb};
    else if(ctx.action==='pickup'&&found.pickupScheduled)result={};
    else if(ctx.action==='cancel'&&found.status==='cancelled')result={};
    else if(ctx.action==='label')result={contentBase64:Buffer.from(s.fixture?fixturePdf(s.id,s.awb):await adapter().label(found.providerShipmentId)).toString('base64')};
    else if(ctx.action==='sync'){await applyObservation(s,found);result={};}
    else throw new ShippingProviderError();
   }else if(op.status==='running'){
    if(ctx.action==='create'){
     let value:ShippingObservation;
     if(s.fixture){value={providerOrderId:'fixture-order-'+s.id,providerShipmentId:'fixture-shipment-'+s.id,awb:null,pickupScheduled:false,status:'not_shipped',rawStatus:'NEW',occurredAt:new Date().toISOString()};await internal('fixtureControls',s.id,{provider:value});if(s.fixture_controls.createTimeout){await internal('fixtureControls',s.id,{createTimeout:false});throw new ShippingProviderError();}}
     else{const c=ctx.context;const input:ShippingCreate={id:s.id,createdAt:c.order.created_at,pickupLocation:c.warehouse.pickup_location,address:c.order.shipping_address_snapshot,items:c.items.map(i=>({title:i.product_title,sku:i.sku,quantity:i.quantity,unitPricePaise:i.unit_price_paise})),itemsPaise:c.order.items_payable_paise,shippingFeePaise:c.order.shipping_fee_paise,parcel:parcel(s)};value=await adapter().create(input);}
     result={providerOrderId:value.providerOrderId,providerShipmentId:value.providerShipmentId};
    }else if(ctx.action==='sync'){await sync(s.id);}
    else{
     if(ctx.action==='cancel'&&!s.provider_order_id&&!s.provider_shipment_id&&s.booking_status==='failed'){await internal('complete',s.id,{operationId:id,leaseToken:op.lease_token});return;}
     if(!s.provider_order_id||!s.provider_shipment_id)throw new ShippingProviderError();
     if(ctx.action==='assign-awb'){result=s.fixture?{awb:'FIX'+s.id.replaceAll('-','').slice(0,18)}:await adapter().assignAwb(s.provider_shipment_id,s.courier_id);if(s.fixture){const value=await observe(s);await internal('fixtureControls',s.id,{provider:{...value,awb:result.awb}});}}
     else if(ctx.action==='label')result={contentBase64:Buffer.from(s.fixture?fixturePdf(s.id,s.awb):await adapter().label(s.provider_shipment_id)).toString('base64')};
     else if(ctx.action==='pickup'){
      if(s.fixture){if(s.fixture_controls.failPickupOnce===true||s.fixture_controls.action==='failPickupOnce'){await internal('fixtureControls',s.id,{failPickupOnce:false,action:null});throw new ShippingProviderError('UPSTREAM_REJECTED');}const value=await observe(s);await internal('fixtureControls',s.id,{provider:{...value,pickupScheduled:true}});}else await adapter().pickup(s.provider_shipment_id);
     }else if(ctx.action==='cancel'){
      const value=await observe(s);await applyObservation(s,value);
      if(!['not_shipped','cancelled'].includes(value.status))throw new ShippingProviderError('UPSTREAM_REJECTED');
      if(s.fixture)await internal('fixtureControls',s.id,{provider:{...value,status:'cancelled',rawStatus:'CANCELED',occurredAt:new Date().toISOString()}});
      else {await adapter().cancel(s.provider_order_id);const after=await adapter().inspect(s.provider_order_id,s.provider_shipment_id);await applyObservation(s,after);if(after.status!=='cancelled')throw new ShippingProviderError();}
     }
    }
   }else return;
   await internal('complete',s.id,{operationId:id,leaseToken:op.lease_token,...result});
  }catch(error){
   const status=error instanceof ShippingProviderError&&error.code==='UPSTREAM_REJECTED'?'failed':'unknown';
   if(op.status==='running')await rpc('finish_operation',{p_id:id,p_lease_token:op.lease_token,p_status:status,p_error_code:status==='failed'?'UPSTREAM_REJECTED':'UPSTREAM_UNKNOWN'});
   await internal('failure',s.id,{action:ctx.action,status});throw error;
  }
 }
 async function sync(id:string){
  let raw=z.object({shipment:rawShipment,context:contextSchema}).parse(await internal('shipment',id));mode(raw.shipment,raw.context);
  // Resolve each prior ambiguity before allowing another external action.
  const rows=shipmentSchema.parse((await internal('orderShipments',raw.shipment.order_id) as unknown[]).find((r)=>z.object({id:z.string()}).parse(r).id===id));
  for(const operation of rows.operations.filter(o=>o.status==='unknown'&&o.action!=='sync'))await processOperation(operation.id);
  raw=z.object({shipment:rawShipment,context:contextSchema}).parse(await internal('shipment',id));
  if(!raw.shipment.provider_order_id)throw new ShippingProviderError();
  const observed=await observe(raw.shipment);await applyObservation(raw.shipment,observed);await internal('checked',id);
 }
 async function attempt(id:string){try{await processOperation(id);}catch(error){if(!(error instanceof ShippingProviderError)&&!(error instanceof z.ZodError))throw error;}}
 return {
  detail,sync,
  async quotes(actor:string,orderId:string,input:unknown){const data=shippingQuoteInputSchema.parse(input);const raw=await admin(actor,'context',orderId);const ctx=contextSchema.parse(raw);if(ctx.order.fixture!==(env().APP_MODE==='fixture')||ctx.order.mode!==(env().APP_MODE==='live'?'live':'test'))throw new ShippingProviderError('INTEGRATION_UNCONFIGURED');const p={weightG:data.weightG,lengthCm:data.lengthCm,widthCm:data.widthCm,heightCm:data.heightCm};const quotes=env().APP_MODE==='live'?await adapter().quotes({...p,pickupPincode:ctx.warehouse.address.pincode,deliveryPincode:ctx.order.shipping_address_snapshot.pincode}):[{courierId:'fixture-standard',courierName:'Fixture Standard (simulated)',costPaise:7500+Math.max(0,Math.ceil((p.weightG-500)/500))*2000},{courierId:'fixture-express',courierName:'Fixture Express (simulated)',costPaise:12500+Math.max(0,Math.ceil((p.weightG-500)/500))*3000}];return z.object({quotes:z.array(fulfillmentQuoteSchema),orderVersion:z.number()}).parse(await admin(actor,'quotes',orderId,{orderVersion:data.orderVersion,parcel:p,warehouse:ctx.warehouse,quotes}));},
  async book(actor:string,orderId:string,input:unknown,key:string){const data=shippingBookInputSchema.parse(input);idKey.parse(key);await rpc('require_admin_actor',{p_actor:actor});const check=contextSchema.parse(await rpc('shipping_context',{p_order_id:orderId}));if(check.order.fixture!==(env().APP_MODE==='fixture')||check.order.mode!==(env().APP_MODE==='live'?'live':'test'))throw new ShippingProviderError('INTEGRATION_UNCONFIGURED');const result=z.object({shipmentId:z.string(),operationId:z.string()}).parse(await admin(actor,'book',orderId,{...data,key}));await attempt(result.operationId);return detail(actor,result.shipmentId);},
  async action(actor:string,id:string,action:ShipmentAction,input:unknown,key:string){shipmentActionSchema.parse(action);idKey.parse(key);const data=shippingActionInputSchema.parse(input);await admin(actor,'detail',id);const check=z.object({shipment:rawShipment,context:contextSchema}).parse(await internal('shipment',id));mode(check.shipment,check.context);const result=z.object({operationId:z.string(),shipmentId:z.string()}).parse(await admin(actor,'reserve',id,{...data,action,key}));await attempt(result.operationId);return detail(actor,id);},
  async forOrder(actor:string,id:string){return z.array(shipmentSchema).parse(await admin(actor,'forOrder',id));},
  async tracking(orderId:string,token:string|undefined,userId:string|null=null){return shippingTrackingSchema.parse(await rpc('shipping_tracking',{p_order_id:orderId,p_token_hash:hashGuestToken(token),p_user_id:userId}));},
  async label(actor:string,id:string){const value=z.object({contentBase64:z.string().nullable()}).parse(await admin(actor,'label',id));if(!value.contentBase64)throw new Error('NOT_FOUND');return {bytes:Buffer.from(value.contentBase64,'base64'),contentType:'application/pdf',fileName:`shipping-label-${id}.pdf`};},
  async fixture(actor:string,id:string,input:unknown){if(env().APP_MODE!=='fixture')throw new Error('FORBIDDEN');const data=shippingFixtureInputSchema.parse(input);if(data.action==='createTimeout'){await admin(actor,'fixtureOrder',id);return {configured:true};}let dto=shipmentSchema.parse(await admin(actor,'fixture',id,data.action==='failPickupOnce'?{failPickupOnce:true}:{action:'track'}));if(data.action==='track'){if(!data.status)throw new Error('INVALID_PAYLOAD');const raw=z.object({shipment:rawShipment,context:contextSchema}).parse(await internal('shipment',id));if(!raw.shipment.provider_shipment_id||!raw.shipment.awb)throw new Error('SHIPMENT_STATE_CONFLICT');const value=await observe(raw.shipment);await internal('fixtureControls',id,{provider:{...value,status:data.status,rawStatus:'FIXTURE '+data.status.toUpperCase(),occurredAt:data.occurredAt??new Date().toISOString()}});await sync(id);dto=await detail(actor,id);}return dto;},
  async cancelForOrder(orderId:string):Promise<'clear'|'unknown'|'too_late'>{const shipments=z.array(shipmentSchema).parse(await internal('orderShipments',orderId));for(const s of shipments){if(s.bookingStatus==='cancelled')continue;if(s.pickupStatus==='picked_up'||!['not_shipped','cancelled'].includes(s.transitStatus))return 'too_late';try{if(s.bookingStatus!=='failed')await sync(s.id);const op=z.string().parse(await internal('cancelReserve',s.id));await processOperation(op);}catch{return 'unknown';}}const latest=z.array(shipmentSchema).parse(await internal('orderShipments',orderId));return latest.every(s=>s.bookingStatus==='cancelled')?'clear':'unknown';},
  async retryOperation(actor:string,id:string){const value=z.object({shipmentId:z.string(),operationId:z.string()}).parse(await rpc('shipping_retry',{p_actor:actor,p_id:id}));await attempt(id);return detail(actor,value.shipmentId);},
  async receiveWebhook(bytes:Uint8Array,eventId:string|null=null){const raw=z.object({shipment_id:z.union([z.string(),z.number()]).optional(),awb:z.union([z.string(),z.number()]).optional()}).parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));if(!raw.shipment_id&&!raw.awb)throw new Error('INVALID_PAYLOAD');await rpc('receive_webhook',{p_provider:'shiprocket',p_environment:env().APP_MODE==='live'?'live':'test',p_provider_event_id:eventId,p_payload_hash:createHash('sha256').update(bytes).digest('hex'),p_verification_result:'hint',p_payload:{...(raw.shipment_id?{shipmentId:String(raw.shipment_id)}:{}),...(raw.awb?{awb:String(raw.awb)}:{})}});return {received:true};},
  async runJobs(){const due=z.array(z.string()).parse(await internal('due'));for(const id of due)await rpc('enqueue_job',{p_type:'shipping.sync',p_dedupe_key:`shipping-sync:${id}:${Math.floor(Date.now()/1800000)}`,p_payload:{shipmentId:id},p_max_attempts:8});const jobs=z.array(jobSchema).parse(await rpc('shipping_claim_jobs',{}));let done=0,failed=0;for(const job of jobs){const webhook=job.type.startsWith('webhook.');try{if(job.type==='shipping.operation')await processOperation(z.string().parse(job.payload.operationId));else if(job.type==='shipping.sync')await sync(z.string().parse(job.payload.shipmentId));else{const event=z.object({environment:z.string(),payload:z.record(z.unknown())}).parse(await internal('webhook',z.string().parse(job.payload.webhookEventId)));if(event.environment!==(env().APP_MODE==='live'?'live':'test'))throw new Error('FORBIDDEN');const id=z.string().parse(await internal('lookup',null,event.payload));await sync(id);}if(webhook)await rpc('finish_webhook',{p_event_id:job.payload.webhookEventId,p_job_id:job.id,p_lease_token:job.lease_token});else await rpc('complete_job',{p_id:job.id,p_lease_token:job.lease_token});done++;}catch{if(webhook)await rpc('finish_webhook',{p_event_id:job.payload.webhookEventId,p_job_id:job.id,p_lease_token:job.lease_token,p_error_code:'RECONCILIATION_REQUIRED'});else await rpc('fail_job',{p_id:job.id,p_lease_token:job.lease_token,p_error_code:'RECONCILIATION_REQUIRED'});failed++;}}return {claimed:jobs.length,done,failed};},
 };
}
export const shippingService=createShippingService();
