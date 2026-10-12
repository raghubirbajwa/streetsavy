import type { NextRequest } from "next/server";
import {checkoutResponse,entry,verifiedUserId} from "../../../../../../lib/checkout/http.ts";
import {checkoutService} from "../../../../../../lib/checkout/service.ts";
import {readJson} from "../../../../../../lib/http/admin.ts";
import {guestToken} from "../../../../../../lib/cart/http.ts";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){return checkoutResponse(async()=>{entry(request,"verify");return checkoutService.verify(guestToken(request),await readJson(request,4096),await verifiedUserId());});}
