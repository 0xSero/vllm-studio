"use client";

import { AlertTriangle } from "@/ui/icon-registry";
import { Alert, Button, Spinner } from "@/ui";
import type { ManagedRuntimeInstallBackend } from "@/features/settings/runtime-targets";
import { AgentOnboardingWizard } from "@/features/integrations/agent-onboarding-wizard";
import { ClaimMark } from "@/features/integrations/agent-onboarding-controls";
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
import { StepModel, type ApimClientFields } from "./step-model";
import { StepWelcome } from "./step-welcome";
import { StepEnvironment } from "./step-environment";
import { StepAccess } from "./step-access";
import type { GgufFileOption } from "../setup-model-files";
import {
  canCompleteCommissioning,
  type CommissioningEvidence,
  type CommissioningReadiness,
} from "../commissioning-readiness";
import { useCommissioningReadiness } from "../commissioning-readiness-loader";
import { SETUP_TRACKS, type SetupTrack, useSetupTrack } from "../use-setup-track";

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
  remoteSubscriptionKey: { header: string; value: string };
  setRemoteSubscriptionKey: (value: { header: string; value: string }) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset, apimClientFields?: ApimClientFields) => void;
  runtimeTargets: RuntimeTarget[];
  runtimeJobs: EngineJob[];
  maxVram: number;
  selectedModel: string;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  manualGgufOptions: GgufFileOption[];
  manualGgufFile: string;
  setManualGgufFile: (value: string) => void;
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
  exitSetup: () => void;
  completeSetup: () => void;
}

const INFERENCE_STAGES: readonly (SetupSurface & { readonly steps: readonly number[] })[] = [
  {
    steps: [0],
    eyebrow: "Stage 01 · Storage",
    shortTitle: "Storage",
    title: "Set the model store",
    sub: "Confirm the governed location used for model weights and controller-managed artifacts.",
  },
  {
    steps: [1],
    eyebrow: "Stage 02 · Runtime",
    shortTitle: "Runtime",
    title: "Qualify the workstation",
    sub: "Inspect the measured hardware profile and establish a compatible inference runtime.",
  },
  {
    steps: [2],
    eyebrow: "Stage 03 · Model",
    shortTitle: "Model",
    title: "Select an admitted model",
    sub: "Choose from hardware-qualified recommendations, a governed remote provider, or an explicit repository.",
  },
  {
    steps: [3],
    eyebrow: "Stage 04 · Acquisition",
    shortTitle: "Acquire",
    title: "Acquire the model weights",
    sub: "Track the selected artifact transfer and retain an exact local model identity.",
  },
  {
    steps: [4],
    eyebrow: "Stage 05 · Serving",
    shortTitle: "Serve",
    title: "Launch the inference runtime",
    sub: "Create the launch recipe, start the selected backend, and wait for readiness.",
  },
  {
    steps: [5],
    eyebrow: "Stage 06 · Verification",
    shortTitle: "Verify",
    title: "Verify the serving path",
    sub: "Measure one request through the complete API path before entering the workstation.",
  },
];

const SURFACES: readonly SetupSurface[] = [
  {
    eyebrow: "Track 01 · Access",
    shortTitle: "Access",
    title: "Establish enterprise identity",
    sub: "Observe the deployment-owned Entra or Keycloak boundary, authenticate the operator, and verify normalized roles and C2 clearance.",
  },
  {
    eyebrow: "Track 02 · Credentials",
    shortTitle: "Credentials",
    title: "Enroll services and agents",
    sub: "Bind keyring-backed enterprise services, remote API credentials, local coding agents, and an optional remote SSH agent.",
  },
  {
    eyebrow: "Track 03 · Environment",
    shortTitle: "Environment",
    title: "Connect the execution environment",
    sub: "Commission private network access, Kubernetes, and KubeRay without exposing workload credentials to the browser.",
  },
  {
    eyebrow: "Track 04 · Inference",
    shortTitle: "Inference",
    title: "Commission model serving",
    sub: "Configure storage, runtime, model acquisition, serving, and a measured end-to-end verification request.",
  },
  {
    eyebrow: "Track 05 · Review",
    shortTitle: "Review",
    title: "Review the commissioned boundary",
    sub: "Inspect what is configured, what has live evidence, and what remains operator action before entering the workstation.",
  },
];

export function SetupView(props: SetupViewProps) {
  const { step, loading, error, loadWarning, exitSetup } = props;
  const { track, setTrack } = useSetupTrack();
  const readinessState = useCommissioningReadiness();
  const surfaceIndex = SETUP_TRACKS.indexOf(track);
  const surface = SURFACES[surfaceIndex] ?? SURFACES[0];
  const inferenceEvidence: CommissioningEvidence = {
    id: "inference",
    label: "Inference path",
    state: props.benchmarkResult ? "observed" : "claimed",
    detail: props.benchmarkResult
      ? `${props.benchmarkResult.generation_tps.toFixed(1)} tokens/s through the serving path`
      : props.selectedModel
        ? `${props.selectedModel} selected; end-to-end verification remains.`
        : "No model serving path has been selected.",
    required: true,
  };
  const evidence = readinessState.readiness
    ? [...readinessState.readiness.evidence, inferenceEvidence]
    : [inferenceEvidence];

  const selectTrack = (next: SetupTrack) => {
    setTrack(next);
    if (next === "review") void readinessState.refresh();
  };

  return (
    <SetupShell
      surfaceIndex={Math.max(0, surfaceIndex)}
      surfaceCount={SURFACES.length}
      surfaces={SURFACES}
      surface={surface}
      onSkip={exitSetup}
      onSurfaceSelect={(index) => selectTrack(SETUP_TRACKS[index] ?? "access")}
      evidence={evidence}
      evidenceLoading={readinessState.loading}
      evidenceError={readinessState.error}
    >
      {track === "inference" && error ? (
        <Alert variant="error" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
          <SetupErrorBody error={error} />
        </Alert>
      ) : null}
      {track === "inference" && loadWarning && !error ? (
        <Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
          {loadWarning}
        </Alert>
      ) : null}

      {track === "access" ? (
        <StepAccess />
      ) : track === "credentials" ? (
        <AgentOnboardingWizard embedded />
      ) : track === "environment" ? (
        <StepEnvironment />
      ) : track === "review" ? (
        <CommissioningReview
          diagnostics={props.diagnostics}
          selectedModel={props.selectedModel}
          benchmarkResult={props.benchmarkResult}
          readiness={readinessState.readiness}
          loading={readinessState.loading}
          error={readinessState.error}
          onRefresh={readinessState.refresh}
          onComplete={props.completeSetup}
          onSelect={selectTrack}
        />
      ) : loading ? (
        <div className="flex items-center gap-3 py-10 text-(--ui-muted)">
          <Spinner size="lg" />
          <span className="text-[length:var(--fs-sm)]">Inspecting the active controller…</span>
        </div>
      ) : (
        <InferenceCommissioning {...props} />
      )}
    </SetupShell>
  );
}

function InferenceCommissioning(props: SetupViewProps) {
  const stageIndex = INFERENCE_STAGES.findIndex((surface) => surface.steps.includes(props.step));
  const stage = INFERENCE_STAGES[Math.max(0, stageIndex)];
  return (
    <div className="space-y-6">
      <nav
        aria-label="Inference commissioning stages"
        className="grid grid-cols-2 gap-px border border-(--ui-separator) bg-(--ui-separator) sm:grid-cols-3 xl:grid-cols-6"
      >
        {INFERENCE_STAGES.map((item, index) => (
          <button
            key={item.shortTitle}
            type="button"
            onClick={() => props.setStep(item.steps[0] ?? 0)}
            aria-current={index === stageIndex ? "step" : undefined}
            className={`min-h-12 bg-(--ui-surface) px-3 py-2 text-left ${
              index === stageIndex ? "text-(--ui-fg)" : "text-(--ui-muted)"
            }`}
          >
            <span className="block font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.12em]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="block text-[length:var(--fs-sm)]">{item.shortTitle}</span>
          </button>
        ))}
      </nav>
      <div className="border-b border-(--ui-separator) pb-4">
        <div className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.14em] text-(--ui-muted)">
          {stage?.eyebrow}
        </div>
        <h2 className="mt-1 text-[length:var(--fs-xl)] font-medium">{stage?.title}</h2>
        <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{stage?.sub}</p>
      </div>
      {props.step === 0 ? (
        <StepWelcome
          modelsDir={props.modelsDir}
          setModelsDir={props.setModelsDir}
          settings={props.settings}
          diagnostics={props.diagnostics}
          saveSettings={props.saveSettings}
          savingSettings={props.savingSettings}
        />
      ) : props.step === 1 ? (
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
      ) : props.step === 2 ? (
        <StepModel
          presets={props.presets}
          beginPresetSetup={props.beginPresetSetup}
          remoteApiKey={props.remoteApiKey}
          setRemoteApiKey={props.setRemoteApiKey}
          remoteSubscriptionKey={props.remoteSubscriptionKey}
          setRemoteSubscriptionKey={props.setRemoteSubscriptionKey}
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
          step={props.step}
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
    </div>
  );
}

function CommissioningReview({
  diagnostics,
  selectedModel,
  benchmarkResult,
  readiness,
  loading,
  error,
  onRefresh,
  onComplete,
  onSelect,
}: {
  diagnostics: StudioDiagnostics | null;
  selectedModel: string;
  benchmarkResult: SetupBenchmarkResult | null;
  readiness: CommissioningReadiness | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onComplete: () => void;
  onSelect: (track: SetupTrack) => void;
}) {
  const inference: CommissioningEvidence = {
    id: "inference",
    label: "Inference path",
    state: benchmarkResult ? "observed" : "claimed",
    detail: benchmarkResult
      ? `${benchmarkResult.generation_tps.toFixed(1)} tokens/s through the serving path`
      : diagnostics
        ? "Controller diagnostics loaded; end-to-end verification remains."
        : "Controller diagnostics have not been observed.",
    required: true,
  };
  const rows = [...(readiness?.evidence ?? []), inference];
  const canComplete = canCompleteCommissioning(readiness, Boolean(benchmarkResult));
  const trackFor = (entry: CommissioningEvidence): SetupTrack =>
    entry.id === "access"
      ? "access"
      : entry.id === "foundry"
        ? "access"
        : entry.id === "credentials" || entry.id === "controller-credential"
          ? "credentials"
          : entry.id === "inference"
            ? "inference"
            : "environment";
  return (
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !readiness ? (
        <div className="flex min-h-20 items-center gap-3 text-(--ui-muted)">
          <Spinner />
          <span>Inspecting commissioning evidence…</span>
        </div>
      ) : null}
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid gap-3 border border-(--ui-separator) bg-(--ui-surface) p-4 sm:grid-cols-[1fr_auto]"
        >
          <div>
            <h2 className="text-[length:var(--fs-md)] font-medium">{row.label}</h2>
            <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{row.detail}</p>
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            <ClaimMark state={row.state}>{row.required ? "required" : "optional"}</ClaimMark>
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => onSelect(trackFor(row))}
            >
              Open track
            </Button>
          </div>
        </div>
      ))}
      <Alert variant="info">
        Configuration is not equivalent to verification. A connection becomes observed only after
        its live probe succeeds; signed enrollment receipts remain separately attested.
      </Alert>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--ui-separator) pt-4">
        <Button variant="secondary" className="min-h-11" onClick={() => void onRefresh()}>
          Refresh evidence
        </Button>
        <div className="text-right">
          <Button className="min-h-11" disabled={!canComplete} onClick={onComplete}>
            Complete commissioning
          </Button>
          {!canComplete ? (
            <p className="mt-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
              Resolve required evidence and verify the inference path to complete setup.
            </p>
          ) : null}
        </div>
      </div>
    </div>
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
