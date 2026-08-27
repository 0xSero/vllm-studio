import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { copyPackageTree, packageDirectoryFor, readPackageManifest, repoRoot } from "./lib.mjs";

const packageDir = path.join(repoRoot, "services", "agent-runtime");
const distDir = path.join(packageDir, "dist");

export function prepareAgentRuntime() {
  rmSync(distDir, { recursive: true, force: true });
}

export function bundleAgentRuntime() {
  const bundlePath = path.join(distDir, "standalone.mjs");
  const runtimePackages = [
    "playwright-core",
    "chromium-bidi",
    "mitt",
    "devtools-protocol",
    "@silvia-odwyer/photon-node",
    "undici",
    "@lydell/node-pty",
    "typebox",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-tui",
    "@earendil-works/pi-ai",
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
      "--minify",
      "--outfile=dist/standalone.mjs",
    ],
    { cwd: packageDir, stdio: "inherit" },
  );
  if (build.status !== 0) {
    throw Error(`Agent runtime bundle failed with status ${build.status ?? "unknown"}`);
  }

  const packageRequire = createRequire(path.join(packageDir, "package.json"));
  const nodePtyDirectory = packageDirectoryFor(packageRequire, "@lydell/node-pty");
  const nodePtyManifest = readPackageManifest(path.join(nodePtyDirectory, "package.json"));
  for (const packageName of Object.keys(nodePtyManifest.optionalDependencies)) {
    try {
      packageDirectoryFor(packageRequire, packageName);
      runtimePackages.push(packageName);
    } catch {
      continue;
    }
  }

  const copiedPackages = new Map();
  for (const packageName of runtimePackages) {
    copyPackageTree(
      packageRequire,
      packageName,
      path.join(distDir, "node_modules", ...packageName.split("/")),
      copiedPackages,
    );
  }

  const bundle = readFileSync(bundlePath, "utf8");
  const sourceRoot = realpathSync(repoRoot);
  if (bundle.includes(sourceRoot)) {
    throw Error(`Agent runtime bundle contains the build-machine root: ${sourceRoot}`);
  }
  console.log(`Packaged portable browser runtime: ${runtimePackages.join(", ")}`);
}

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

function resolveSpecifier(fromFile, spec) {
  if (/\.(js|mjs|cjs|json|node)$/.test(spec)) return spec;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (existsSync(`${base}.js`)) return `${spec}.js`;
  if (existsSync(base) && statSync(base).isDirectory() && existsSync(path.join(base, "index.js"))) {
    return `${spec}/index.js`;
  }
  return spec;
}

export function postbuildAgentRuntime() {
  const realEntry = path.join(distDir, "services", "agent-runtime", "src", "server.js");
  if (!existsSync(realEntry)) {
    console.error(`[postbuild] expected tsc output missing: ${realEntry}`);
    process.exit(1);
  }
  const SPECIFIER_RE =
    /(from\s+|import\s*\(\s*|export\s+\*\s+from\s+|import\s+)("(\.{1,2}\/[^"]+)"|'(\.{1,2}\/[^']+)')/g;
  let rewrites = 0;
  for (const file of jsFiles(distDir)) {
    const source = readFileSync(file, "utf8");
    const next = source.replace(SPECIFIER_RE, (match, lead, quoted, dq, sq) => {
      const spec = dq ?? sq;
      const fixed = resolveSpecifier(file, spec);
      if (fixed === spec) return match;
      rewrites += 1;
      const quote = quoted[0];
      return `${lead}${quote}${fixed}${quote}`;
    });
    if (next !== source) writeFileSync(file, next);
  }
  const shim = `// Stable entry for "node dist/server.js".\nimport "./services/agent-runtime/src/server.js";\n`;
  writeFileSync(path.join(distDir, "server.js"), shim);
  console.log(`[postbuild] rewrote ${rewrites} relative specifiers; wrote dist/server.js shim`);
}
