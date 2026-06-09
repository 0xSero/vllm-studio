import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import path from "path";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  // Keep the Pi SDK out of the webpack/turbopack bundle so it loads from
  // node_modules at runtime (Node-only deps, dynamic jiti loader, etc.).
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "jiti",
  ],
  turbopack: {
    root: path.join(__dirname, ".."),
    resolveAlias: {
      tailwindcss: path.join(__dirname, "node_modules/tailwindcss"),
    },
  },
  async redirects() {
    return [
      {
        source: "/models",
        destination: "/recipes",
        permanent: true,
      },
    ];
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
    // Baseline security headers. The CSP is intentionally permissive on inline
    // scripts/styles (Next's hydration + theme bootstrap script, Tailwind, xterm,
    // highlight.js) and on connect targets (same-origin proxy, SSE/WebSocket),
    // so it adds a backstop without breaking the app; it can be tightened later
    // with per-request nonces. `frame-ancestors 'none'` blocks clickjacking.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
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
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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

export default withBundleAnalyzer(nextConfig);
