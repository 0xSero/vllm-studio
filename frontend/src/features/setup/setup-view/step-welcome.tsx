"use client";

import { Button, Input, Spinner } from "@/ui";
import type { StudioDiagnostics, StudioSettings } from "@/lib/types";

export function StepWelcome({
  modelsDir,
  setModelsDir,
  settings,
  diagnostics,
  saveSettings,
  savingSettings,
}: {
  modelsDir: string;
  setModelsDir: (value: string) => void;
  settings: StudioSettings | null;
  diagnostics: StudioDiagnostics | null;
  saveSettings: () => void;
  savingSettings: boolean;
}) {
  const target = diagnostics
    ? [
        diagnostics.platform,
        diagnostics.arch,
        diagnostics.gpus.length ? `${diagnostics.gpus.length} GPU` : "no GPU",
        diagnostics.memory_total ? `${Math.round(diagnostics.memory_total / 1024 ** 3)} GB` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="rounded-[10px] border border-(--ui-border) bg-(--ui-surface)/40 p-6">
      <div className="flex items-center justify-between border-b border-(--ui-border)/60 pb-4">
        <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">This machine</span>
        <span className="font-mono text-[length:var(--fs-sm)] text-(--fg)">
          {target ?? <Spinner size="xs" />}
        </span>
      </div>
      <div className="pt-5">
        <Input
          label="Where model weights live"
          value={modelsDir}
          onChange={(event) => setModelsDir(event.target.value)}
          placeholder="/models"
        />
        {settings?.config_path ? (
          <p className="mt-2 truncate font-mono text-[10px] text-(--ui-muted)">
            {settings.config_path}
          </p>
        ) : null}
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={saveSettings} disabled={savingSettings}>
          {savingSettings ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
