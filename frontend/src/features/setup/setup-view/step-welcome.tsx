"use client";

import { ChevronRight, Rocket } from "@/ui/icon-registry";
import { Button, Card, Input, StatusPill, Spinner } from "@/ui";
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
  const controllerLabel = diagnostics
    ? [
        diagnostics.platform,
        diagnostics.arch,
        diagnostics.gpus.length ? `${diagnostics.gpus.length} GPU` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "controller pending";

  return (
    <Card padding="lg" className="space-y-5">
      <div className="flex items-center gap-3">
        <Rocket className="h-5 w-5 text-(--hl1)" />
        <h2 className="text-lg font-medium">Choose your controller storage</h2>
      </div>
      <p className="text-sm text-(--dim)">
        The active controller owns model weights, runtimes, and launches. This desktop stays the
        control surface, even when the controller is another machine.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-(--ui-border) bg-(--ui-hover)/30 px-3 py-2 text-sm">
        <span className="text-(--dim)">Setup target</span>
        <StatusPill tone={diagnostics ? "info" : "warning"}>{controllerLabel}</StatusPill>
      </div>
      <div>
        <Input
          label="Model weights directory"
          value={modelsDir}
          onChange={(event) => setModelsDir(event.target.value)}
          placeholder="/mnt/llm_models"
        />
        {settings?.config_path && (
          <div className="text-xs text-(--dim) mt-2">Controller config: {settings.config_path}</div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={saveSettings}
          disabled={savingSettings}
          icon={savingSettings ? <Spinner /> : <ChevronRight className="h-4 w-4" />}
        >
          Inspect hardware
        </Button>
      </div>
    </Card>
  );
}
