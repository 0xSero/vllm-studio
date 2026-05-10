import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PI_BIN = process.platform === "win32" ? "pi.cmd" : "pi";

const resourcesPath = (): string | undefined =>
  process.env.VLLM_STUDIO_RESOURCES_PATH || process.resourcesPath;

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const unique = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const localBinDirs = (): string[] =>
  unique([
    path.join(process.cwd(), "node_modules", ".bin"),
    path.join(process.cwd(), "frontend", "node_modules", ".bin"),
    path.join(process.cwd(), "..", "frontend", "node_modules", ".bin"),
    resourcesPath()
      ? path.join(
          resourcesPath()!,
          "app",
          "frontend",
          ".next",
          "standalone",
          "node_modules",
          ".bin",
        )
      : null,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(homedir(), ".bun", "bin"),
    path.join(homedir(), ".local", "bin"),
    path.join(homedir(), "bin"),
  ]);

const localCliFiles = (): string[] =>
  unique([
    resourcesPath()
      ? path.join(
          resourcesPath()!,
          "app",
          "frontend",
          ".next",
          "standalone",
          "node_modules",
          "@mariozechner",
          "pi-coding-agent",
          "dist",
          "cli.js",
        )
      : null,
    resourcesPath()
      ? path.join(
          resourcesPath()!,
          "app.asar",
          "node_modules",
          "@mariozechner",
          "pi-coding-agent",
          "dist",
          "cli.js",
        )
      : null,
    resourcesPath()
      ? path.join(
          resourcesPath()!,
          "app",
          "node_modules",
          "@mariozechner",
          "pi-coding-agent",
          "dist",
          "cli.js",
        )
      : null,
    path.join(process.cwd(), "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js"),
    path.join(
      process.cwd(),
      "frontend",
      "node_modules",
      "@mariozechner",
      "pi-coding-agent",
      "dist",
      "cli.js",
    ),
    path.join(
      process.cwd(),
      "..",
      "frontend",
      "node_modules",
      "@mariozechner",
      "pi-coding-agent",
      "dist",
      "cli.js",
    ),
  ]);

export function piPathEnv(): string {
  return unique([...localBinDirs(), process.env.PATH]).join(path.delimiter);
}

export function resolvePiBinaryPath(): string | null {
  const explicit = process.env.VLLM_STUDIO_PI_BINARY?.trim();
  if (explicit && isExecutable(explicit)) return explicit;
  for (const dir of unique([
    ...localBinDirs(),
    ...(process.env.PATH ?? "").split(path.delimiter),
  ])) {
    const candidate = path.join(dir, PI_BIN);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function resolvePiCliPath(): string | null {
  return localCliFiles().find((candidate) => existsSync(candidate)) ?? null;
}

export function resolvePiLaunchCommand(): { command: string; argsPrefix: string[] } {
  const embeddedCli = resourcesPath() ? resolvePiCliPath() : null;
  if (embeddedCli) return { command: process.execPath, argsPrefix: [embeddedCli] };
  const binary = resolvePiBinaryPath();
  if (binary) return { command: binary, argsPrefix: [] };
  const cli = resolvePiCliPath();
  if (cli) return { command: process.execPath, argsPrefix: [cli] };
  return { command: "pi", argsPrefix: [] };
}
