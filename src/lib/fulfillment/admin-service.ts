import 'server-only';
import { z } from 'zod';
import { adminRpc } from '../admin/db.ts';
import { type CartRpc } from '../cart/service.ts';
import { checkoutService } from '../checkout/service.ts';
import { shippingService } from './shipping-service.ts';
import { returnsService } from './returns-service.ts';
import { adminOrderListSchema, orderFiltersSchema, orderDetailBaseSchema, operationsSchema, resolveInputSchema } from './admin-contracts.ts';
const uuid=z.string().uuid();
export function createFulfillmentAdminService(rpc:CartRpc=adminRpc){return {
 async list(actor:string,filters:unknown){return adminOrderListSchema.parse(await rpc('fulfillment_admin_orders',{p_actor:uuid.parse(actor),p_filters:orderFiltersSchema.parse(filters)}));},
 async detail(actor:string,id:string){
  uuid.parse(actor);uuid.parse(id);const order=orderDetailBaseSchema.parse(await rpc('fulfillment_admin_order',{p_actor:actor,p_order_id:id}));
  const shipments=await shippingService.forOrder(actor,id);const returns=await returnsService.forOrder(actor,id);
  return {...order,shipments,returns};
 },
 async operations(actor:string){return operationsSchema.parse(await rpc('fulfillment_operations',{p_actor:uuid.parse(actor)}));},
 async retry(actor:string,id:string,input:unknown){
  const {reason}=z.object({reason:z.string().trim().min(8).max(1000)}).strict().parse(input);
  const target=z.object({orderId:uuid,shipmentId:uuid.nullable(),refundId:uuid.nullable()}).parse(await rpc('fulfillment_operation_target',{p_actor:uuid.parse(actor),p_id:uuid.parse(id),p_reason:reason}));
  if(target.refundId)await returnsService.retryOperation(actor,id);else if(target.shipmentId)await shippingService.retryOperation(actor,id);else await checkoutService.reconcile(target.orderId);
  return {orderId:target.orderId};
 },
 async retryJob(actor:string,id:string,input:unknown){const {reason}=z.object({reason:z.string().trim().min(8).max(1000)}).strict().parse(input);await rpc('fulfillment_retry_job',{p_actor:uuid.parse(actor),p_id:uuid.parse(id),p_reason:reason});return {queued:true};},
 async resolve(actor:string,id:string,input:unknown){const data=resolveInputSchema.parse(input);await rpc('fulfillment_resolve',{p_actor:uuid.parse(actor),p_order_id:uuid.parse(id),p_version:data.version,p_reason:data.reason});return {resolved:true};},
};}
export const fulfillmentAdminService=createFulfillmentAdminService();
