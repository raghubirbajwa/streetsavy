import "server-only";
import { randomUUID } from "node:crypto";

export class CatalogNotFound extends Error {}

/** Only strict public read services reach this transport; errors never expose database details. */
export async function catalogResponse(operation: () => Promise<{ data: unknown; notices?: string[] }>): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  try {
    const { data, notices } = await operation();
    return Response.json({ data, meta: { requestId, ...(notices?.length ? { notices } : {}) } }, { headers });
  } catch (error) {
    const missing = error instanceof CatalogNotFound;
    return Response.json({ error: { code: missing ? "NOT_FOUND" : "UNAVAILABLE", message: missing ? "We couldn't find that item." : "The catalog is temporarily unavailable." }, requestId }, { status: missing ? 404 : 503, headers });
  }
}
