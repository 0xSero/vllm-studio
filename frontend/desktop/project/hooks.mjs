import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { git, repoRoot } from "./lib.mjs";

const zeroSha = /^0{40}$/;

function execute(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${command} ${args.join(" ")} failed with status ${result.status ?? 1}`);
}

function removeWorktree(directory) {
  spawnSync("git", ["worktree", "remove", "--force", directory], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  rmSync(directory, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: repoRoot, stdio: "ignore" });
}

function installSnapshot(directory) {
  execute("bun", ["install", "--frozen-lockfile"], directory);
}

function stagedPaths() {
  const output = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return output ? output.split("\n") : [];
}

function validateSnapshot(directory, files) {
  installSnapshot(directory);
  const canonicalJson = "shared/model-recommendations.json";
  const canonicalPath = path.join(directory, canonicalJson);
  if (!existsSync(canonicalPath)) throw Error(`Missing canonical model data: ${canonicalJson}`);
  const canonicalSource = readFileSync(canonicalPath, "utf8");
  let canonicalData;
  try {
    canonicalData = JSON.parse(canonicalSource);
  } catch (error) {
    throw Error(`Invalid canonical model data: ${canonicalJson}`, { cause: error });
  }
  const terminalNewline = canonicalSource.endsWith("\n") ? "\n" : "";
  if (canonicalSource !== `${JSON.stringify(canonicalData)}${terminalNewline}`) {
    throw Error(`${canonicalJson} must use canonical compact JSON`);
  }
  const formatted = files.filter(
    (file) =>
      file !== canonicalJson &&
      /\.(?:css|js|jsx|json|md|mjs|ts|tsx)$/.test(file) &&
      existsSync(path.join(directory, file)),
  );
  if (formatted.length > 0) {
    execute(
      path.join(directory, "node_modules", ".bin", "prettier"),
      ["--check", ...formatted],
      directory,
    );
  }
  const importHook =
    'import hook from "./frontend/desktop/project.mjs"; if (hook.name !== "afterPack") process.exit(1)';
  const importSymlink =
    'import hook from "./scripts/project.mjs"; if (hook.name !== "afterPack") process.exit(1)';
  execute(process.execPath, ["--input-type=module", "--eval", importHook], directory);
  execute(process.execPath, ["--input-type=module", "--eval", importSymlink], directory);
  const frontend = path.join(directory, "frontend");
  if (files.some((file) => /(^|\/)(?:package\.json|package-lock\.json|bun\.lockb?)$/.test(file))) {
    execute("node", ["../scripts/project.mjs", "validate-package"], frontend);
  }
  const lintFiles = files.filter((file) => /\.(?:js|jsx|mjs|ts|tsx)$/.test(file));
  if (lintFiles.length > 0) {
    execute(
      path.join(directory, "node_modules", ".bin", "oxlint"),
      ["--type-aware", "--deny-warnings", "--config", "frontend/.oxlintrc.json", ...lintFiles],
      directory,
    );
    const frontendFiles = lintFiles.filter((file) =>
      /^frontend\/src\/.*\.(?:js|jsx|ts|tsx)$/.test(file),
    );
    if (frontendFiles.length > 0) {
      execute(
        path.join(directory, "node_modules", ".bin", "eslint"),
        ["--max-warnings=0", ...frontendFiles.map((file) => path.relative("frontend", file))],
        frontend,
      );
    }
  }
  if (files.some((file) => /^(frontend\/src|shared)\//.test(file))) {
    execute("bun", ["run", "format:check"], frontend);
    execute("bun", ["run", "typecheck"], frontend);
  }
  if (files.some((file) => /^(frontend\/desktop|shared)\//.test(file))) {
    execute("bun", ["run", "typecheck:desktop"], frontend);
    execute("bun", ["run", "typecheck:extensions"], frontend);
  }
  if (files.some((file) => /^(controller|shared)\//.test(file))) {
    execute("bun", ["run", "typecheck"], path.join(directory, "controller"));
  }
  if (files.some((file) => /^(services\/agent-runtime|shared)\//.test(file))) {
    execute("bun", ["run", "check"], path.join(directory, "services", "agent-runtime"));
  }
}

export function preCommit() {
  const branch = git(["branch", "--show-current"]);
  if (["main", "dev"].includes(branch)) {
    throw Error(`pre-commit: commits on ${branch} are blocked; use a work branch and PR`);
  }
  const files = stagedPaths();
  if (files.length === 0) return;
  const directory = mkdtempSync(path.join(tmpdir(), "localstudio-staged-"));
  try {
    const tree = git(["write-tree"]);
    const archive = spawnSync("git", ["archive", tree], {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 512,
    });
    if (archive.error) throw archive.error;
    if (archive.status !== 0) throw Error(`git archive failed with status ${archive.status ?? 1}`);
    const unpack = spawnSync("tar", ["-x", "-C", directory], {
      input: archive.stdout,
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (unpack.error) throw unpack.error;
    if (unpack.status !== 0) throw Error(`tar failed with status ${unpack.status ?? 1}`);
    validateSnapshot(directory, files);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function pushedUpdates() {
  const input = readFileSync(0, "utf8").trim();
  return (input ? input.split("\n") : []).map((line) => {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha)
      throw Error(`pre-push: malformed update: ${line}`);
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

function commitRange(remote, localSha, remoteSha) {
  if (!zeroSha.test(remoteSha)) return `${remoteSha}..${localSha}`;
  let base = `${remote}/main`;
  try {
    base = git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
  } catch {}
  try {
    return `${git(["merge-base", base, localSha])}..${localSha}`;
  } catch {
    return localSha;
  }
}

function validatePushedSha(sha) {
  const nodeVersion = process.version;
  const bun = spawnSync("bun", ["--version"], { cwd: repoRoot, encoding: "utf8" });
  if (bun.error || bun.status !== 0) throw Error("Bun is required but unavailable");
  const bunVersion = bun.stdout.trim();
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  const cacheDir = path.resolve(repoRoot, commonDir, "localstudio-pre-push");
  mkdirSync(cacheDir, { recursive: true });
  const key = createHash("sha256").update(`${sha}\0${nodeVersion}\0${bunVersion}`).digest("hex");
  const marker = path.join(cacheDir, key);
  if (existsSync(marker)) {
    console.log(`pre-push: cached validation for ${sha}`);
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), "localstudio-push-"));
  try {
    execute("git", ["worktree", "add", "--detach", directory, sha], repoRoot);
    installSnapshot(directory);
    const frontend = path.join(directory, "frontend");
    execute("bun", ["run", "check:static"], frontend);
    execute("bun", ["run", "check:cleanup"], frontend);
    execute("bun", ["run", "build"], frontend);
    execute(process.execPath, ["scripts/project.mjs", "assert-standalone"], directory);
    writeFileSync(marker, `${sha} ${nodeVersion} ${bunVersion}\n`, { flag: "wx" });
  } finally {
    removeWorktree(directory);
  }
}

export function prePush() {
  const remote = process.argv[2];
  const url = process.argv[3];
  if (!remote || !url) throw Error("pre-push: remote name and URL are required");
  const updates = pushedUpdates();
  for (const { localRef, localSha, remoteRef, remoteSha } of updates) {
    if (["refs/heads/main", "refs/heads/dev"].includes(remoteRef)) {
      throw Error(`pre-push: direct pushes to ${remoteRef} are blocked; merge through GitHub`);
    }
    if (zeroSha.test(localSha)) continue;
    const range = commitRange(remote, localSha, remoteSha);
    console.log(`Checking conventional commits for ${localRef} -> ${remote}/${remoteRef} (${url})`);
    execute(
      process.execPath,
      [path.join(repoRoot, "scripts/project.mjs"), "check-commits", "--range", range],
      repoRoot,
    );
    validatePushedSha(localSha);
  }
}
