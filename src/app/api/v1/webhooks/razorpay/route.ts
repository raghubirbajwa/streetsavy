import type { NextRequest } from "next/server";
import {checkoutResponse,razorpayWebhook} from "../../../../../lib/checkout/http.ts";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){return checkoutResponse(()=>razorpayWebhook(request));}
