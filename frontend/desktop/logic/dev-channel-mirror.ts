import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const MIRRORED_ENTRIES = [
  "pi-agent",
  "agent-session-metadata.json",
  "automations",
  "goals",
  "mcp",
  "controllers.json",
  "connectors.json",
  "projects.json",
  "session-prefs.json",
  "ui-preferences.json",
  "desktop-settings.json",
  "api-settings.json",
  "Local Storage",
] as const;

export type DevMirrorResult = { copied: string[]; skipped: string[] };

export function mirrorStableUserData(options: {
  stableDir: string;
  devDir: string;
}): DevMirrorResult {
  const { stableDir, devDir } = options;
  const copied: string[] = [];
  const skipped: string[] = [];

  if (path.resolve(stableDir) === path.resolve(devDir)) {
    throw new Error("dev-channel mirror refused: source and destination are the same directory");
  }
  if (!existsSync(stableDir)) return { copied, skipped: [...MIRRORED_ENTRIES] };

  for (const entry of MIRRORED_ENTRIES) {
    const source = path.join(stableDir, entry);
    if (!existsSync(source)) {
      skipped.push(entry);
      continue;
    }
    const target = path.join(devDir, entry);
    try {
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, {
        recursive: statSync(source).isDirectory(),
        force: true,
        errorOnExist: false,
      });
      copied.push(entry);
    } catch (error) {
      console.warn(`[desktop] dev mirror skipped ${entry}:`, error);
      skipped.push(entry);
    }
  }
  return { copied, skipped };
}
