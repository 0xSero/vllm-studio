import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { Effect, Semaphore } from "effect";
import lockfile from "proper-lockfile";
import type { ConnectorConfig, GitHubConnectorArtifactStatus } from "./connector-contract";
import { resolveDataDir } from "./data-dir";
import { connectMcp } from "./mcp-client";

export const GITHUB_MCP_VERSION = "1.6.0";
export const GITHUB_MCP_ARGS = [
  "stdio",
  "--read-only",
  "--toolsets=repos,issues,pull_requests",
] as const;
export const GITHUB_MCP_TOOLS = [
  "get_commit",
  "get_file_contents",
  "get_label",
  "get_latest_release",
  "get_release_by_tag",
  "get_tag",
  "issue_read",
  "list_branches",
  "list_commits",
  "list_issue_fields",
  "list_issue_types",
  "list_issues",
  "list_pull_requests",
  "list_releases",
  "list_repository_collaborators",
  "list_tags",
  "pull_request_read",
  "search_code",
  "search_commits",
  "search_issues",
  "search_pull_requests",
  "search_repositories",
] as const;

export type GitHubMcpArtifact = {
  target: string;
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  url: string;
  archiveName: string;
  archiveFormat: "tar.gz" | "zip";
  archiveSize: number;
  archiveSha256: string;
  executableName: string;
  executableSize: number;
  executableSha256: string;
  entries: readonly { name: string; size: number }[];
};

export type WindowsArtifactSecurity = {
  protect(entry: string, kind: "directory" | "file"): Promise<void>;
  verify(entry: string, kind: "directory" | "file"): Promise<void>;
};

export type GitHubMcpArtifactDependencies = {
  platform?: NodeJS.Platform;
  arch?: string;
  dataDir?: string;
  artifact?: GitHubMcpArtifact;
  fetch?: typeof fetch;
  rename?: typeof rename;
  timeoutMs?: number;
  verifyExecutable?: (command: string) => Promise<void>;
  windowsSecurity?: WindowsArtifactSecurity;
};

export type GitHubMcpVerificationOptions = {
  prefixArgs?: readonly string[];
  expectedTools?: readonly string[];
  timeoutMs?: number;
};

const artifact = (input: Omit<GitHubMcpArtifact, "version" | "entries">): GitHubMcpArtifact => ({
  ...input,
  version: GITHUB_MCP_VERSION,
  entries: [
    { name: "LICENSE", size: 1_063 },
    { name: "README.md", size: 98_313 },
    { name: input.executableName, size: input.executableSize },
  ],
});

export const GITHUB_MCP_ARTIFACTS: Readonly<Record<string, GitHubMcpArtifact>> = {
  "darwin-arm64": artifact({
    target: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Darwin_arm64.tar.gz",
    archiveName: "github-mcp-server_Darwin_arm64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 7_644_753,
    archiveSha256: "cdce71ef6f893d463910678ec298bba76610ca4591bf35263f0ff0ec35928f9e",
    executableName: "github-mcp-server",
    executableSize: 23_627_042,
    executableSha256: "60e178495ae2bcb898eaffc2c21d299d553a259914430c9eaa8b3f5f76f5d129",
  }),
  "darwin-x64": artifact({
    target: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Darwin_x86_64.tar.gz",
    archiveName: "github-mcp-server_Darwin_x86_64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 8_122_888,
    archiveSha256: "75bf4fb2c855a3af5381056b88afdf2e2b67e330906aadfbae9682e8dcacbd3f",
    executableName: "github-mcp-server",
    executableSize: 24_877_744,
    executableSha256: "6a052a0a75b69fe777543039fbdeaab50e2a5262d55e43917661c558bad790d3",
  }),
  "linux-arm64": artifact({
    target: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Linux_arm64.tar.gz",
    archiveName: "github-mcp-server_Linux_arm64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 7_302_795,
    archiveSha256: "25f8028304202674ec2e9977fec3ca0897cac33866dabb51aefd418bc0ce7ef2",
    executableName: "github-mcp-server",
    executableSize: 22_937_784,
    executableSha256: "5d47f9e36850769db8a46c97a7ad1e7a1bd51502c57765a81e697f5740455227",
  }),
  "linux-x64": artifact({
    target: "linux-x64",
    platform: "linux",
    arch: "x64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Linux_x86_64.tar.gz",
    archiveName: "github-mcp-server_Linux_x86_64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 7_957_825,
    archiveSha256: "27443d173f209e60d4af9777e624bfea3de1af24897d46cc7324f01cf279a41d",
    executableName: "github-mcp-server",
    executableSize: 24_309_944,
    executableSha256: "955fff9cf50ae99ee021871a4782c36360252d82fd03c8307fd7394c44ba3886",
  }),
  "win32-x64": artifact({
    target: "win32-x64",
    platform: "win32",
    arch: "x64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Windows_x86_64.zip",
    archiveName: "github-mcp-server_Windows_x86_64.zip",
    archiveFormat: "zip",
    archiveSize: 8_147_960,
    archiveSha256: "699d91a1f49897d9c51cef5794cb423401a1ab27e263c76168c133dff0d004e0",
    executableName: "github-mcp-server.exe",
    executableSize: 24_920_576,
    executableSha256: "66702e31cd5577e4c1437337599759256bbc23bed1bb5a76aa5f5525abc0ee1a",
  }),
};

const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 16;
const INSTALL_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 10_000;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const EXECUTABLE_MODE = 0o500;
const GITHUB_TOKEN_KEY = "GITHUB_PERSONAL_ACCESS_TOKEN";
const installSemaphore = Semaphore.makeUnsafe(1);

export class GitHubConnectorArtifactError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubConnectorArtifactError";
  }
}

const artifactFailure = (error: unknown): GitHubConnectorArtifactError =>
  error instanceof GitHubConnectorArtifactError
    ? error
    : new GitHubConnectorArtifactError(502, "GitHub MCP installation failed", { cause: error });

const targetKey = (platform: NodeJS.Platform, arch: string): string => `${platform}-${arch}`;

export function githubMcpArtifactFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GitHubMcpArtifact | null {
  return GITHUB_MCP_ARTIFACTS[targetKey(platform, arch)] ?? null;
}

function selectedArtifact(dependencies: GitHubMcpArtifactDependencies): GitHubMcpArtifact | null {
  return (
    dependencies.artifact ??
    githubMcpArtifactFor(
      dependencies.platform ?? process.platform,
      dependencies.arch ?? process.arch,
    )
  );
}

export function resolvedGitHubMcpDataDir(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = paths.resolve(dataDir);
  return paths.relative(paths.parse(resolved).root, resolved) ? resolved : null;
}

function selectedDataDir(dependencies: GitHubMcpArtifactDependencies): string {
  const candidate = dependencies.dataDir ?? resolveDataDir();
  const resolved = path.resolve(candidate);
  if (!path.relative(path.parse(resolved).root, resolved)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP data directory is unsafe");
  }
  return resolved;
}

const installRoot = (dataDir: string): string =>
  path.join(dataDir, "runtime", "connectors", "github-mcp-server");

const versionRoot = (dataDir: string, selected: GitHubMcpArtifact): string =>
  path.join(installRoot(dataDir), selected.version);

export function githubMcpExecutablePath(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  dataDir: string = resolveDataDir(),
): string | null {
  const selected = githubMcpArtifactFor(platform, arch);
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = resolvedGitHubMcpDataDir(dataDir, platform);
  return selected && resolved
    ? paths.join(
        resolved,
        "runtime",
        "connectors",
        "github-mcp-server",
        selected.version,
        selected.executableName,
      )
    : null;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function ownerMatches(stat: { uid: number }): boolean {
  const uid = process.geteuid?.();
  return uid === undefined || stat.uid === uid;
}

function sameResolvedPath(actual: string, expected: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return (
      path.win32.normalize(actual).toLowerCase() === path.win32.normalize(expected).toLowerCase()
    );
  }
  return actual === path.resolve(expected);
}

function missing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

function installedDirectories(dataDir: string, selected: GitHubMcpArtifact): string[] {
  return [
    dataDir,
    path.join(dataDir, "runtime"),
    path.join(dataDir, "runtime", "connectors"),
    installRoot(dataDir),
    versionRoot(dataDir, selected),
  ];
}

function installedState(
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
): "installed" | "not-installed" | "invalid" {
  const root = versionRoot(dataDir, selected);
  const executable = path.join(root, selected.executableName);
  try {
    lstatSync(root);
  } catch (error) {
    return missing(error) ? "not-installed" : "invalid";
  }
  try {
    for (const entry of installedDirectories(dataDir, selected)) {
      const directory = lstatSync(entry);
      if (
        directory.isSymbolicLink() ||
        !directory.isDirectory() ||
        !ownerMatches(directory) ||
        !sameResolvedPath(realpathSync(entry), entry, platform) ||
        (platform !== "win32" && (directory.mode & 0o777) !== PRIVATE_DIRECTORY_MODE)
      ) {
        return "invalid";
      }
    }
    const entries = readdirSync(root);
    if (entries.length !== 1 || entries[0] !== selected.executableName) return "invalid";
    const file = lstatSync(executable);
    if (
      file.isSymbolicLink() ||
      !file.isFile() ||
      !ownerMatches(file) ||
      file.size !== selected.executableSize ||
      (platform !== "win32" && (file.mode & 0o777) !== EXECUTABLE_MODE)
    ) {
      return "invalid";
    }
    return sha256(readFileSync(executable)) === selected.executableSha256 ? "installed" : "invalid";
  } catch {
    return "invalid";
  }
}

const POWERSHELL_ACL_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$action=[Environment]::GetEnvironmentVariable('LOCAL_STUDIO_ACL_ACTION')",
  "$kind=[Environment]::GetEnvironmentVariable('LOCAL_STUDIO_ACL_KIND')",
  "$entry=[Environment]::GetEnvironmentVariable('LOCAL_STUDIO_ACL_ENTRY')",
  "if(($action -ne 'protect' -and $action -ne 'verify') -or ($kind -ne 'directory' -and $kind -ne 'file') -or [String]::IsNullOrWhiteSpace($entry)){throw 'ACL input is invalid'}",
  "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
  "$isDirectory=$kind -eq 'directory'",
  "if($action -eq 'protect') {",
  "  $acl=if($isDirectory){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}",
  "  $acl.SetOwner($sid)",
  "  $acl.SetAccessRuleProtection($true,$false)",
  "  $inherit=if($isDirectory){[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit}else{[Security.AccessControl.InheritanceFlags]::None}",
  "  $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)",
  "  [void]$acl.AddAccessRule($rule)",
  "  if($isDirectory){[IO.Directory]::SetAccessControl($entry,$acl)}else{[IO.File]::SetAccessControl($entry,$acl)}",
  "}",
  "$current=if($isDirectory){[IO.Directory]::GetAccessControl($entry)}else{[IO.File]::GetAccessControl($entry)}",
  "$rules=@($current.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
  "$expectedInheritance=if($isDirectory){[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit}else{[Security.AccessControl.InheritanceFlags]::None}",
  "$valid=$current.AreAccessRulesProtected -and $current.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid.Value -and $rules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rules[0].InheritanceFlags -eq $expectedInheritance -and (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)",
  "if(-not $valid){throw 'ACL verification failed'}",
  "[Console]::Out.Write('{\"ok\":true}')",
].join(";");

function trustedPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot?.trim() || "C:\\Windows";
  const resolvedRoot = path.win32.resolve(systemRoot);
  if (
    !path.win32.isAbsolute(resolvedRoot) ||
    path.win32.dirname(resolvedRoot).toLowerCase() !==
      path.win32.parse(resolvedRoot).root.toLowerCase()
  ) {
    throw new Error("Windows ACL verifier is unavailable");
  }
  const candidate = path.win32.join(
    resolvedRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const info = lstatSync(candidate);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    realpathSync(candidate).toLowerCase() !== candidate.toLowerCase()
  ) {
    throw new Error("Windows ACL verifier is unavailable");
  }
  return candidate;
}

function invokeWindowsAcl(action: "protect" | "verify", entry: string, kind: "directory" | "file") {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    let settled = false;
    const environment = Object.fromEntries([
      ...["SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
      ["LOCAL_STUDIO_ACL_ACTION", action],
      ["LOCAL_STUDIO_ACL_KIND", kind],
      ["LOCAL_STUDIO_ACL_ENTRY", entry],
    ]) as NodeJS.ProcessEnv;
    const child = spawn(
      trustedPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(POWERSHELL_ACL_SCRIPT, "utf16le").toString("base64"),
      ],
      {
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"] as const,
        windowsHide: true,
      },
    );
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Windows ACL verifier timed out"));
    }, 5_000);
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += String(chunk);
      if (Buffer.byteLength(output) <= 4_096) return;
      child.kill();
      finish(new Error("Windows ACL verifier output is invalid"));
    });
    child.once("error", () => finish(new Error("Windows ACL verifier failed")));
    child.once("close", (code) =>
      finish(
        code === 0 && output.trim() === '{"ok":true}'
          ? undefined
          : new Error("Windows ACL verifier failed"),
      ),
    );
  });
}

function windowsSecurity(
  dependencies: GitHubMcpArtifactDependencies,
  platform: NodeJS.Platform,
): WindowsArtifactSecurity | null {
  if (platform !== "win32") return null;
  return (
    dependencies.windowsSecurity ?? {
      protect: (entry, kind) => invokeWindowsAcl("protect", entry, kind),
      verify: (entry, kind) => invokeWindowsAcl("verify", entry, kind),
    }
  );
}

async function securedInstalledState(
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsArtifactSecurity | null,
): Promise<"installed" | "not-installed" | "invalid"> {
  const state = installedState(selected, dataDir, platform);
  if (state !== "installed" || !security) return state;
  try {
    for (const entry of installedDirectories(dataDir, selected)) {
      await security.verify(entry, "directory");
    }
    await security.verify(
      path.join(versionRoot(dataDir, selected), selected.executableName),
      "file",
    );
    return "installed";
  } catch {
    return "invalid";
  }
}

async function artifactStatus(
  dependencies: GitHubMcpArtifactDependencies,
): Promise<GitHubConnectorArtifactStatus> {
  const platform = dependencies.platform ?? process.platform;
  const arch = dependencies.arch ?? process.arch;
  const selected = selectedArtifact(dependencies);
  if (!selected) {
    return { version: GITHUB_MCP_VERSION, target: targetKey(platform, arch), state: "unsupported" };
  }
  const dataDir = selectedDataDir(dependencies);
  return {
    version: selected.version,
    target: selected.target,
    state: await securedInstalledState(
      selected,
      dataDir,
      platform,
      windowsSecurity(dependencies, platform),
    ),
  };
}

export function getGitHubConnectorArtifactStatus(
  dependencies: GitHubMcpArtifactDependencies = {},
): Effect.Effect<GitHubConnectorArtifactStatus> {
  return Effect.promise(() => artifactStatus(dependencies));
}
