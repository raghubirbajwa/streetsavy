import type { NextRequest } from "next/server";
import { cartResponse, createGuestCartResponse, guestToken } from "../../../../lib/cart/http.ts";
import { cartService } from "../../../../lib/cart/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { return cartResponse(() => cartService.get(guestToken(request))); }
export async function POST(request: NextRequest) { return cartResponse(() => createGuestCartResponse(request)); }
