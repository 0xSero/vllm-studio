"use client";

import { Download, RefreshCw } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { SettingsButton, SettingsGroup, SettingsRow, SettingsValue } from "./settings-ui";
import { useAppUpdate } from "@/features/shell/use-app-update";

// "Application" block for the General settings section: the installed version
// plus a one-click update against the newest GitHub release.
export function AppVersionSection() {
  const update = useAppUpdate();
  const onLatest = update.currentVersion && update.latestVersion && !update.updateAvailable;
  const description = update.updateAvailable
    ? update.phase === "ready"
      ? `v${update.latestVersion} is downloaded — restart to finish updating.`
      : `v${update.latestVersion} is available on GitHub.`
    : onLatest
      ? "You are on the latest version."
      : update.latestVersion
        ? `Latest release: v${update.latestVersion}.`
        : "Release check unavailable.";
  return (
    <SettingsGroup title="Application" description="Local Studio desktop app.">
      <SettingsRow
        label="Version"
        description={description}
        value={
          <SettingsValue mono>
            {update.currentVersion ? `v${update.currentVersion}` : "Web UI"}
          </SettingsValue>
        }
        actions={
          update.updateAvailable ? (
            <SettingsButton onClick={update.startUpdate} tone="primary">
              {update.phase === "working" ? (
                <Spinner size="xs" />
              ) : update.phase === "ready" ? (
                <RefreshCw className="h-3 w-3" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {update.phase === "ready" ? "Restart to update" : "Update"}
            </SettingsButton>
          ) : undefined
        }
      />
    </SettingsGroup>
  );
}
