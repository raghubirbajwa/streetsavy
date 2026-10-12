import 'server-only';
import { ApiError, adminResponse } from '../http/admin.ts';
const messages:Record<string,[number,string]>={
 DISPATCH_INELIGIBLE:[409,'Dispatch is blocked by the current payment, inventory, refund or cancellation state.'],
 SHIPMENT_EXISTS:[409,'This order already has a forward shipment. Resume its existing steps.'],
 SHIPMENT_UNKNOWN:[409,'The carrier result is uncertain. Reconcile this shipment before creating anything else.'],
 SHIPMENT_STATE_CONFLICT:[409,'Shipment status changed. Refresh it before retrying this action.'],
 ALREADY_COLLECTED:[409,'This parcel has been collected. Use the return or RTO workflow.'],
 RETURN_INELIGIBLE:[409,'This order is outside the configured return policy or is not delivered.'],
 RETURN_QUANTITY_CONFLICT:[409,'Some quantities are already included in another return. Refresh the available quantities.'],
 RETURN_STATE_CONFLICT:[409,'This return has changed or is not ready for that step. Refresh and review it.'],
 REFUND_BALANCE_EXCEEDED:[409,'That refund exceeds the remaining balance after processed and pending refunds.'],
 REFUND_MISMATCH:[409,'Provider refund details need owner review. Do not submit another refund.'],
 CANCELLATION_TOO_LATE:[409,'Cancellation is unavailable after collection. Use the return or RTO workflow.'],
 RECONCILIATION_REQUIRED:[409,'Reconcile the existing operation or complete its required refund/inspection before resolving this hold.'],
 VERSION_CONFLICT:[409,'A newer version was saved. Refresh this record before submitting again.'],
 IDEMPOTENCY_CONFLICT:[409,'This request changed. Review the existing operation before retrying.'],
 INTEGRATION_UNCONFIGURED:[503,'This integration is not configured. No provider action was performed.'],
 UPSTREAM_UNKNOWN:[503,'The provider result is uncertain. Reconcile the existing operation.'],
 UPSTREAM_UNAVAILABLE:[503,'The provider is temporarily unavailable. The saved operation remains available for review.'],
 UPSTREAM_REJECTED:[502,'The provider rejected this request. Review its saved status.'],
 INVALID_PAYLOAD:[422,'Check the supplied fields.'], FORBIDDEN:[403,'You do not have permission for this action.'], NOT_FOUND:[404,'This record is unavailable in your session.'], OPERATION_BUSY:[409,'This operation is already running. Refresh its status.'], LEASE_LOST:[409,'Another worker is processing this operation. Refresh its status.'],
};
export async function fulfillmentResponse(work:()=>Promise<unknown>){
 const response=await adminResponse(async()=>{try{return await work();}catch(error){const code=error instanceof Error?error.message:'';const failure=messages[code];if(failure)throw new ApiError(failure[0],code,failure[1]);throw error;}});
 response.headers.set('X-Robots-Tag','noindex, nofollow');return response;
}
