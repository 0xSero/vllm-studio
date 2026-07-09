import type { Backend, RuntimeTarget, ServeRuntime, ServeRuntimeKind } from "@/lib/types";
import { ENGINE_LABEL } from "./engine-capabilities";

export interface ServeRuntimeOption {
  id: string;
  label: string;
  detail: string;
  runtime: ServeRuntime;
  installed: boolean;
  canInstall: boolean;
  version: string | null;
}

export const runtimeId = (runtime: ServeRuntime): string => `${runtime.kind}:${runtime.ref}`;

export const defaultRuntimeForBackend = (backend: Backend): ServeRuntime =>
  backend === "llamacpp"
    ? { kind: "binary", ref: "llama-server", label: "Managed llama.cpp" }
    : {
        kind: "managed_venv",
        ref: backend,
        label: `Managed ${ENGINE_LABEL[backend]}`,
      };

const managedTarget = (backend: Backend, target: RuntimeTarget): boolean =>
  target.kind === "venv" &&
  Boolean(target.pythonPath?.includes(`/runtime/venvs/${backend}-latest/`));

const targetReference = (target: RuntimeTarget): string | null => {
  if (target.kind === "docker") return target.dockerImage ?? null;
  if (target.kind === "binary") return target.binaryPath ?? null;
  return target.binaryPath ?? target.pythonPath ?? null;
};

const runtimeKindForTarget = (target: RuntimeTarget): ServeRuntimeKind => {
  if (target.kind === "docker") return "docker";
  if (target.kind === "binary") return "binary";
  return "system";
};

const optionFromTarget = (target: RuntimeTarget): ServeRuntimeOption | null => {
  const reference = targetReference(target);
  if (!reference || target.source === "bundled") return null;
  const runtime = {
    kind: runtimeKindForTarget(target),
    ref: reference,
    label: target.label,
  } satisfies ServeRuntime;
  return {
    id: runtimeId(runtime),
    label: target.label,
    detail: [target.kind, target.source, target.version].filter(Boolean).join(" · "),
    runtime,
    installed: target.installed,
    canInstall: false,
    version: target.version,
  };
};

export const runtimeOptionsFor = (
  backend: Backend,
  targets: RuntimeTarget[],
): ServeRuntimeOption[] => {
  const defaultRuntime = defaultRuntimeForBackend(backend);
  const managed = targets.find(
    (target) => target.backend === backend && managedTarget(backend, target),
  );
  const options: ServeRuntimeOption[] = [
    {
      id: runtimeId(defaultRuntime),
      label: defaultRuntime.label ?? `Managed ${ENGINE_LABEL[backend]}`,
      detail: managed?.version ? `managed venv · ${managed.version}` : "managed by Local Studio",
      runtime: defaultRuntime,
      installed: backend === "llamacpp" ? Boolean(managed) : Boolean(managed?.installed),
      canInstall: backend !== "llamacpp" && !managed?.installed,
      version: managed?.version ?? null,
    },
  ];
  const seen = new Set(options.map((option) => option.id));
  for (const target of targets) {
    if (target.backend !== backend || managedTarget(backend, target)) continue;
    const option = optionFromTarget(target);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
  }
  return options;
};

export const runtimeOptionFor = (
  runtime: ServeRuntime,
  options: ServeRuntimeOption[],
): ServeRuntimeOption =>
  options.find((option) => option.id === runtimeId(runtime)) ?? {
    id: runtimeId(runtime),
    label: runtime.label ?? runtime.ref,
    detail: `${runtime.kind} · custom`,
    runtime,
    installed: true,
    canInstall: false,
    version: null,
  };
