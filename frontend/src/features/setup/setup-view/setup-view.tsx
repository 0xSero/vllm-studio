"use client";

import { AlertTriangle, HardDrive } from "@/ui/icon-registry";
import { Alert, Button, Spinner } from "@/ui";
import type { ManagedRuntimeInstallBackend } from "@/features/settings/runtime-targets";
import {
  adoptDeployedController,
  useControllerDeploy,
} from "@/features/settings/use-controller-deploy";
import { CONTROLLER_UNREACHABLE_MESSAGE } from "../use-setup-effects";
import type {
  EngineJob,
  ModelDownload,
  RuntimeTarget,
  StarterPreset,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { SetupShell, type SetupSurface } from "./setup-shell";
import { StepBringup } from "./step-bringup";
import { StepHardware } from "./step-hardware";
import { StepModel } from "./step-model";
import { StepWelcome } from "./step-welcome";

interface SetupBenchmarkResult {
  prompt_tokens: number;
  completion_tokens: number;
  total_time_s: number;
  generation_tps: number;
}

interface SetupViewProps {
  step: number;
  setStep: (step: number) => void;
  loading: boolean;
  error: string | null;
  loadWarning: string | null;
  settings: StudioSettings | null;
  modelsDir: string;
  setModelsDir: (value: string) => void;
  diagnostics: StudioDiagnostics | null;
  presets: StarterPreset[];
  selectedPreset: StarterPreset | null;
  beginPresetSetup: (preset: StarterPreset) => void;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset) => void;
  runtimeTargets: RuntimeTarget[];
  runtimeJobs: EngineJob[];
  maxVram: number;
  selectedModel: string;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  resolvingManualModel: boolean;
  savingSettings: boolean;
  upgrading: boolean;
  hardwareConfirmed: boolean;
  setHardwareConfirmed: (value: boolean) => void;
  downloads: ModelDownload[];
  activeDownload: ModelDownload | null;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  saveSettings: () => void;
  installRuntime: (backend: ManagedRuntimeInstallBackend) => void;
  updateRuntimeTarget: (target: RuntimeTarget) => void;
  beginVariantDownload: (modelId: string, allowPatterns?: string[]) => void;
  submitManualModel: () => void;
  continueFromHardware: () => void;
  configuringRecipe: boolean;
  launchError: string | null;
  createdRecipeId: string | null;
  configureAndLaunch: () => void;
  benchmarking: boolean;
  benchmarkResult: SetupBenchmarkResult | null;
  benchmarkError: string | null;
  runSetupBenchmark: () => void;
  openChat: () => void;
  openDashboard: () => void;
  skipSetup: () => void;
}

/** Six wizard steps rendered as three surfaces: where things live, what to run, and a
 *  live bring-up checklist. The state machine in use-setup is untouched. */
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

export function SetupView(props: SetupViewProps) {
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
      {error === CONTROLLER_UNREACHABLE_MESSAGE ? (
        <ControllerUnreachableGate />
      ) : error ? (
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

/**
 * The controller is unreachable. In the desktop app that is an installable
 * condition, not a dead end: offer to run the bundled installer on this
 * machine, stream its progress, and reload once the controller is adopted.
 * The browser build keeps the source-checkout instructions.
 */
function ControllerUnreachableGate() {
  const deploy = useControllerDeploy();

  if (!deploy.available) {
    return (
      <Alert variant="error" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
        <SetupErrorBody error={CONTROLLER_UNREACHABLE_MESSAGE} />
      </Alert>
    );
  }

  const install = async () => {
    const controller = await deploy.run({ mode: "local" }, "This machine");
    if (controller) {
      await adoptDeployedController(controller);
      window.location.reload();
    }
  };

  return (
    <Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
      <p className="break-words">
        No controller is reachable. Install one on this machine, or start yours and reload this
        page.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" onClick={() => void install()} disabled={deploy.running}>
          {deploy.running ? <Spinner size="xs" /> : <HardDrive className="h-3.5 w-3.5" />}
          {deploy.running ? "Installing…" : "Install local controller"}
        </Button>
        {deploy.error ? <span className="text-(--err)">{deploy.error}</span> : null}
        {deploy.done ? <span className="text-(--ok)">{deploy.done}</span> : null}
      </div>
      {deploy.lines.length > 0 ? (
        <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all border border-(--border) px-3 py-2 font-mono text-xs opacity-90">
          {deploy.lines.slice(-12).join("\n")}
        </pre>
      ) : null}
    </Alert>
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
