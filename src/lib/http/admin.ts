import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError } from "../auth/policy.ts";
import { AdminDatabaseError } from "../admin/db.ts";
import { sameOrigin } from "./security.ts";
import { MediaError } from "../media/contracts.ts";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Bound the stream, including chunked requests; declarations never replace this limit. */
export async function readJson(request: Request, maxBytes = 262144): Promise<unknown> {
  if (!sameOrigin(request)) throw new ApiError(403, "FORBIDDEN", "This request must come from this site.");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON content.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "MALFORMED_REQUEST", "A JSON body is required.");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new ApiError(400, "MALFORMED_REQUEST", "The JSON body could not be read."); }
}

export async function adminResponse(work: () => Promise<unknown>, options: { status?: number } = {}) {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "private, no-store", "X-Request-Id": requestId };
  try {
    const data = await work();
    if (data instanceof Response) { for (const [key,value] of Object.entries(headers)) data.headers.set(key,value); return data; }
    return Response.json({ data, meta: { requestId } }, { status: options.status ?? 200, headers });
  }
  catch (error) {
    let status = 503, code = "UNAVAILABLE", message = "This action is temporarily unavailable. Your edits have been kept.";
    let fieldErrors: unknown; let currentVersion: number | undefined;
    if (error instanceof AccessError) { status = error.status; code = status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"; message = error.message; }
    else if (error instanceof z.ZodError) {
      status = 422; code = "INVALID_FIELDS"; message = "Please check the highlighted fields.";
      fieldErrors = error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message }));
    } else if (error instanceof ApiError || error instanceof AdminDatabaseError || error instanceof MediaError) {
      status = error.status; code = error.code; message = error.message;
      if (error instanceof AdminDatabaseError) { fieldErrors = error.fieldErrors; currentVersion = error.currentVersion; }
    }
    const messages: Record<string,string> = {
      VERSION_CONFLICT: "A newer version was saved. Your local edits have been kept.", INVALID_REFERENCE: "A selected product, collection or media item is unavailable or not published.",
      SAVE_DRAFT_FIRST: "Save a draft before publishing.", ACTIVE_WAREHOUSE_EXISTS: "Deactivate the current warehouse before activating another.",
      INVALID_PAYLOAD: "Some fields are invalid. Check the values and try again.", PUBLISH_INCOMPLETE: "Complete the listed items before publishing.",
      STOCK_CONFLICT: "The adjustment would reduce stock below its reserved quantity.", SKU_OR_SLUG_CONFLICT: "A slug, SKU or colour/size combination is already in use.",
      DATABASE_UNAVAILABLE: "The database is temporarily unavailable. Your local edits have been kept.",
    };
    return Response.json({ error: { code, message: messages[code] ?? message, ...(fieldErrors ? { fieldErrors } : {}), ...(currentVersion === undefined ? {} : { currentVersion }) }, requestId }, { status, headers });
  }
}
