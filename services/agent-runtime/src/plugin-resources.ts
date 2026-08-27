import { existsSync } from "node:fs";
import path from "node:path";

export function resolveBundledResource(...segments: string[]): string | null {
  const resourcesRoot = process.env.LOCAL_STUDIO_RESOURCES_PATH?.trim() || process.resourcesPath;
  if (resourcesRoot) {
    const packaged = path.join(resourcesRoot, "desktop", "resources", ...segments);
    if (existsSync(packaged)) return packaged;
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    for (const prefix of [
      ["frontend", "desktop", "resources"],
      ["desktop", "resources"],
    ]) {
      const candidate = path.join(dir, ...prefix, ...segments);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveBundledPluginDirectory(): string | null {
  return resolveBundledResource("plugins");
}
