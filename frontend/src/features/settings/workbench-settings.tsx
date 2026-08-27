"use client";

import { Effect } from "effect";
import { Input, Select } from "@/ui";
import {
  dispatchWorkbenchCommand,
  useWorkbenchPreferences,
} from "@/features/workbench/controller-state";
import { SettingsGroup, SettingsRow } from "./settings-ui";

export function WorkbenchSettings() {
  const preferences = useWorkbenchPreferences();
  const setLifecycleMode = (value: string) => {
    if (value !== "embedded" && value !== "system") return;
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "set_lifecycle_mode",
        lifecycleMode: value,
      }),
    );
  };
  const setCacheLimit = (value: string) => {
    const remoteCacheLimitMb = Math.round(Number(value));
    if (!Number.isFinite(remoteCacheLimitMb)) return;
    if (remoteCacheLimitMb < 64 || remoteCacheLimitMb > 8192) return;
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "set_remote_cache_limit",
        remoteCacheLimitMb,
      }),
    );
  };
  return (
    <SettingsGroup title="Workbench runtime">
      <SettingsRow
        label="Controller lifetime"
        control={
          <Select
            value={preferences.lifecycleMode}
            onChange={(event) => setLifecycleMode(event.target.value)}
            options={[
              { value: "embedded", label: "Quit with Local Studio" },
              { value: "system", label: "Keep tasks running" },
            ]}
            aria-label="Controller lifetime"
            className="w-48"
          />
        }
      />
      <SettingsRow
        label="Remote task cache"
        control={
          <div className="flex items-center gap-2">
            <Input
              key={preferences.remoteCacheLimitMb}
              type="number"
              min={64}
              max={8192}
              defaultValue={preferences.remoteCacheLimitMb}
              onBlur={(event) => setCacheLimit(event.target.value)}
              aria-label="Remote task cache limit in megabytes"
              className="w-24"
            />
            <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">MB</span>
          </div>
        }
      />
    </SettingsGroup>
  );
}
