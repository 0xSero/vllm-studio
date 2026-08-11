"use client";

import { AlertTriangle } from "@/ui/icon-registry";
import { Alert, Spinner } from "@/ui";
import { useSetup } from "../use-setup";
import { SetupShell, type SetupSurface } from "./setup-shell";
import { StepBringup } from "./step-bringup";
import { StepHardware } from "./step-hardware";
import { StepModel } from "./step-model";
import { StepWelcome } from "./step-welcome";
const SURFACES: readonly (SetupSurface & { readonly steps: readonly number[] })[] = [
  {
    steps: [0, 1],
    eyebrow: "Step 1 of 3 — Station",
    title: "Set up your station",
    sub: "Where weights live, and what this machine can run.",
  },
  {
    steps: [2],
    eyebrow: "Step 2 of 3 — Model",
    title: "Pick a model",
    sub: "Measured picks first — real launches on hardware like yours, with the speeds we saw.",
  },
  {
    steps: [3, 4, 5],
    eyebrow: "Step 3 of 3 — Bring-up",
    title: "Bring it online",
    sub: "Download, serve, first tokens.",
  },
];

export function SetupView() {
  const props = useSetup();
  const { step, loading, error, loadWarning, skipSetup } = props;
  const surfaceIndex = SURFACES.findIndex((surface) => surface.steps.includes(step));
  const surface = SURFACES[surfaceIndex] ?? SURFACES[0];

  return (
    <SetupShell
      surfaceIndex={Math.max(0, surfaceIndex)}
      surfaceCount={SURFACES.length}
      surface={surface}
      onSkip={skipSetup}
    >
      {error ? (
        <Alert variant="error" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
          <SetupErrorBody error={error} />
        </Alert>
      ) : null}
      {loadWarning && !error ? (
        <Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
          {loadWarning}
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-3 py-10 text-(--ui-muted)">
          <Spinner size="lg" />
          <span className="text-[length:var(--fs-sm)]">Inspecting the active controller…</span>
        </div>
      ) : step === 0 ? (
        <StepWelcome
          modelsDir={props.modelsDir}
          setModelsDir={props.setModelsDir}
          settings={props.settings}
          diagnostics={props.diagnostics}
          saveSettings={props.saveSettings}
          savingSettings={props.savingSettings}
        />
      ) : step === 1 ? (
        <StepHardware
          diagnostics={props.diagnostics}
          runtimeTargets={props.runtimeTargets}
          runtimeJobs={props.runtimeJobs}
          installRuntime={props.installRuntime}
          updateRuntimeTarget={props.updateRuntimeTarget}
          upgrading={props.upgrading}
          hardwareConfirmed={props.hardwareConfirmed}
          setHardwareConfirmed={props.setHardwareConfirmed}
          continueFromHardware={props.continueFromHardware}
        />
      ) : step === 2 ? (
        <StepModel
          presets={props.presets}
          beginPresetSetup={props.beginPresetSetup}
          remoteApiKey={props.remoteApiKey}
          setRemoteApiKey={props.setRemoteApiKey}
          connectingRemote={props.connectingRemote}
          remoteError={props.remoteError}
          connectRemotePreset={props.connectRemotePreset}
          diagnostics={props.diagnostics}
          maxVram={props.maxVram}
          manualModelId={props.manualModelId}
          setManualModelId={props.setManualModelId}
          manualGgufOptions={props.manualGgufOptions}
          manualGgufFile={props.manualGgufFile}
          setManualGgufFile={props.setManualGgufFile}
          resolvingManualModel={props.resolvingManualModel}
          beginVariantDownload={props.beginVariantDownload}
          submitManualModel={props.submitManualModel}
        />
      ) : (
        <StepBringup
          step={step}
          selectedModel={props.selectedModel}
          downloads={props.downloads}
          activeDownload={props.activeDownload}
          pauseDownload={props.pauseDownload}
          resumeDownload={props.resumeDownload}
          cancelDownload={props.cancelDownload}
          continueToLaunch={() => props.setStep(4)}
          backend={props.selectedPreset?.backend ?? "vllm"}
          configuringRecipe={props.configuringRecipe}
          launchError={props.launchError}
          configureAndLaunch={props.configureAndLaunch}
          benchmarking={props.benchmarking}
          benchmarkResult={props.benchmarkResult}
          benchmarkError={props.benchmarkError}
          runSetupBenchmark={props.runSetupBenchmark}
          openChat={props.openChat}
          openDashboard={props.openDashboard}
        />
      )}
    </SetupShell>
  );
}

function SetupErrorBody({ error }: { error: string }) {
  const [headline, ...rest] = error.split("\n");
  const detail = rest.join("\n").trim();
  return (
    <>
      <p className="break-words">{headline}</p>
      {detail ? (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs opacity-90">
          {detail}
        </pre>
      ) : null}
    </>
  );
}
