import type { NextRequest } from "next/server";
import {checkoutResponse,orderAction} from "../../../../../../lib/checkout/http.ts";
import {customerFulfillmentGet,customerReturn} from "../../../../../../lib/fulfillment/http.ts";
import {fulfillmentResponse} from "../../../../../../lib/fulfillment/http-errors.ts";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string;action:string}>}){const {id,action}=await params;return fulfillmentResponse(()=>customerFulfillmentGet(request,id,action));}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;action:string}>}){const {id,action}=await params;return action==='returns'?fulfillmentResponse(()=>customerReturn(request,id)):action==='cancel'?fulfillmentResponse(()=>orderAction(request,id,action)):checkoutResponse(()=>orderAction(request,id,action));}
