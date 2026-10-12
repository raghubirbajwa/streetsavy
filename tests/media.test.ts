import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { fixtureProductId } from "../src/data/fixtures/catalog.ts";
import { createFixtureAdminDatabase, executeFixtureRpc } from "../src/lib/admin/db.ts";
import { createMediaService } from "../src/lib/media/service.ts";
import { FixtureMediaStorage, readBoundedBody, safeObjectKey } from "../src/lib/media/storage.ts";
import { sniffMediaType, validateMediaBytes } from "../src/lib/media/validation.ts";
import { attachmentSchema, uploadSchema } from "../src/lib/media/contracts.ts";
import type { Admin } from "../src/lib/auth/policy.ts";
import { signedPreviewUrl, verifyPreview } from "../src/lib/media/preview.ts";

const exec = promisify(execFile);
const stream = (bytes: Buffer) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
const png = () => sharp({ create: { width: 48, height: 64, channels: 3, background: "#426b57" } }).png().toBuffer();

test("private preview capabilities expire and bind both identity and media", () => {
  const secret = Buffer.alloc(32, 2); const time = 1_800_000_000_000;
  const url = new URL(signedPreviewUrl(secret, "actor", "media", time), "http://localhost");
  const expires = url.searchParams.get("expires"); const signature = url.searchParams.get("signature");
  assert.doesNotThrow(() => verifyPreview(secret, "actor", "media", expires, signature, time));
  assert.throws(() => verifyPreview(secret, "other", "media", expires, signature, time));
  assert.throws(() => verifyPreview(secret, "actor", "other", expires, signature, time));
  assert.throws(() => verifyPreview(secret, "actor", "media", expires, signature, time + 301_000));
});

test("media upload contracts reject unsupported declarations, size and attachment errors", () => {
  assert.equal(uploadSchema.safeParse({ fileName: "photo.png", contentType: "image/png", sizeBytes: 100, kind: "image" }).success, true);
  for (const item of [
    { fileName: "unsafe.svg", contentType: "image/svg+xml", sizeBytes: 100, kind: "image" },
    { fileName: "../photo.png", contentType: "image/png", sizeBytes: 100, kind: "image" },
    { fileName: "photo.png", contentType: "image/png", sizeBytes: 100, kind: "video" },
    { fileName: "photo.png", contentType: "image/png", sizeBytes: 10 * 1024 * 1024 + 1, kind: "image" },
  ]) assert.equal(uploadSchema.safeParse(item).success, false);
  const id = randomUUID();
  assert.equal(attachmentSchema.safeParse({ productId: randomUUID(), version: 1, items: [{ mediaId: id, colorKey: null, isCover: true }, { mediaId: id, colorKey: null, isCover: false }] }).success, false);
  assert.throws(() => safeObjectKey("../../private"));
});

test("actual image bytes are fully decoded, dimensioned and canonicalized", async () => {
  const bytes = await png();
  assert.equal(sniffMediaType(bytes), "image/png");
  const validated = await validateMediaBytes(bytes, "image/png");
  assert.equal(validated.contentType, "image/webp"); assert.equal(validated.width, 48); assert.equal(validated.height, 64);
  assert.equal((await sharp(validated.bytes).metadata()).format, "webp");
  await assert.rejects(validateMediaBytes(bytes, "image/jpeg"), /supported media/);
  await assert.rejects(validateMediaBytes(Buffer.from('<svg onload="alert(1)"></svg>'), "image/png"));
  await assert.rejects(validateMediaBytes(bytes.subarray(0, 32), "image/png"));
  await assert.rejects(readBoundedBody(stream(Buffer.alloc(6)), 5), (error: unknown) => error instanceof Error && "status" in error && error.status === 413);
});

test("MP4 validation reads real codec/duration and decodes the whole clip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clothing-video-test-"));
  try {
    const file = join(directory, "clip.mp4");
    await exec(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10", "-t", "0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", file], { timeout: 15_000 });
    const validated = await validateMediaBytes(await readFile(file), "video/mp4");
    assert.equal(validated.width, 64); assert.equal(validated.contentType, "video/mp4");
    assert.ok(validated.durationSeconds !== null && validated.durationSeconds <= 1);
    const unsupported = join(directory, "unsupported.mp4");
    await exec(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10", "-t", "0.3", "-c:v", "mpeg4", unsupported], { timeout: 15_000 });
    await assert.rejects(validateMediaBytes(await readFile(unsupported), "video/mp4"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real private PNG upload validates, attaches, promotes safely and remains private until atomic publication", async () => {
  const previousMode = process.env.APP_MODE; const previousUrl = process.env.APP_URL;
  process.env.APP_MODE = "fixture"; process.env.APP_URL = "http://localhost:3000";
  const directory = await mkdtemp(join(tmpdir(), "clothing-media-test-"));
  const db = await createFixtureAdminDatabase();
  const actor: Admin = { id: "00000000-0000-4000-8000-000000000001", role: "owner" };
  const customer: Admin = { id: "00000000-0000-4000-8000-000000000003", role: "staff" }; // Forged caller role must not override DB membership.
  const rpc = <T = unknown>(name: string, args: Record<string, unknown>) => executeFixtureRpc<T>(db, name, args);
  const storage = new FixtureMediaStorage(directory, "fixture");
  const service = createMediaService({ rpc, storage, mode: "fixture", appUrl: "http://localhost:3000", previewSecret: Buffer.alloc(32, 1) });
  try {
    await assert.rejects(service.list(customer), /FORBIDDEN/);
    const bytes = await png();
    const ticket = await service.upload(actor, { fileName: "actual.png", contentType: "image/png", sizeBytes: bytes.length, kind: "image" });
    assert.ok(ticket.uploadUrl.endsWith("/upload")); assert.ok(ticket.expiresAt);
    await assert.rejects(service.receive(actor, ticket.mediaId, "A".repeat(43), "image/png", stream(bytes)), /UPLOAD_EXPIRED/);
    const token = ticket.requiredHeaders["X-Upload-Token"]!;
    await service.receive(actor, ticket.mediaId, token, "image/png", stream(bytes));
    await service.receive(actor, ticket.mediaId, token, "image/png", stream(bytes)); // Same-byte retry.
    const ready = await service.complete(actor, ticket.mediaId);
    assert.equal(ready.status, "ready"); assert.equal(ready.width, 48); assert.equal(ready.contentType, "image/webp");
    assert.equal((await service.complete(actor, ticket.mediaId)).version, ready.version);
    assert.equal(JSON.stringify(ready).includes("token"), false); assert.equal(JSON.stringify(ready).includes("staging/"), false);
    await assert.rejects(service.receive(actor, ticket.mediaId, token, "image/png", stream(bytes)), /UPLOAD_EXPIRED/);
    const saved = await service.edit(actor, ticket.mediaId, { version: ready.version, alt: "Original solid green validation sample", source: "Locally generated test", license: "Original test asset", focalX: 0.5, focalY: 0.5, posterMediaId: null });
    await assert.rejects(service.edit(actor, ticket.mediaId, { version: ready.version, alt: "Stale", source: "test", license: "test", focalX: 0.5, focalY: 0.5, posterMediaId: null }), /VERSION_CONFLICT/);
    const productId = fixtureProductId(1);
    const attachment = await service.setAttachments(actor, { productId, version: 1, items: [{ mediaId: ticket.mediaId, colorKey: null, isCover: true }] });
    assert.equal(attachment.version, 2);
    await assert.rejects(service.remove(actor, ticket.mediaId, saved.version), /MEDIA_IN_USE/);
    const before = (await db.query<{ status: string }>("select status from products where id=$1", [productId])).rows[0]!;
    assert.equal(before.status, "draft");
    const failingStorage = Object.create(storage) as FixtureMediaStorage;
    failingStorage.putPublic = async () => { throw new Error("simulated unavailable object store"); };
    const failingService = createMediaService({ rpc, storage: failingStorage, mode: "fixture", appUrl: "http://localhost:3000", previewSecret: Buffer.alloc(32, 1) });
    await assert.rejects(failingService.promote(actor, productId, attachment.version), /simulated unavailable/);
    const failedPromotion = (await db.query<{ status: string; public_key: string | null }>("select status,public_key from media_assets where id=$1", [ticket.mediaId])).rows[0]!;
    assert.equal(failedPromotion.status, "publishing"); assert.equal(failedPromotion.public_key, null);
    await service.promote(actor, productId, attachment.version);
    await service.promote(actor, productId, attachment.version); // Reuses the immutable key and bytes.
    const prepared = (await db.query<{ public_key: string; status: string }>("select public_key,status from media_assets where id=$1", [ticket.mediaId])).rows[0]!;
    assert.equal(prepared.status, "publishing");
    await assert.rejects(service.publicFile(prepared.public_key), /could not be processed/);
    // Publication's DB transaction controls visibility, not a completed object copy.
    await db.query("update media_assets set status='published' where id=$1", [ticket.mediaId]);
    const visible = await service.publicFile(prepared.public_key);
    assert.equal(visible.contentType, "image/webp"); assert.equal((await sharp(visible.bytes).metadata()).width, 48);
    const privateUrl = new URL((await service.get(actor, ticket.mediaId)).previewUrl!, "http://localhost:3000");
    const privatePreview = await service.preview(actor, ticket.mediaId, privateUrl.searchParams.get("expires"), privateUrl.searchParams.get("signature"));
    assert.deepEqual(privatePreview.bytes, visible.bytes);
    await assert.rejects(service.publicFile(`staging/${ticket.mediaId}/original`));
    await assert.rejects(storage.putPublic(prepared.public_key, Buffer.from("different"), "image/webp", "0".repeat(64)));
    await db.query("update admin_memberships set enabled=false where user_id=$1", [actor.id]);
    await assert.rejects(service.preview(actor, ticket.mediaId, privateUrl.searchParams.get("expires"), privateUrl.searchParams.get("signature")), /FORBIDDEN/);
  } finally {
    await db.close(); await rm(directory, { recursive: true, force: true });
    if (previousMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previousMode;
    if (previousUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousUrl;
  }
});
