import type { Backend, RuntimeTarget, ServeRuntime } from "@/lib/types";

const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  exllamav3: "exllamav3",
  llamacpp: "llama.cpp",
};

export const runtimeId = (runtime: ServeRuntime): string => `${runtime.kind}:${runtime.ref}`;

/** Engines run in containers; a bare engine-name ref means "the engine's pinned image".
 *  llama.cpp is the exception: it runs natively via `llama-server` on PATH. */
export const defaultRuntimeForBackend = (backend: Backend): ServeRuntime =>
  backend === "llamacpp"
    ? { kind: "binary", ref: "llama-server", label: "llama.cpp (native)" }
    : { kind: "docker", ref: backend, label: `${ENGINE_LABEL[backend]} (Docker)` };

export const isManagedServeRuntimeTarget = (backend: Backend, target: RuntimeTarget): boolean =>
  target.backend === backend && target.kind === "docker";
