import { cpSync, existsSync,
  readdirSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(packageDir, "dist");
const bundlePath = path.join(distDir, "standalone.mjs");
const runtimePackages = [
  "playwright-core",
  "chromium-bidi",
  "mitt",
  "devtools-protocol",
  "@silvia-odwyer/photon-node",
  "undici",
  // pty-service loads node-pty with a dynamic require at runtime, so the
  // bundler never sees it — it has to travel as real files. Without these the
  // packaged app's every terminal open failed with "Cannot find module
  // '@lydell/node-pty'" while the UI kept re-opening the dead terminal.
  "@lydell/node-pty",
  "@grpc/grpc-js",
  "@grpc/proto-loader",
  "@js-sdsl/ordered-map",
  "@protobufjs/aspromise",
  "@protobufjs/base64",
  "@protobufjs/codegen",
  "@protobufjs/eventemitter",
  "@protobufjs/fetch",
  "@protobufjs/float",
  "@protobufjs/path",
  "@protobufjs/pool",
  "@protobufjs/utf8",
  "@types/node",
  "ansi-regex",
  "ansi-styles",
  "cliui",
  "color-convert",
  "color-name",
  "emoji-regex",
  "escalade",
  "get-caller-file",
  "is-fullwidth-code-point",
  "lodash.camelcase",
  "long",
  "protobufjs",
  "require-directory",
  "string-width",
  "strip-ansi",
  "undici-types",
  "wrap-ansi",
  "y18n",
  "yargs",
  "yargs-parser",
];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const build = spawnSync(
  "bun",
  [
    "build",
    "src/server.ts",
    "--target=node",
    "--external",
    "fsevents",
    "--external",
    "playwright-core",
    "--external",
    "@silvia-odwyer/photon-node",
    "--external",
    "undici",
    "--external",
    "@grpc/grpc-js",
    "--external",
    "protobufjs",
    "--outfile=dist/standalone.mjs",
  ],
  { cwd: packageDir, stdio: "inherit" },
);

if (build.status !== 0) {
  throw new Error(`Agent runtime bundle failed with status ${build.status ?? "unknown"}`);
}

// The platform package carries the native prebuild; copy whichever ones the
// build machine has installed (darwin-arm64 locally, linux-x64 in CI).
const lydellDir = path.join(packageDir, "node_modules", "@lydell");
if (existsSync(lydellDir)) {
  for (const entry of readdirSync(lydellDir)) {
    if (entry.startsWith("node-pty-")) runtimePackages.push(`@lydell/${entry}`);
  }
}

for (const packageName of runtimePackages) {
  const segments = packageName.split("/");
  const source = [
    path.join(packageDir, "node_modules", ...segments),
    path.join(packageDir, "..", "node_modules", ...segments),
    path.join(
      packageDir,
      "..",
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      ...segments,
    ),
  ].find((candidate) => existsSync(path.join(candidate, "package.json")));
  const destination = path.join(distDir, "node_modules", ...segments);
  if (!source) {
    throw new Error(`Missing browser runtime package: ${packageName}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

const bundle = readFileSync(bundlePath, "utf8");
const sourceRoot = realpathSync(path.join(packageDir, "..", ".."));
if (bundle.includes(sourceRoot)) {
  throw new Error(`Agent runtime bundle contains the build-machine root: ${sourceRoot}`);
}

console.log(`Packaged portable browser runtime: ${runtimePackages.join(", ")}`);
