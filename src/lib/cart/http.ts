import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { readEnvironment } from "../../config/env.ts";
import { ApiError, readJson } from "../http/admin.ts";
import { sameOrigin } from "../http/security.ts";
import { CartError, GUEST_COOKIE_NAME, cartService } from "./service.ts";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };
export const guestToken = (request: NextRequest) => request.cookies.get(GUEST_COOKIE_NAME)?.value;
export function requireCartOrigin(request: Request) {
  if (!sameOrigin(request)) throw new ApiError(403, "FORBIDDEN", "This request must come from this site.");
}
export const readCartJson = (request: Request) => readJson(request, 4096);
export async function requireEmptyBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength) { await reader.cancel(); throw new ApiError(422, "INVALID_FIELDS", "This request requires an empty body."); }
    }
  } finally { reader.releaseLock(); }
}
export function cartVersionFromHeader(request: Request) {
  const value = request.headers.get("if-match") ?? "";
  if (!/^"[1-9][0-9]{0,9}"$/.test(value) || Number(value.slice(1,-1)) > 2_147_483_647) throw new ApiError(422, "INVALID_FIELDS", "Send the current cart version in If-Match.");
  return Number(value.slice(1,-1));
}
export async function cartResponse(work: () => Promise<unknown>) {
  const requestId = randomUUID(); const headers = { ...privateHeaders, "X-Request-Id": requestId };
  try {
    const result = await work();
    if (result instanceof Response) { for (const [key,value] of Object.entries(headers)) result.headers.set(key,value); return result; }
    return NextResponse.json({ data: result, meta: { requestId } }, { headers });
  } catch (error) {
    if (error instanceof CartError) return NextResponse.json({ error: { code: error.code, message: error.message, currentCart: error.currentCart }, requestId }, { status: error.status, headers });
    if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message }, requestId }, { status: error.status, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "INVALID_FIELDS", message: "Check the item and quantity and try again.", fieldErrors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, requestId }, { status: 422, headers });
    return NextResponse.json({ error: { code: "UNAVAILABLE", message: "Your cart is temporarily unavailable. Please try again." }, requestId }, { status: 503, headers });
  }
}

export async function createGuestCartResponse(request: NextRequest) {
  requireCartOrigin(request); await requireEmptyBody(request);
  const created = await cartService.create(guestToken(request));
  const response = NextResponse.json({ data: created.cart });
  response.cookies.set(GUEST_COOKIE_NAME, created.token, { httpOnly: true, secure: new URL(readEnvironment().APP_URL).protocol === "https:", sameSite: "lax", path: "/", expires: created.expiresAt });
  return response;
}
