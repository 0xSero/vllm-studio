export type SettingsDestination =
  | "profile"
  | "connection"
  | "appearance"
  | "terminal"
  | "archive"
  | "usage"
  | "machines"
  | "machine:local:status"
  | "machine:local:controller"
  | "machine:local:system"
  | "machine:local:logs";

export const settingsHref = (destination: SettingsDestination | string = "connection"): string =>
  `/settings#${destination}`;

export const legacySettingsHash = (hash: string): string | null => {
  if (hash === "profile") return "connection";
  if (hash === "desktop") return "terminal";
  if (hash === "status") return "machine:local:status";
  if (hash === "controller") return "machine:local:controller";
  if (["system", "engines", "services", "setup"].includes(hash)) {
    return hash === "system" ? "machine:local:system" : "machine:local:controller";
  }
  if (hash === "rig" || hash === "machines") return "machines";
  if (hash === "usage") return "usage";
  if (hash === "logs") return "machine:local:logs";
  return null;
};
