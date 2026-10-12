import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readEnvironment } from "../../config/env.ts";
import type { Admin } from "../auth/policy.ts";
import { adminRpc } from "../admin/db.ts";
import { attachmentSchema, MEDIA_LIMITS, MediaError, mediaEditSchema, uploadSchema } from "./contracts.ts";
import type { AdminMedia, ProductMediaState } from "./contracts.ts";
import { mediaStorage, readBoundedBody } from "./storage.ts";
import type { MediaStorage } from "./storage.ts";
import { validateMediaBytes } from "./validation.ts";
import { previewSecret, signedPreviewUrl, verifyPreview } from "./preview.ts";

type MediaRow = {
  id: string; type: "image" | "video"; status: string; content_type: string; size_bytes: number; width: number | null; height: number | null;
  duration_seconds: number | null; checksum: string | null; alt: string; focal_x: number; focal_y: number; poster_media_id: string | null; version: number;
  last_error: string | null; stage_key: string; public_key: string | null; validated_key: string | null; requested_content_type: string | null; requested_size_bytes: number | null;
  upload_expires_at: string | null; source_details: Record<string, unknown>; license_details: Record<string, unknown>;
};
type Rpc = <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
const uuid = z.string().uuid();
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const strings = (details: Record<string, unknown>, keys: string[]) => keys.map((key) => details[key]).find((value): value is string => typeof value === "string") ?? "";

export function createMediaService(options: { rpc: Rpc; storage: MediaStorage; mode: "fixture" | "test" | "live"; appUrl: string; previewSecret: Buffer }) {
  const call = <T = MediaRow>(actor: Admin, action: string, data: Record<string, unknown> = {}) => options.rpc<T>("admin_media", { p_actor: actor.id, p_action: action, p_data: data });
  const dto = (row: MediaRow, actor: Admin): AdminMedia => ({
    id: row.id, type: row.type, status: row.status, contentType: row.content_type, sizeBytes: Number(row.size_bytes), width: row.width, height: row.height,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds), alt: row.alt, focalX: Number(row.focal_x), focalY: Number(row.focal_y),
    posterMediaId: row.poster_media_id, version: row.version, lastError: row.last_error,
    source: strings(row.source_details, ["source", "creator"]), license: strings(row.license_details, ["license"]),
    previewUrl: ["ready", "publishing", "published"].includes(row.status) ? signedPreviewUrl(options.previewSecret, actor.id, row.id) : null,
    publicUrl: row.status === "published" && row.public_key ? `/api/v1/media/${row.public_key}` : null,
  });
  async function privateBytes(row: MediaRow) {
    if (row.validated_key) return options.storage.readPrivate(row.validated_key, MEDIA_LIMITS.videoBytes);
    if (options.mode === "fixture" && row.status === "published" && /^fixtures\/catalog\/p\d{2}-(?:front|alternate)\.png$/.test(row.public_key ?? "")) {
      return readFile(join(process.cwd(), "public", row.public_key!));
    }
    throw new MediaError("MEDIA_BYTES_MISSING", 404);
  }
  async function promoteRows(actor: Admin, rows: MediaRow[]) {
    for (const row of rows) {
      if (row.status === "published") continue;
      const bytes = await privateBytes(row);
      if (!row.checksum || digest(bytes) !== row.checksum) throw new MediaError("MEDIA_CHECKSUM_MISMATCH", 409);
      const publicKey = `catalog/${row.id}/${row.checksum}.${row.type === "video" ? "mp4" : "webp"}`;
      await options.storage.putPublic(publicKey, bytes, row.content_type, row.checksum);
      await call(actor, "finish_promotion", { id: row.id, publicKey, checksum: row.checksum });
    }
  }
  return {
    async list(actor: Admin) { return (await call<MediaRow[]>(actor, "list")).map((row) => dto(row, actor)); },
    async get(actor: Admin, id: string) { return dto(await call(actor, "get", { id: uuid.parse(id) }), actor); },
    async upload(actor: Admin, input: unknown) {
      const data = uploadSchema.parse(input); const id = randomUUID(); const token = randomBytes(32).toString("base64url");
      const row = await call(actor, "create", { ...data, id, tokenHash: digest(token) });
      const uploadUrl = options.storage.signedUpload ? await options.storage.signedUpload(row.stage_key, data.contentType, data.sizeBytes) : `/api/v1/admin/media/${id}/upload`;
      return { mediaId: id, uploadUrl, requiredHeaders: { "Content-Type": data.contentType, ...(!options.storage.signedUpload ? { "X-Upload-Token": token } : {}) }, expiresAt: row.upload_expires_at };
    },
    async receive(actor: Admin, id: string, token: string | null, contentType: string | null, body: ReadableStream<Uint8Array> | null) {
      if (options.mode !== "fixture") throw new MediaError("NOT_FOUND", 404);
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MediaError("UPLOAD_EXPIRED", 403);
      const row = await call(actor, "authorize_upload", { id: uuid.parse(id), tokenHash: digest(token) });
      if (contentType !== row.requested_content_type) throw new MediaError("MEDIA_TYPE_MISMATCH", 422);
      const bytes = await readBoundedBody(body, row.type === "video" ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes);
      if (bytes.length !== Number(row.requested_size_bytes)) throw new MediaError("MEDIA_SIZE_MISMATCH", 422, "Uploaded bytes do not match the declared file size.");
      await options.storage.putPrivate(row.stage_key, bytes, contentType!);
      await call(actor, "received", { id });
      return { mediaId: id, status: "uploaded" };
    },
    async complete(actor: Admin, id: string) {
      const lease = randomUUID(); const row = await call(actor, "claim_validation", { id: uuid.parse(id), lease });
      if (["ready", "publishing", "published"].includes(row.status)) return dto(row, actor);
      try {
        const bytes = await options.storage.readPrivate(row.stage_key, row.type === "video" ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes);
        if (bytes.length !== Number(row.requested_size_bytes)) throw new MediaError("MEDIA_SIZE_MISMATCH", 422);
        const validated = await validateMediaBytes(bytes, row.requested_content_type!);
        const validatedKey = `validated/${id}/${validated.checksum}.${validated.contentType === "video/mp4" ? "mp4" : "webp"}`;
        await options.storage.putPrivate(validatedKey, validated.bytes, validated.contentType);
        return dto(await call(actor, "ready", { id, lease, validatedKey, contentType: validated.contentType, sizeBytes: validated.bytes.length, width: validated.width, height: validated.height, durationSeconds: validated.durationSeconds, checksum: validated.checksum }), actor);
      } catch (error) {
        const code = error instanceof MediaError ? error.code : "MEDIA_VALIDATION_UNAVAILABLE";
        await call(actor, "reject", { id, lease, code, retryable: !(error instanceof MediaError) || error.status === 503 || error.status === 404 });
        if (error instanceof MediaError) throw error;
        throw new MediaError("MEDIA_VALIDATION_UNAVAILABLE", 503, "Validation could not finish. Retry this file's validation.");
      }
    },
    async edit(actor: Admin, id: string, input: unknown) { return dto(await call(actor, "edit", { ...mediaEditSchema.parse(input), id: uuid.parse(id) }), actor); },
    async remove(actor: Admin, id: string, version: number) {
      const row = await call(actor, "delete", { id: uuid.parse(id), version: z.number().int().positive().parse(version) });
      await options.storage.deletePrivate(row.stage_key);
      if (row.validated_key) await options.storage.deletePrivate(row.validated_key);
      await call(actor, "deleted", { id }); return { removed: true };
    },
    async cleanup(actor: Admin) {
      const rows = await call<MediaRow[]>(actor, "cleanup"); let cleaned = 0;
      for (const row of rows) {
        try {
          await options.storage.deletePrivate(row.stage_key);
          if (row.validated_key) await options.storage.deletePrivate(row.validated_key);
          await call(actor, "deleted", { id: row.id }); cleaned += 1;
        } catch { /* Durable deleting status is retried by the next bounded cleanup. */ }
      }
      return { cleaned, pending: rows.length - cleaned };
    },
    attachments: (actor: Admin, productId: string) => call<ProductMediaState>(actor, "attachments", { productId: uuid.parse(productId) }),
    setAttachments: (actor: Admin, input: unknown) => call<{ version: number }>(actor, "set_attachments", attachmentSchema.parse(input)),
    async promote(actor: Admin, productId: string, version: number) {
      const rows = await call<MediaRow[]>(actor, "prepare_product", { productId: uuid.parse(productId), version });
      await promoteRows(actor, rows);
    },
    async promoteIds(actor: Admin, ids: string[]) {
      const valid = z.array(uuid).max(40).parse(ids);
      await promoteRows(actor, await call<MediaRow[]>(actor, "prepare_ids", { ids: [...new Set(valid)] }));
    },
    async preview(actor: Admin, id: string, expires: string | null, signature: string | null) {
      verifyPreview(options.previewSecret, actor.id, id, expires, signature);
      const row = await call(actor, "get", { id: uuid.parse(id) });
      if (!["ready", "publishing", "published"].includes(row.status)) throw new MediaError("MEDIA_NOT_READY", 404);
      return { bytes: await privateBytes(row), contentType: row.content_type };
    },
    async publicFile(key: string) {
      const row = await options.rpc<{ publicKey: string; contentType: string; checksum: string | null } | null>("public_media", { p_key: key });
      if (!row) throw new MediaError("NOT_FOUND", 404);
      const bytes = options.mode === "fixture" && /^fixtures\/catalog\/p\d{2}-(?:front|alternate)\.png$/.test(key)
        ? await readFile(join(process.cwd(), "public", key)) : await options.storage.readPublic(key, MEDIA_LIMITS.videoBytes);
      return { bytes, contentType: row.contentType, checksum: row.checksum };
    },
  };
}
export async function getMediaService() {
  const env = readEnvironment();
  return createMediaService({ rpc: adminRpc, storage: await mediaStorage(env), mode: env.APP_MODE, appUrl: env.APP_URL, previewSecret: await previewSecret(env) });
}
export async function promoteProductMedia(actor: Admin, productId: string, expectedVersion: number): Promise<void> {
  await (await getMediaService()).promote(actor, productId, expectedVersion);
}
export async function promoteMediaIds(actor: Admin, ids: string[]): Promise<void> {
  await (await getMediaService()).promoteIds(actor, ids);
}
