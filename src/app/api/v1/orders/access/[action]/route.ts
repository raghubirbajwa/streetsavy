import type { NextRequest } from "next/server";
import {checkoutResponse,recoveryAction} from "../../../../../../lib/checkout/http.ts";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}){const {action}=await params;return checkoutResponse(()=>recoveryAction(request,action));}
