const config = {
  entry: [
    // src/proxy.ts is picked up by knip's Next.js plugin; no explicit entry needed.
    "src/app/**/{page,layout,route,error,global-error,loading,not-found,template,default}.{ts,tsx}",
    "desktop/main.ts",
    "desktop/preload.ts",
    "desktop/app-identity.ts",
    "desktop/resources/pi-extensions/*.ts",
    // Unit tests run via `bun test scripts` — the npm script no longer names a
    // file glob knip can pick entries from, so list them explicitly.
    "scripts/*.test.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}", "scripts/*.{ts,tsx}"],
  ignore: [".next/**", "node_modules/**"],
  ignoreIssues: {
    // IpcRequestMap is unreferenced; desktop/ is outside the frontend cleanup scope,
    // so it is flagged here instead of deleted.
    "desktop/interfaces.ts": ["types"],
  },
  // Some tooling is used implicitly (CSS/postcss pipeline, git hooks), which knip can't reliably
  // infer from source imports. Keep this list small and intentional.
  // @local-studio/contracts and @local-studio/agent-runtime are file: symlinks
  // exporting raw .ts — knip cannot map their subpath imports back to the
  // dependency entries.
  ignoreDependencies: [
    "tailwindcss",
    "postcss",
    "@local-studio/contracts",
    "@local-studio/agent-runtime",
    // ws is imported only by @local-studio/agent-runtime sources (outside
    // knip's project scope) but must stay in frontend deps: it is a
    // serverExternalPackages entry resolved from frontend/node_modules at
    // runtime, and @types/ws types those imports when tsc checks the package
    // sources as part of the frontend program.
    "ws",
    "@types/ws",
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
