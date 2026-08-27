import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  generateBuildId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "jiti",
    "ws",
  ],
  outputFileTracingIncludes: {
    "/api/**": [
      "../node_modules/@earendil-works/pi-ai/dist/**/*.js",
      "../node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/**/*",
      "../node_modules/typebox/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.next-dev/**/*",
      "./data/**/*",
      "./desktop/**/*",
      "./dist-desktop*/**/*",
      "./public/**/*",
      "./src/**/*",
      "./README.md",
      "./eslint.config.mjs",
      "./knip.ts",
      "./next.config.ts",
      "./package-lock.json",
      "./postcss.config.mjs",
      "./tsconfig*.json",
      "./tsconfig*.tsbuildinfo",
      "../controller/**/*",
      "../data/**/*",
      "../scripts/**/*",
      "../services/**/*",
      "../shared/**/*",
      "../site/**/*",
      "../*.md",
      "../bun.lockb",
      "../release.config.cjs",
      "../tsconfig*.json",
    ],
  },
  transpilePackages: ["@local-studio/contracts", "@local-studio/agent-runtime"],
  webpack: (config, { nextRuntime }) => {
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.join(__dirname, "../node_modules"),
    ];
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        "node:net": false,
      };
    }
    return config;
  },
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  async rewrites() {
    return [
      {
        source: "/api/chat-v2",
        destination: "/api/chat",
      },
    ];
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://cdn.openai.com",
      "connect-src 'self' https: http: ws: wss:",
      "frame-src 'self' https: http:",
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
