import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.mzstatic.com" },
      { protocol: "https", hostname: "is1-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is2-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is3-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is4-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is5-ssl.mzstatic.com" },
      { protocol: "https", hostname: "apps.apple.com" },
    ],
  },
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/memory",
    "@mastra/libsql",
    "@mastra/ai-sdk",
    "@libsql/client",
    "cheerio",
    "pino",
    "pino-pretty",
  ],
};

export default nextConfig;
