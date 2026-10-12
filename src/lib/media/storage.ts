import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { integrationConfig, readEnvironment } from "../../config/env.ts";
import type { Environment } from "../../config/env.ts";
import { MEDIA_LIMITS, MediaError } from "./contracts.ts";

export interface MediaStorage {
  readPrivate(key: string, maxBytes: number): Promise<Buffer>;
  putPrivate(key: string, bytes: Buffer, contentType: string): Promise<void>;
  putPublic(key: string, bytes: Buffer, contentType: string, checksum: string): Promise<void>;
  readPublic(key: string, maxBytes: number): Promise<Buffer>;
  deletePrivate(key: string): Promise<void>;
  signedUpload?(key: string, contentType: string, sizeBytes: number): Promise<string>;
}
export function safeObjectKey(key: string): string {
  if (!/^(?:staging|validated|catalog)\/[a-f0-9-]{36}\/[a-zA-Z0-9.-]+$/.test(key) || key.includes("..")) throw new MediaError("MEDIA_KEY_INVALID", 400);
  return key;
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Fixture bytes stay outside Next's public directory and are served by checked routes. */
export class FixtureMediaStorage implements MediaStorage {
  readonly root: string;
  constructor(root: string, mode: string) {
    if (mode !== "fixture") throw new MediaError("FIXTURE_MEDIA_DISABLED", 503);
    this.root = root;
  }
  private path(area: "private" | "public", key: string) { return join(this.root, area, safeObjectKey(key)); }
  private async read(area: "private" | "public", key: string, maxBytes: number) {
    try {
      const bytes = await readFile(this.path(area, key));
      if (bytes.length > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", 413);
      return bytes;
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError("MEDIA_BYTES_MISSING", 404, "Upload the file before completing validation.");
    }
  }
  private async put(area: "private" | "public", key: string, bytes: Buffer) {
    const path = this.path(area, key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        if (sha(await readFile(path)) === sha(bytes)) return; // Identical retries are safe.
        throw new MediaError("MEDIA_OBJECT_CONFLICT", 409, "This upload already has different bytes. Start a new upload.");
      }
      throw error;
    }
  }
  readPrivate(key: string, maxBytes: number) { return this.read("private", key, maxBytes); }
  readPublic(key: string, maxBytes: number) { return this.read("public", key, maxBytes); }
  putPrivate(key: string, bytes: Buffer, _contentType: string) { return this.put("private", key, bytes); }
  async putPublic(key: string, bytes: Buffer, _contentType: string, checksum: string) {
    if (sha(bytes) !== checksum || !key.includes(checksum)) throw new MediaError("MEDIA_CHECKSUM_MISMATCH", 409);
    await this.put("public", key, bytes);
  }
  async deletePrivate(key: string) { await rm(this.path("private", key), { force: true }); }
}

export async function mediaStorage(env: Environment = readEnvironment()): Promise<MediaStorage> {
  if (env.APP_MODE === "fixture") return new FixtureMediaStorage(process.env.FIXTURE_MEDIA_DIR ?? join(process.cwd(), ".fixture", "media"), env.APP_MODE);
  // Gate before constructing an SDK client or making any provider operation.
  const config = integrationConfig("r2", env);
  const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  const read = async (bucket: string, key: string, maxBytes: number) => {
    safeObjectKey(key);
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10_000) });
    if (!head.ContentLength || head.ContentLength > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", 413);
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(20_000) });
    if (!result.Body) throw new MediaError("MEDIA_BYTES_MISSING", 404);
    return readBoundedBody(result.Body.transformToWebStream(), maxBytes);
  };
  return {
    readPrivate: (key, max) => read(config.R2_STAGING_BUCKET, key, max),
    readPublic: (key, max) => read(config.R2_PUBLIC_BUCKET, key, max),
    async putPrivate(key, bytes, contentType) {
      await client.send(new PutObjectCommand({ Bucket: config.R2_STAGING_BUCKET, Key: safeObjectKey(key), Body: bytes, ContentType: contentType, Metadata: { sha256: sha(bytes) } }), { abortSignal: AbortSignal.timeout(20_000) });
    },
    async putPublic(key, bytes, contentType, checksum) {
      if (sha(bytes) !== checksum || !key.includes(checksum)) throw new MediaError("MEDIA_CHECKSUM_MISMATCH", 409);
      await client.send(new PutObjectCommand({ Bucket: config.R2_PUBLIC_BUCKET, Key: safeObjectKey(key), Body: bytes, ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable", Metadata: { sha256: checksum } }), { abortSignal: AbortSignal.timeout(20_000) });
    },
    async deletePrivate(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.R2_STAGING_BUCKET, Key: safeObjectKey(key) }), { abortSignal: AbortSignal.timeout(10_000) });
    },
    signedUpload: (key, contentType, sizeBytes) => getSignedUrl(client,
      new PutObjectCommand({ Bucket: config.R2_STAGING_BUCKET, Key: safeObjectKey(key), ContentType: contentType, ContentLength: sizeBytes }), { expiresIn: MEDIA_LIMITS.uploadSeconds }),
  };
}

export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) throw new MediaError("MEDIA_BODY_MISSING", 400);
  const reader = body.getReader();
  const chunks: Buffer[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new MediaError("MEDIA_TOO_LARGE", 413); }
      chunks.push(Buffer.from(value));
    }
    if (!total) throw new MediaError("MEDIA_BODY_MISSING", 400);
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
