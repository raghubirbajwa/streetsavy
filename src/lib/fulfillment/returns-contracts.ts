import { z } from "zod";
const id=z.string().uuid(), count=z.number().int().min(0).max(10000), money=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const returnRequestInputSchema=z.object({items:z.array(z.object({orderItemId:id,quantity:count.min(1)}).strict()).min(1).max(100),reason:z.string().trim().min(3).max(1000)}).strict();
export const returnActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('approve'),version:count.min(1),notes:z.string().trim().min(3).max(2000)}).strict(),
 z.object({action:z.literal('reject'),version:count.min(1),notes:z.string().trim().min(3).max(2000)}).strict(),
 z.object({action:z.literal('reverse'),version:count.min(1),reference:z.string().trim().min(3).max(200),notes:z.string().trim().min(3).max(2000)}).strict(),
 z.object({action:z.literal('receive'),version:count.min(1),notes:z.string().trim().min(3).max(2000),items:z.array(z.object({returnItemId:id,receivedQuantity:count}).strict()).min(1).max(100)}).strict(),
 z.object({action:z.literal('inspect'),version:count.min(1),notes:z.string().trim().min(3).max(2000),items:z.array(z.object({returnItemId:id,acceptedQuantity:count,disposition:z.enum(['sellable','damaged','discard'])}).strict()).min(1).max(100)}).strict(),
 z.object({action:z.literal('restock'),version:count.min(1),notes:z.string().trim().min(3).max(2000),items:z.array(z.object({returnItemId:id,quantity:count.min(1)}).strict()).min(1).max(100)}).strict(),
]);
export const returnSchema=z.object({id,orderId:id,orderNumber:z.string(),kind:z.enum(['customer','rto']),status:z.enum(['requested','approved','rejected','pickup_pending','in_transit','received','inspected','closed']),reason:z.string(),version:count.min(1),requestedAt:z.string(),receivedAt:z.string().nullable(),reverseReference:z.string().nullable(),inspectionNotes:z.string().nullable(),items:z.array(z.object({id,orderItemId:id,title:z.string(),color:z.string(),size:z.string(),quantity:count,receivedQuantity:count,acceptedQuantity:count,restockQuantity:count,disposition:z.enum(['pending','sellable','damaged','discard']).nullable()}))});
export const returnEligibilitySchema=z.object({eligible:z.boolean(),reason:z.string().nullable(),deadline:z.string().nullable(),windowDays:count,items:z.array(z.object({orderItemId:id,title:z.string(),color:z.string(),size:z.string(),purchasedQuantity:count,returnableQuantity:count})),requests:z.array(returnSchema)});
export const refundInputSchema=z.object({amountPaise:money.min(100),reason:z.string().trim().min(3).max(1000),returnRequestId:id.optional()}).strict();
export const refundSchema=z.object({id,orderId:id,amountPaise:money,status:z.enum(['requested','processing','processed','failed','unknown']),providerRefundId:z.string().nullable(),operationId:id,reason:z.string(),returnRequestId:id.nullable(),createdAt:z.string(),processedAt:z.string().nullable(),safeError:z.string().nullable(),fixture:z.boolean()});
export const refundSummarySchema=z.object({capturedPaise:money,processedPaise:money,reservedPaise:money,refundablePaise:money,refunds:z.array(refundSchema)});
export const cancellationSchema=z.object({orderId:id,status:z.enum(['cancelled','pending','too_late']),refundRequired:z.boolean()});
export const cancellationInputSchema=z.object({reason:z.string().trim().min(3).max(1000)}).strict();
export const fixtureRefundInputSchema=z.object({outcome:z.enum(['processed','pending','failed','timeout'])}).strict();
export type ReturnRequest=z.infer<typeof returnSchema>;
export type Refund=z.infer<typeof refundSchema>;
