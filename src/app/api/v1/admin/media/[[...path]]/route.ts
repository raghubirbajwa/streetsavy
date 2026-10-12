import { requireAdmin } from "../../../../../../lib/auth/server.ts";
import { adminResponse, ApiError, readJson } from "../../../../../../lib/http/admin.ts";
import { allowAuthAttempt, sameOrigin } from "../../../../../../lib/http/security.ts";
import { MediaError } from "../../../../../../lib/media/contracts.ts";
import { getMediaService } from "../../../../../../lib/media/service.ts";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) {
  return adminResponse(async () => {
    try {
      const actor = await requireAdmin();
      if (request.method !== "GET" && !sameOrigin(request)) throw new ApiError(403, "FORBIDDEN", "Request origin denied.");
      const path = (await context.params).path ?? [];
      const service = await getMediaService();
      if (request.method === "GET") {
        if (!path.length) return await service.list(actor);
        if (path[0] === "attachments" && path.length === 1) return await service.attachments(actor, new URL(request.url).searchParams.get("productId") ?? "");
        if (path.length === 1) return await service.get(actor, path[0]!);
        if (path.length === 2 && path[1] === "preview") {
          const query = new URL(request.url).searchParams;
          if (!query.has("expires") || !query.has("signature")) {
            const media = await service.get(actor, path[0]!);
            if (!media.previewUrl) throw new ApiError(404, "MEDIA_NOT_READY", "Media is not ready for preview.");
            return new Response(null, { status: 307, headers: { Location: new URL(media.previewUrl, request.url).toString() } });
          }
          const file = await service.preview(actor, path[0]!, query.get("expires"), query.get("signature"));
          return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
        }
        throw new ApiError(404, "NOT_FOUND", "Media route not found.");
      }
      if (request.method === "PUT" && path.length === 2 && path[1] === "upload") {
        return await service.receive(actor, path[0]!, request.headers.get("X-Upload-Token"), request.headers.get("Content-Type"), request.body);
      }
      const input = await readJson(request);
      if (path.length === 1 && path[0] === "uploads" && request.method === "POST") {
        if (!allowAuthAttempt(`media:upload:${actor.id}`)) throw new ApiError(429, "RATE_LIMITED", "Too many uploads. Try again shortly.");
        return await service.upload(actor, input);
      }
      if (path.length === 1 && path[0] === "attachments" && request.method === "PUT") return await service.setAttachments(actor, input);
      if (path.length === 1 && path[0] === "cleanup" && request.method === "POST") return await service.cleanup(actor);
      if (path.length === 2 && path[1] === "complete" && request.method === "POST") {
        if (!allowAuthAttempt(`media:validate:${actor.id}`)) throw new ApiError(429, "RATE_LIMITED", "Too many validation requests. Try again shortly.");
        return await service.complete(actor, path[0]!);
      }
      if (path.length === 1 && request.method === "PATCH") return await service.edit(actor, path[0]!, input);
      if (path.length === 1 && request.method === "DELETE") return await service.remove(actor, path[0]!, z.object({ version: z.number().int().positive() }).strict().parse(input).version);
      throw new ApiError(404, "NOT_FOUND", "Media route not found.");
    } catch (error) {
      if (error instanceof MediaError) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  });
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
