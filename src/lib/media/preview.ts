import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integrationConfig } from "../../config/env.ts";
import type { Environment } from "../../config/env.ts";
import { MediaError } from "./contracts.ts";

export async function previewSecret(env: Environment): Promise<Buffer> {
  if (env.APP_MODE !== "fixture") return createHmac("sha256", integrationConfig("r2", env).R2_SECRET_ACCESS_KEY).update("clothing-media-private-preview-v1").digest();
  const directory = process.env.FIXTURE_MEDIA_DIR ?? join(process.cwd(), ".fixture", "media");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".preview-key");
  try { await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error; }
  const secret = await readFile(path);
  if (secret.length !== 32) throw new MediaError("MEDIA_PREVIEW_UNAVAILABLE", 503);
  return secret;
}
const sign = (secret: Buffer, actor: string, media: string, expires: string) => createHmac("sha256", secret).update(`${actor}:${media}:${expires}`).digest("base64url");
export function signedPreviewUrl(secret: Buffer, actor: string, media: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + 300);
  return `/api/v1/admin/media/${media}/preview?expires=${expires}&signature=${sign(secret, actor, media, expires)}`;
}
export function verifyPreview(secret: Buffer, actor: string, media: string, expires: string | null, signature: string | null, now = Date.now()) {
  if (!expires || !/^\d{10}$/.test(expires) || Number(expires) < Math.floor(now / 1000) || Number(expires) > Math.floor(now / 1000) + 300 || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw new MediaError("MEDIA_PREVIEW_EXPIRED", 403, "This private preview expired. Refresh the media library.");
  const expected = Buffer.from(sign(secret, actor, media, expires)); const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new MediaError("MEDIA_PREVIEW_EXPIRED", 403);
}
