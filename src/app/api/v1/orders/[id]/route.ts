import type { NextRequest } from "next/server";
import {checkoutResponse,verifiedUserId} from "../../../../../lib/checkout/http.ts";
import {checkoutService} from "../../../../../lib/checkout/service.ts";
import {guestToken} from "../../../../../lib/cart/http.ts";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){const {id}=await params;return checkoutResponse(async()=>checkoutService.receipt(id,guestToken(request),await verifiedUserId()));}
