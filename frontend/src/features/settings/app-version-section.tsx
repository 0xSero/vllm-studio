"use client";

import { Download, RefreshCw } from "@/ui/icon-registry";
import { SegmentedControl, Spinner, type SegmentedItem } from "@/ui";
import { SettingsButton, SettingsGroup, SettingsRow, SettingsValue } from "./settings-ui";
import { useAppUpdate, type AppUpdate } from "@/features/shell/use-app-update";
import type { DesktopUpdateChannel } from "../../../desktop/types";

const UPDATE_CHANNELS: SegmentedItem<DesktopUpdateChannel>[] = [
  { id: "stable", label: "Stable" },
  { id: "nightly", label: "Nightly" },
];

function versionDescription(update: AppUpdate, progress: number | null): string {
  if (update.releaseChannel === "dev") return "Dev builds update through the local installer.";
  if (update.status === "checking") {
    return `Checking the ${update.updateChannel ?? "stable"} channel for updates.`;
  }
  if (update.phase === "ready") {
    return `v${update.latestVersion} is downloaded — restart to finish updating.`;
  }
  if (update.status === "downloading") {
    return `Downloading v${update.latestVersion}${progress === null ? "." : ` — ${progress}%.`}`;
  }
  if (update.updateAvailable) return `v${update.latestVersion} is available on GitHub.`;
  if (update.currentVersion === update.latestVersion && update.status === "not-available") {
    return "You are on the latest version.";
  }
  if (update.latestVersion) {
    return `Latest ${update.updateChannel ?? "stable"} release: v${update.latestVersion}.`;
  }
  if (update.phase === "failed") return "Release check failed. Try again when GitHub is reachable.";
  return "Release check unavailable.";
}

function UpdateAction({ update, progress }: { update: AppUpdate; progress: number | null }) {
  const onClick = update.updateAvailable ? update.startUpdate : update.checkForUpdates;
  let icon = <Download className="h-3 w-3" />;
  let label = update.updateAvailable ? "Update" : "Check for updates";
  if (update.status === "checking") {
    icon = <Spinner size="xs" />;
    label = "Checking…";
  } else if (update.status === "downloading") {
    label = progress === null ? "Downloading…" : `Downloading ${progress}%`;
  } else if (update.phase === "ready") {
    icon = <RefreshCw className="h-3 w-3" />;
    label = "Restart to update";
  }

  return (
    <SettingsButton
      onClick={onClick}
      tone={update.updateAvailable ? "primary" : "default"}
      disabled={update.status === "checking"}
    >
      {icon}
      {label}
    </SettingsButton>
  );
}

export function AppVersionSection() {
  const update = useAppUpdate();
  const desktopUpdates = update.releaseChannel === "stable";
  const progress = update.progress === null ? null : Math.round(update.progress);
  const description = versionDescription(update, progress);
  return (
    <SettingsGroup title="Application" description="Version and updates.">
      {desktopUpdates ? (
        <SettingsRow
          label="Update channel"
          description={
            update.updateChannel === "nightly"
              ? "Rolling signed builds from every push to main."
              : "Versioned releases intended for everyday use."
          }
          control={
            <SegmentedControl
              items={UPDATE_CHANNELS}
              value={update.updateChannel ?? "stable"}
              onChange={update.setUpdateChannel}
              disabled={update.phase === "working" || update.phase === "ready"}
              size="sm"
            />
          }
        />
      ) : null}
      <SettingsRow
        label="Version"
        description={description}
        value={
          <SettingsValue mono>
            {update.currentVersion ? `v${update.currentVersion}` : "Web UI"}
          </SettingsValue>
        }
        actions={desktopUpdates ? <UpdateAction update={update} progress={progress} /> : undefined}
      />
    </SettingsGroup>
  );
}
