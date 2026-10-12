import { adminFulfillmentGet,adminFulfillmentMutate } from '../../../../../../lib/fulfillment/http.ts';
import { fulfillmentResponse } from '../../../../../../lib/fulfillment/http-errors.ts';
export const dynamic='force-dynamic';
type Context={params:Promise<{path?:string[]}>};
export async function GET(request:Request,ctx:Context){return fulfillmentResponse(async()=>adminFulfillmentGet(request,'shipments',(await ctx.params).path??[]));}
async function mutate(request:Request,ctx:Context){return fulfillmentResponse(async()=>adminFulfillmentMutate(request,'shipments',(await ctx.params).path??[]));}
export const POST=mutate;
export const PATCH=mutate;
