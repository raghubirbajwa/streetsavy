import { z } from "zod";

export const MEDIA_LIMITS = { imageBytes: 10 * 1024 * 1024, videoBytes: 50 * 1024 * 1024, videoSeconds: 30, imagePixels: 40_000_000, uploadSeconds: 300 } as const;
export const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const mediaTypeSchema = z.enum([...imageTypes, "video/mp4"]);
export const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).refine((name) => !/[\x00-\x1f/\\]/.test(name)),
  contentType: mediaTypeSchema, sizeBytes: z.number().int().positive(), kind: z.enum(["image", "video"]),
}).strict().superRefine((data, ctx) => {
  if ((data.kind === "video") !== (data.contentType === "video/mp4")) ctx.addIssue({ code: "custom", path: ["kind"], message: "File kind does not match its type." });
  if (data.sizeBytes > (data.kind === "video" ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes)) ctx.addIssue({ code: "custom", path: ["sizeBytes"], message: "File exceeds the upload limit." });
});
export const mediaEditSchema = z.object({
  version: z.number().int().positive(), alt: z.string().trim().min(1).max(500),
  focalX: z.number().min(0).max(1), focalY: z.number().min(0).max(1), posterMediaId: z.string().uuid().nullable(),
  source: z.string().trim().min(1).max(500), license: z.string().trim().min(1).max(500),
}).strict();
export const attachmentSchema = z.object({
  productId: z.string().uuid(), version: z.number().int().positive(),
  items: z.array(z.object({ mediaId: z.string().uuid(), colorKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(), isCover: z.boolean() }).strict()).max(24),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.items.map((item) => item.mediaId)).size !== data.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "An image can appear only once per product." });
  const covers = data.items.filter((item) => item.isCover).map((item) => item.colorKey ?? "");
  if (new Set(covers).size !== covers.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Choose one cover per colour group." });
});
export type AdminMedia = {
  id: string; type: "image" | "video"; status: string; contentType: string; sizeBytes: number;
  width: number | null; height: number | null; durationSeconds: number | null; alt: string;
  focalX: number; focalY: number; posterMediaId: string | null; version: number; lastError: string | null;
  source: string; license: string; previewUrl: string | null; publicUrl: string | null;
};
export type MediaAttachment = { mediaId: string; colorKey: string | null; isCover: boolean };
export type ProductMediaState = { version: number; items: MediaAttachment[]; colors: { key: string; label: string }[] };

export class MediaError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status = 422, message = "The media file could not be processed.") {
    super(message); this.name = "MediaError"; this.code = code; this.status = status;
  }
}
