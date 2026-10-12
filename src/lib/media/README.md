# Media lifecycle and isolation

Fixture mode uses `.fixture/media/private` for staged/validated bytes and `.fixture/media/public` for promoted immutable bytes. Neither directory is a Next public directory. Metadata and upload/validation state live in the same local PostgreSQL fixture database as catalog changes. Upload, complete, metadata, deletion, attachment and preview routes require fresh active admin membership. Mutation routes require the exact application Origin. Upload and validation entries are rate limited.

The upload ticket expires in five minutes, is scoped to one staging key and actor, and stores only a SHA-256 token hash. Fixture PUT also requires the admin session and exact Origin. Replaying identical fixture bytes is safe; different bytes cannot overwrite the staged object. Completion obtains a database lease, reads the actual bounded bytes, checks the declared type against magic bytes and performs a full decode. A repeated completion returns the ready result. An expired validation lease can be reclaimed; an old lease cannot commit results.

JPEG/PNG/WebP/AVIF inputs have a 10 MB / 40 million pixel cap and are re-encoded as WebP without source metadata. Animated images are rejected. MP4 input has a 50 MB / 30 second cap, one H.264 video stream up to 1920 pixels per side, and at most one AAC audio stream. `ffprobe` inspects actual streams and duration; `ffmpeg` fully decodes the clip, checks decoded timeline duration, then strips metadata while remuxing supported streams. A validated image poster is required before video publication. The host must supply maintained `ffprobe` and `ffmpeg` executables (optionally absolute `FFPROBE_PATH` / `FFMPEG_PATH`); missing tools fail closed. No filename, browser dimensions or browser duration is trusted.

Save accurate alt text and source/license information. Gallery updates validate colour references, unique media IDs, one cover per colour group, expected product version and ordering; they return the product to draft. Publication prepares assets, copies canonical bytes to `catalog/{id}/{sha256}.{webp|mp4}`, then records the key. Copy failures leave a retryable `publishing` state. Retrying writes identical bytes to the same immutable key. The catalog's final publication transaction checks the product version/readiness and makes attached assets/posters public atomically. A copied asset alone is not returned by public media routes.

Private previews are authenticated and use five-minute HMAC links bound to both actor and media. Opening the bare authenticated preview route obtains a fresh link. Links never replace membership checks and cannot be used after revocation. The signing key stays in a private fixture file; configured R2 mode derives a separate purpose-specific signing key from its server credential. Public routes accept only an exact published-media key returned by an explicit SQL projection; staging keys and arbitrary object keys are never fetch targets.

Deletion refuses attached media, collection/content/poster references, retained order images, and previously published or in-progress assets. Detach a private draft asset first. Rows become `deleting` before object removal; failures retain that state for safe retry. Cleanup claims at most twenty expired unattached uploads/rejected/deleting rows older than 24 hours. The admin library exposes an explicit cleanup action. A hosted durable scheduler for cleanup is still an operational launch requirement; browsers are not workers. Never erase previously public objects expecting browser/CDN caches to revoke them.

## R2 configuration (not exercised in fixture mode)

The R2 adapter checks validated configuration before SDK construction. It uses the S3 API endpoint for five-minute presigned PUTs, a private staging bucket for all source/canonical bytes, and a separate public bucket for immutable published copies. Server reads are bounded and have timeouts. R2 signing does not itself validate bytes or cap a malicious upload's storage usage; completion's HEAD/read/decode checks and private-bucket lifecycle cleanup enforce acceptance. Keep the staging bucket nonpublic and scope credentials to the required buckets.

Apply this staging-bucket CORS template using the **exact** approved application origin for each isolated environment; replace the example before use. Private previews are proxied by the authenticated app, so the browser only needs PUT to R2:

```json
[
  {
    "AllowedOrigins": ["https://your-approved-store.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Do not use wildcard origins or enable browser DELETE. A signed URL remains reusable until expiry; canonical validation writes a separate immutable key so replaying an original PUT cannot mutate verified/published bytes. Public delivery should use the configured R2 custom domain before launch; the current checked application media route is the fixture/integration review path. No bucket, CORS policy or live asset was created by this implementation.

Official contracts checked 25 September 2026: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) and [R2 CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/). These distinguish S3 signing from custom-domain delivery and require browser CORS for presigned uploads.
