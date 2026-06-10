const config = {
  entry: [
    // src/proxy.ts is picked up by knip's Next.js plugin; no explicit entry needed.
    "src/app/**/{page,layout,route,error,global-error,loading,not-found,template,default}.{ts,tsx}",
    "desktop/main.ts",
    "desktop/preload.ts",
    "desktop/app-identity.ts",
    "desktop/resources/pi-extensions/*.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  ignore: [".next/**", "node_modules/**"],
  ignoreIssues: {
    // IpcRequestMap is unreferenced; desktop/ is outside the frontend cleanup scope,
    // so it is flagged here instead of deleted.
    "desktop/interfaces.ts": ["types"],
  },
  // Some tooling is used implicitly (CSS/postcss pipeline, git hooks), which knip can't reliably
  // infer from source imports. Keep this list small and intentional.
  ignoreDependencies: ["tailwindcss", "postcss"],
  ignoreExportsUsedInFile: true,
};

export default config;
