import { existsSync } from "node:fs";
import path from "node:path";

export function resolveBundledPluginDirectory(): string | null {
  const resources = process.env.LOCAL_STUDIO_RESOURCES_PATH?.trim();
  const candidates = [
    resources ? path.join(resources, "desktop", "resources", "plugins") : null,
    path.resolve(process.cwd(), "frontend", "desktop", "resources", "plugins"),
    path.resolve(process.cwd(), "desktop", "resources", "plugins"),
    path.resolve(process.cwd(), "..", "frontend", "desktop", "resources", "plugins"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(existsSync) ?? null;
}
