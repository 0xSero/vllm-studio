const config = {
  entry: [
    "src/app/**/{page,layout,route,error,global-error,loading,not-found,template,default}.{ts,tsx}",
    "desktop/main.ts",
    "desktop/preload.ts",
    "desktop/app-identity.ts",
    "desktop/resources/pi-extensions/*.ts",
    "src/**/*.test.ts",
    "desktop/**/*.test.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  ignore: [".next/**", "node_modules/**"],
  ignoreIssues: {
    "desktop/interfaces.ts": ["types"],
  },
  ignoreDependencies: [
    "tailwindcss",
    "postcss",
    "@local-studio/contracts",
    "@local-studio/agent-runtime",
    "@hono/node-server",
    "@modelcontextprotocol/sdk",
    // Declared here but imported from services/agent-runtime (browser-host).
    // knip only sees that importer locally, through the node_modules symlink
    // the frontend postinstall creates. CI has no symlink, so it reports the
    // dependency as unused and fails the job — the ignore has to stay.
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
