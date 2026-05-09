import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PI_BIN = process.platform === "win32" ? "pi.cmd" : "pi";

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
    process.resourcesPath
      ? path.join(
          process.resourcesPath,
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
