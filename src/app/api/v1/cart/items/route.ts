import type { NextRequest } from "next/server";
import { cartResponse, guestToken, readCartJson } from "../../../../../lib/cart/http.ts";
import { cartService } from "../../../../../lib/cart/service.ts";

export const runtime = "nodejs";
export async function POST(request: NextRequest) { return cartResponse(async () => cartService.add(guestToken(request), await readCartJson(request))); }
