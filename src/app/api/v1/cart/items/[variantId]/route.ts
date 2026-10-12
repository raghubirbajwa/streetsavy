import type { NextRequest } from "next/server";
import { cartResponse, cartVersionFromHeader, guestToken, readCartJson, requireCartOrigin, requireEmptyBody } from "../../../../../../lib/cart/http.ts";
import { cartService } from "../../../../../../lib/cart/service.ts";

export const runtime = "nodejs";
type Context = { params: Promise<{ variantId: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  return cartResponse(async () => cartService.update(guestToken(request), (await context.params).variantId, await readCartJson(request)));
}
export async function DELETE(request: NextRequest, context: Context) {
  return cartResponse(async () => {
    requireCartOrigin(request); await requireEmptyBody(request);
    return cartService.remove(guestToken(request), (await context.params).variantId, cartVersionFromHeader(request));
  });
}
