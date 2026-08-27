import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const LEGACY_CONTROLLER_LABEL = "org.local.studio.controller";

export function retireLegacyController(homeDirectory: string): boolean {
  if (process.platform !== "darwin") return false;
  const uid = process.getuid?.();
  if (uid === undefined) return false;
  const launchAgent = path.join(
    homeDirectory,
    "Library",
    "LaunchAgents",
    `${LEGACY_CONTROLLER_LABEL}.plist`,
  );
  const controllerSource = path.join(
    homeDirectory,
    "Library",
    "Application Support",
    "Local Studio",
    "controller-source",
  );
  if (!existsSync(launchAgent) && !existsSync(controllerSource)) return false;

  const service = `gui/${uid}/${LEGACY_CONTROLLER_LABEL}`;
  try {
    execFileSync("/bin/launchctl", ["bootout", service], { stdio: "ignore" });
  } catch {}
  try {
    execFileSync("/bin/launchctl", ["disable", service], { stdio: "ignore" });
  } catch {}
  rmSync(launchAgent, { force: true });
  rmSync(controllerSource, { force: true, recursive: true });
  return true;
}
