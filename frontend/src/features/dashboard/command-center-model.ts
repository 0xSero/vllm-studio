import type { GPU, ProcessInfo, RecipeWithStatus } from "@/lib/types";
import type { RuntimeSummaryData, ServiceEntry } from "@/hooks/realtime-status-types";

export type CommandCenterPhaseState = "complete" | "active" | "pending" | "blocked";

export interface CommandCenterPhase {
  id: "hardware" | "model" | "runtime" | "serve" | "work";
  label: string;
  detail: string;
  state: CommandCenterPhaseState;
}

export interface CommandCenterView {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
  tone: "good" | "info" | "warning";
  statusLabel: string;
  phases: CommandCenterPhase[];
  facts: Array<{ label: string; value: string }>;
}

interface CommandCenterInput {
  connected: boolean;
  currentProcess: ProcessInfo | null;
  gpus: GPU[];
  recipes: RecipeWithStatus[];
  runtimeSummary?: RuntimeSummaryData | null;
  services?: ServiceEntry[];
}

const healthyService = (service: ServiceEntry): boolean =>
  ["healthy", "online", "ready", "running"].includes(service.status.toLowerCase());

const installedRuntimeCount = (summary?: RuntimeSummaryData | null): number =>
  summary
    ? [
        summary.backends.vllm,
        summary.backends.sglang,
        summary.backends.llamacpp,
        summary.backends.mlx,
      ].filter((backend) => backend?.installed).length
    : 0;

const displayModel = (process: ProcessInfo): string =>
  process.served_model_name?.trim() ||
  process.model_path?.split("/").filter(Boolean).at(-1) ||
  "Model";

const phaseState = (
  complete: boolean,
  active: boolean,
  connected: boolean,
): CommandCenterPhaseState => {
  if (complete) return "complete";
  if (active) return "active";
  return connected ? "pending" : "blocked";
};

const facts = (
  gpuCount: number,
  runtimeCount: number,
  healthyServices: number,
  serviceCount: number,
  serveCount: number,
): Array<{ label: string; value: string }> => [
  { label: "Accelerators", value: String(gpuCount) },
  { label: "Runtimes", value: String(runtimeCount) },
  { label: "Serves", value: String(serveCount) },
  { label: "Services", value: serviceCount ? `${healthyServices}/${serviceCount}` : "0" },
];

export function commandCenterView(input: CommandCenterInput): CommandCenterView {
  const services = input.services ?? [];
  const runtimes = installedRuntimeCount(input.runtimeSummary);
  const modelReady = input.recipes.length > 0 || Boolean(input.currentProcess);
  const runtimeReady = runtimes > 0 || Boolean(input.currentProcess);
  const serving = Boolean(input.currentProcess);
  const healthyServices = services.filter(healthyService).length;
  const phaseFacts = facts(
    input.gpus.length,
    runtimes,
    healthyServices,
    services.length,
    input.recipes.length,
  );
  const phases: CommandCenterPhase[] = [
    {
      id: "hardware",
      label: "Hardware",
      detail: input.connected
        ? `${input.gpus.length} accelerator${input.gpus.length === 1 ? "" : "s"}`
        : "Controller offline",
      state: phaseState(input.connected, false, input.connected),
    },
    {
      id: "model",
      label: "Model",
      detail: modelReady
        ? `${input.recipes.length} Serve${input.recipes.length === 1 ? "" : "s"}`
        : "Choose weights",
      state: phaseState(modelReady, input.connected, input.connected),
    },
    {
      id: "runtime",
      label: "Runtime",
      detail: runtimeReady ? `${runtimes || 1} ready` : "Install an engine",
      state: phaseState(runtimeReady, modelReady, input.connected),
    },
    {
      id: "serve",
      label: "Serve",
      detail: serving ? `${input.currentProcess?.backend ?? "engine"} live` : "Launch locally",
      state: phaseState(serving, modelReady && runtimeReady, input.connected),
    },
    {
      id: "work",
      label: "Work",
      detail: serving ? "Agent and API ready" : "Waiting for a Serve",
      state: phaseState(false, serving, input.connected),
    },
  ];

  if (!input.connected) {
    return {
      eyebrow: "Command center",
      title: "Bring your controller online",
      description: "Reconnect the machine that owns your models, runtimes, and GPU state.",
      actionLabel: "Connect controller",
      actionHref: "/settings#connection",
      tone: "warning",
      statusLabel: "offline",
      phases,
      facts: phaseFacts,
    };
  }

  if (!modelReady) {
    return {
      eyebrow: "Command center",
      title: "Build your first local AI stack",
      description:
        "Start with model weights. Local Studio will carry the same selection through runtime, configuration, launch, and verification.",
      actionLabel: "Explore models",
      actionHref: "/recipes",
      tone: "info",
      statusLabel: "ready to build",
      phases,
      facts: phaseFacts,
    };
  }

  if (!runtimeReady) {
    return {
      eyebrow: "Command center",
      title: "Finish the runtime layer",
      description: "Your model is known. Install or choose the engine that will own its launch.",
      actionLabel: "Install runtime",
      actionHref: "/settings#system",
      tone: "warning",
      statusLabel: "runtime needed",
      phases,
      facts: phaseFacts,
    };
  }

  if (!input.currentProcess) {
    return {
      eyebrow: "Command center",
      title: "Choose a Serve and go",
      description:
        "Weights and runtime are ready. Launch a saved Serve to open the API and workstation.",
      actionLabel: "Launch a Serve",
      actionHref: "/recipes?tab=serves",
      tone: "info",
      statusLabel: "standby",
      phases,
      facts: phaseFacts,
    };
  }

  return {
    eyebrow: "Command center",
    title: `${displayModel(input.currentProcess)} is serving`,
    description: `The ${input.currentProcess.backend} runtime is live on port ${input.currentProcess.port}. Open the workbench or keep an eye on the rig below.`,
    actionLabel: "Open workbench",
    actionHref: "/agent",
    tone: "good",
    statusLabel: "operational",
    phases,
    facts: phaseFacts,
  };
}
