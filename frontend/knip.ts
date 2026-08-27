const config = {
  entry: [
    "src/app/**/{page,layout,route,error,global-error,loading,not-found,template,default}.{ts,tsx}",
    "desktop/entry.ts",
    "desktop/preload.ts",
    "desktop/browser-host.ts",
    "desktop/app-identity.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  ignore: [".next/**", ".next-dev/**", "node_modules/**"],
  ignoreIssues: {
    "desktop/interfaces.ts": ["types"],
  },
  ignoreDependencies: [
    "tailwindcss",
    "postcss",
    "@local-studio/contracts",
    "@lydell/node-pty",
    "semver",
    "@types/semver",
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
