import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MEDIA_LIMITS, MediaError } from "./contracts.ts";

const execute = promisify(execFile);
export type ValidatedMedia = { bytes: Buffer; contentType: "image/webp" | "video/mp4"; width: number; height: number; durationSeconds: number | null; checksum: string };
const fail = (code = "MEDIA_INVALID") => new MediaError(code, 422, "The file does not match the supported media requirements.");
export function sniffMediaType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const brands = bytes.toString("ascii", 8, Math.min(40, bytes.length));
    if (/avif|avis/.test(brands)) return "image/avif";
    if (/isom|iso2|mp41|mp42|avc1|M4V /.test(brands)) return "video/mp4";
  }
  return null;
}

export async function validateMediaBytes(bytes: Buffer, declaredType: string): Promise<ValidatedMedia> {
  if (!bytes.length || sniffMediaType(bytes) !== declaredType) throw fail("MEDIA_TYPE_MISMATCH");
  if (bytes.length > (declaredType === "video/mp4" ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes)) throw new MediaError("MEDIA_TOO_LARGE", 413);
  if (declaredType === "video/mp4") return validateVideo(bytes);
  try {
    const input = sharp(bytes, { failOn: "warning", limitInputPixels: MEDIA_LIMITS.imagePixels, animated: false });
    const metadata = await input.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw fail();
    // Full decode and canonical re-encode strips untrusted EXIF/XMP and appended bytes.
    const output = await input.rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (!output.info.width || !output.info.height || output.data.length > MEDIA_LIMITS.imageBytes) throw fail();
    return { bytes: output.data, contentType: "image/webp", width: output.info.width, height: output.info.height, durationSeconds: null, checksum: createHash("sha256").update(output.data).digest("hex") };
  } catch (error) { if (error instanceof MediaError) throw error; throw fail("MEDIA_DECODE_FAILED"); }
}

async function validateVideo(bytes: Buffer): Promise<ValidatedMedia> {
  const directory = await mkdtemp(join(tmpdir(), "clothing-media-"));
  const input = join(directory, "input.mp4");
  const output = join(directory, "validated.mp4");
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    const result = await execute(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-show_entries", "stream=codec_name,codec_type,width,height:format=duration,format_name", "-of", "json", input], { timeout: 15_000, maxBuffer: 256_000, cwd: directory });
    const data = JSON.parse(result.stdout) as { streams?: { codec_name?: string; codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string; format_name?: string } };
    const streams = data.streams ?? [];
    const videos = streams.filter((stream) => stream.codec_type === "video");
    const audios = streams.filter((stream) => stream.codec_type === "audio");
    const video = videos[0];
    const duration = Number(data.format?.duration);
    if (videos.length !== 1 || audios.length > 1 || streams.length !== videos.length + audios.length || video?.codec_name !== "h264" || audios.some((stream) => stream.codec_name !== "aac")
      || !video.width || !video.height || video.width > 1920 || video.height > 1920 || !Number.isFinite(duration) || duration <= 0 || duration > MEDIA_LIMITS.videoSeconds || !data.format?.format_name?.includes("mp4")) throw fail("VIDEO_UNSUPPORTED");
    // Decode the whole bounded clip; probing alone would accept truncated streams.
    const decoded = await execute(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-xerror", "-protocol_whitelist", "file", "-threads", "1", "-i", input, "-map", "0:v:0", "-map", "0:a?", "-progress", "pipe:1", "-nostats", "-f", "null", "-"], { timeout: 30_000, maxBuffer: 256_000, cwd: directory });
    const decodedTimes = [...decoded.stdout.matchAll(/^out_time_us=(\d+)$/gm)].map((match) => Number(match[1]) / 1_000_000);
    if (!decodedTimes.length || Math.max(...decodedTimes) > MEDIA_LIMITS.videoSeconds) throw fail("VIDEO_TOO_LONG");
    // Strip metadata and preserve only supported streams; public copies are immutable.
    await execute(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", input, "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "-1", "-c", "copy", "-movflags", "+faststart", output], { timeout: 20_000, maxBuffer: 256_000, cwd: directory });
    const sanitized = await readFile(output);
    if (sanitized.length > MEDIA_LIMITS.videoBytes) throw fail();
    return { bytes: sanitized, contentType: "video/mp4", width: video.width, height: video.height, durationSeconds: duration, checksum: createHash("sha256").update(sanitized).digest("hex") };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") throw new MediaError("VIDEO_VALIDATOR_UNAVAILABLE", 503, "Video validation is unavailable. Configure ffprobe and ffmpeg before uploading video.");
    throw fail("MEDIA_DECODE_FAILED");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
