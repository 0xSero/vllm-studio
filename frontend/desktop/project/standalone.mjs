import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyPackageTree,
  frontendDir,
  packageDirectoryFor,
  readPackageManifest,
  repoRoot,
  walkUnder,
} from "./lib.mjs";

const standaloneBase = path.resolve(frontendDir, ".next", "standalone");

const RUNTIME_PREFIXES = [
  "server.js",
  "package.json",
  ".next/",
  "public/",
  "node_modules/",
  "frontend/server.js",
  "frontend/package.json",
  "frontend/.next/",
  "frontend/public/",
  "frontend/node_modules/",
];

function isRuntimeFile(file) {
  const rel = path.relative(standaloneBase, file).replaceAll("\\", "/");
  return RUNTIME_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

const filesUnder = (directory) => walkUnder(readdirSync, directory, (entry) => entry.isFile());
const symlinksUnder = (directory) =>
  walkUnder(readdirSync, directory, (entry) => entry.isSymbolicLink());

export function prepareNext() {
  rmSync(path.join(frontendDir, ".next"), { recursive: true, force: true });
}

export function completeStandalone() {
  const standaloneRoots = [path.resolve(standaloneBase, "frontend"), standaloneBase];
  const standaloneRoot = standaloneRoots.find((root) =>
    existsSync(path.resolve(root, "server.js")),
  );
  if (!standaloneRoot) throw Error(`Missing standalone server under: ${standaloneBase}`);

  const runtimeDependencyPaths = [
    ["typebox", "node_modules/typebox"],
    ["@earendil-works/pi-coding-agent", "node_modules/@earendil-works/pi-coding-agent"],
  ];
  const projectRequire = createRequire(path.resolve(frontendDir, "package.json"));
  const copiedPackages = new Map();
  for (const [packageName, destinationPath] of runtimeDependencyPaths) {
    if (!resolvablePackageDirectory(projectRequire, packageName)) {
      throw Error(`Missing runtime dependency source: ${destinationPath}`);
    }
    copyPackageTree(
      projectRequire,
      packageName,
      path.resolve(standaloneRoot, destinationPath),
      copiedPackages,
    );
  }

  const tracedPiPackageDirectory = path.resolve(
    standaloneRoot,
    ".next/node_modules/@earendil-works",
  );
  if (existsSync(tracedPiPackageDirectory)) {
    const packageTargets = new Map([
      [
        "pi-ai-",
        path.resolve(
          standaloneRoot,
          "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai",
        ),
      ],
      [
        "pi-coding-agent-",
        path.resolve(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent"),
      ],
    ]);
    for (const entry of readdirSync(tracedPiPackageDirectory)) {
      const target = [...packageTargets].find(([prefix]) => entry.startsWith(prefix))?.[1];
      if (!target) continue;
      const link = path.resolve(tracedPiPackageDirectory, entry);
      if (!lstatSync(link).isSymbolicLink()) {
        throw Error(`Expected traced Pi package alias to be a symlink: ${link}`);
      }
      unlinkSync(link);
      symlinkSync(path.relative(path.dirname(link), target), link, "dir");
    }
  }

  const externalLinks = symlinksUnder(standaloneRoot).filter((link) => {
    const target = path.relative(standaloneRoot, realpathSync(link));
    return target === ".." || target.startsWith(`..${path.sep}`) || path.isAbsolute(target);
  });
  for (const link of externalLinks) {
    const target = realpathSync(link);
    unlinkSync(link);
    cpSync(target, link, { recursive: true, dereference: true });
  }

  const isVerifiedCopy = (file, repoRelativePath) => {
    const source = path.resolve(repoRoot, repoRelativePath);
    if (!existsSync(source)) return false;
    const sourceStat = statSync(source);
    const copyStat = statSync(file);
    if (!sourceStat.isFile() || sourceStat.size !== copyStat.size) return false;
    if (!(repoRelativePath === "data" || /(^|\/)data\//.test(repoRelativePath))) return true;
    return readFileSync(source).equals(readFileSync(file));
  };

  const unverified = [];
  let pruned = 0;
  for (const file of filesUnder(standaloneBase)) {
    if (isRuntimeFile(file)) continue;
    const repoRelativePath = path.relative(standaloneBase, file).replaceAll("\\", "/");
    if (!isVerifiedCopy(file, repoRelativePath)) {
      unverified.push(repoRelativePath);
      continue;
    }
    unlinkSync(file);
    pruned += 1;
  }
  if (unverified.length > 0) {
    throw Error(
      `Standalone output contains non-runtime files with no matching repo source; refusing to prune them (move them aside manually if expected):\n${unverified.join("\n")}`,
    );
  }

  const removeEmptyDirectories = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmptyDirectories(path.resolve(directory, entry.name));
    }
    if (directory !== standaloneBase && readdirSync(directory).length === 0) rmdirSync(directory);
  };
  removeEmptyDirectories(standaloneBase);
  console.log(
    `  standalone repaired: +${runtimeDependencyPaths.length} runtime dependency trees, -${pruned} traced non-runtime files`,
  );
}

function requireRuntimeRoot() {
  const runtimeRoots = [path.resolve(standaloneBase, "frontend"), standaloneBase];
  const servers = runtimeRoots.map((root) => path.resolve(root, "server.js"));
  if (!servers.some((server) => existsSync(server)))
    throw Error(`Missing standalone server: ${servers.join(", ")}`);
  const required = [
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/value/shared/union_priority_sort.mjs",
  ];
  for (const file of required) {
    if (!runtimeRoots.some((root) => existsSync(path.resolve(root, file))))
      throw Error(`Missing standalone runtime dependency: ${file}`);
  }
  return runtimeRoots.find((root) => existsSync(path.resolve(root, "server.js")));
}

function assertRuntimeLinks(runtimeRoot) {
  const unsafe = symlinksUnder(runtimeRoot).filter((link) => {
    if (path.isAbsolute(readlinkSync(link)) || !existsSync(link)) return true;
    const target = path.relative(runtimeRoot, realpathSync(link));
    return target === ".." || target.startsWith(`..${path.sep}`) || path.isAbsolute(target);
  });
  if (unsafe.length > 0) throw Error(`Unsafe standalone runtime links: ${unsafe.join(", ")}`);
  const traced = path.resolve(runtimeRoot, ".next/node_modules/@earendil-works");
  const dangling = existsSync(traced)
    ? readdirSync(traced)
        .map((entry) => path.resolve(traced, entry))
        .filter((entry) => lstatSync(entry).isSymbolicLink() && !existsSync(entry))
    : [];
  if (dangling.length > 0) throw Error(`Dangling traced runtime packages: ${dangling.join(", ")}`);
}

function resolvablePackageDirectory(resolver, packageName) {
  try {
    return packageDirectoryFor(resolver, packageName);
  } catch {
    return undefined;
  }
}

function assertContainedPackage(runtimeRoot, packageName, packageDirectory) {
  const relative = path.relative(runtimeRoot, realpathSync(packageDirectory));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Error(`Pi dependency escaped standalone runtime: ${packageName}`);
  }
}

function assertPackageClosure(sourceResolver, runtimeResolver, packageName, runtimeRoot, visited) {
  const sourceDirectory = packageDirectoryFor(sourceResolver, packageName);
  const runtimeDirectory = packageDirectoryFor(runtimeResolver, packageName);
  assertContainedPackage(runtimeRoot, packageName, runtimeDirectory);
  const sourceManifestPath = path.resolve(sourceDirectory, "package.json");
  const runtimeManifestPath = path.resolve(runtimeDirectory, "package.json");
  if (!readFileSync(sourceManifestPath).equals(readFileSync(runtimeManifestPath))) {
    throw Error(`Standalone package provenance mismatch: ${packageName}`);
  }
  const canonicalRuntimeDirectory = realpathSync(runtimeDirectory);
  if (visited.has(canonicalRuntimeDirectory)) return;
  visited.add(canonicalRuntimeDirectory);
  const manifest = readPackageManifest(sourceManifestPath);
  const sourceChildResolver = createRequire(sourceManifestPath);
  const runtimeChildResolver = createRequire(runtimeManifestPath);
  for (const dependency of Object.keys(manifest.dependencies)) {
    assertPackageClosure(
      sourceChildResolver,
      runtimeChildResolver,
      dependency,
      runtimeRoot,
      visited,
    );
  }
  const optional = { ...manifest.optionalDependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(optional)) {
    if (!resolvablePackageDirectory(sourceChildResolver, dependency)) continue;
    assertPackageClosure(
      sourceChildResolver,
      runtimeChildResolver,
      dependency,
      runtimeRoot,
      visited,
    );
  }
}

function assertPiRuntime(runtimeRoot) {
  const codingAgent = path.resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent");
  const piAi = path.resolve(codingAgent, "node_modules/@earendil-works/pi-ai");
  const entries = [path.resolve(codingAgent, "dist/index.js"), path.resolve(piAi, "dist/index.js")];
  if (entries.some((entry) => !existsSync(entry)))
    throw Error("Missing packaged Pi runtime entrypoints");
  for (const entry of entries) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `import(${JSON.stringify(pathToFileURL(entry).href)})`],
      { cwd: runtimeRoot, encoding: "utf8" },
    );
    if (result.status !== 0)
      throw Error(
        `Standalone Pi runtime entrypoint is not importable: ${result.stderr || result.stdout}`,
      );
  }
  const sourceResolver = createRequire(path.resolve(frontendDir, "package.json"));
  const runtimeResolver = createRequire(path.resolve(runtimeRoot, "package.json"));
  const visited = new Set();
  assertPackageClosure(sourceResolver, runtimeResolver, "typebox", runtimeRoot, visited);
  assertPackageClosure(
    sourceResolver,
    runtimeResolver,
    "@earendil-works/pi-coding-agent",
    runtimeRoot,
    visited,
  );
}

export function assertStandalone() {
  const runtimeRoot = requireRuntimeRoot();
  assertRuntimeLinks(runtimeRoot);
  assertPiRuntime(runtimeRoot);
  const unexpected = filesUnder(standaloneBase).filter((file) => !isRuntimeFile(file));
  if (unexpected.length > 0)
    throw Error(`Standalone build contains non-runtime files:
${unexpected.map((file) => path.relative(standaloneBase, file)).join("\n")}`);
  console.log("  standalone server build is minimal");
}

function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

export async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;
  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const packagedStandaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");
  const candidates = [
    path.join(packagedStandaloneBase, "frontend", "server.js"),
    path.join(packagedStandaloneBase, "server.js"),
  ];
  const standaloneServer = candidates.find((candidate) => existsSync(candidate));

  const appArchive = path.join(resourcesDir, "app.asar");
  const appArchiveBytes = statSync(appArchive).size;
  if (appArchiveBytes > 5 * 1024 * 1024) {
    throw Error(`Packaged app.asar is unexpectedly large: ${appArchiveBytes} bytes`);
  }
  if (!standaloneServer) {
    throw Error(
      [
        "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
        `Looked for: ${candidates.join(" or ")}`,
        `electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn't exist" yet still exit 0).`,
        "Re-run the build (run `npm run build` first if .next/standalone is absent).",
      ].join("\n  "),
    );
  }

  const packagedRoot = path.dirname(standaloneServer);
  const missingRuntimeFile = [
    path.join(
      packagedRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "index.js",
    ),
    path.join(
      packagedRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "package.json",
    ),
    path.join(
      packagedRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "providers",
      "data",
      "amazon-bedrock.json",
    ),
  ].find((file) => !existsSync(file));
  if (missingRuntimeFile) {
    throw Error(`Packaged app is missing a Pi runtime dependency: ${missingRuntimeFile}`);
  }

  const agentRuntimeRoot = path.join(resourcesDir, "app", "agent-runtime");
  const agentRuntime = path.join(agentRuntimeRoot, "standalone.mjs");
  const missingAgentRuntimeFile = [
    agentRuntime,
    path.join(agentRuntimeRoot, "node_modules", "playwright-core", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "package.json"),
    path.join(
      agentRuntimeRoot,
      "node_modules",
      "chromium-bidi",
      "node_modules",
      "zod",
      "package.json",
    ),
    path.join(agentRuntimeRoot, "node_modules", "mitt", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "devtools-protocol", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "@silvia-odwyer", "photon-node", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "undici", "package.json"),
  ].find((file) => !existsSync(file));
  if (missingAgentRuntimeFile) {
    throw Error(`Packaged app is missing an agent runtime dependency: ${missingAgentRuntimeFile}`);
  }

  const desktopRuntimeRoot = path.join(resourcesDir, "desktop-runtime", "node_modules", "@lydell");
  const missingDesktopRuntimeFile = [
    path.join(desktopRuntimeRoot, "node-pty", "package.json"),
    path.join(desktopRuntimeRoot, `node-pty-${process.platform}-${process.arch}`, "package.json"),
  ].find((file) => !existsSync(file));
  if (missingDesktopRuntimeFile) {
    throw Error(
      `Packaged app is missing a desktop runtime dependency: ${missingDesktopRuntimeFile}`,
    );
  }

  const unwantedRuntimeFile = [packagedStandaloneBase, agentRuntimeRoot].flatMap((directory) =>
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:map|[cm]?ts)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  )[0];
  if (unwantedRuntimeFile) {
    throw Error(`Packaged app contains a non-runtime source artifact: ${unwantedRuntimeFile}`);
  }

  const agentRuntimeSource = readFileSync(agentRuntime, "utf8");
  if (
    /["'](?:[A-Za-z]:\\|\/(?:Users|home|root)\/)[^"'\n]*node_modules[\\/]/.test(agentRuntimeSource)
  ) {
    throw Error("Packaged agent runtime contains a build-machine dependency path");
  }

  if (electronPlatformName === "darwin") {
    const helperExecutable = path.join(
      path.dirname(resourcesDir),
      "Frameworks",
      `${productFilename} Helper.app`,
      "Contents",
      "MacOS",
      `${productFilename} Helper`,
    );
    if (!existsSync(helperExecutable)) {
      throw Error(`Packaged app is missing its Pi helper executable: ${helperExecutable}`);
    }
  }

  const packagedPiCli = path.join(
    resourcesDir,
    "app",
    "frontend",
    ".next",
    "standalone",
    "frontend",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (!existsSync(packagedPiCli)) {
    throw Error(`Packaged app is missing its Pi CLI: ${packagedPiCli}`);
  }
  console.log(
    `  afterPack: embedded frontend and agent runtime present, app.asar ${appArchiveBytes} bytes (${electronPlatformName})`,
  );
}
