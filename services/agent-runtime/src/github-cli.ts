import { existsSync } from "node:fs";
import path from "node:path";

let cached: string | null | undefined;

function searchPath(): string[] {
  const fromEnv = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [...fromEnv, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin"];
}

function locateGithubCli(): string | null {
  const override = process.env.LOCAL_STUDIO_GH_PATH?.trim();
  if (override) return existsSync(override) ? override : null;
  const binary = process.platform === "win32" ? "gh.exe" : "gh";
  for (const dir of searchPath()) {
    const candidate = path.join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function githubCliPathSync(): string | null {
  if (cached === undefined) cached = locateGithubCli();
  return cached;
}

export function hasGithubCliSync(): boolean {
  return githubCliPathSync() !== null;
}
