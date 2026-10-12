import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
  poweredByHeader: false,
  images: {
    localPatterns: [{ pathname: "/api/v1/media/**" }],
  },
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ] }]; },
};
export default config;
