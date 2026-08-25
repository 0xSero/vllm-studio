const config = {
  entry: [
    "src/app/**/{page,layout,route,error,global-error,loading,not-found,template,default}.{ts,tsx}",
    "desktop/main.ts",
    "desktop/preload.ts",
    "desktop/app-identity.ts",
    "desktop/resources/pi-extensions/*.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  ignore: [".next/**", ".next-dev/**", "node_modules/**"],
  ignoreIssues: {
    "desktop/interfaces.ts": ["types"],
  },
  ignoreDependencies: [
    // Pinned direct so the pi supply chain stays version-locked (see #432);
    // consumed transitively by @earendil-works/pi-coding-agent.
    "@earendil-works/pi-ai",
    "tailwindcss",
    "postcss",
    "@local-studio/contracts",
    "@local-studio/agent-runtime",
    "@hono/node-server",
    "@modelcontextprotocol/sdk",
    "@lydell/node-pty",
    "playwright-core",
    "chromium-bidi",
    "proper-lockfile",
    "semver",
    "@types/proper-lockfile",
    "@types/semver",
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
