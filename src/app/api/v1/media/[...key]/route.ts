import { getMediaService } from "../../../../../lib/media/service.ts";
import { MediaError } from "../../../../../lib/media/contracts.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  try {
    const key = (await context.params).key.join("/");
    if (key.length > 240 || key.includes("..") || !/^[a-zA-Z0-9/.-]+$/.test(key)) return new Response(null, { status: 404 });
    const file = await (await getMediaService()).publicFile(key);
    return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", ...(file.checksum ? { ETag: `"${file.checksum}"` } : {}) } });
  } catch (error) {
    const status = error instanceof MediaError && error.status === 404 ? 404 : 503;
    return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  }
}
