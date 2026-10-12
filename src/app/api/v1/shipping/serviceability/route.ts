import type { NextRequest } from "next/server";
import {checkoutResponse,serviceability} from "../../../../../lib/checkout/http.ts";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){return checkoutResponse(()=>serviceability(request));}
