/**
 * The pi module: everything that touches `@earendil-works/*` lives under
 * `src/pi/`, and this file is its public surface. The rest of the runtime
 * consumes pi through here (or through the module's submodules) and never
 * imports a pi package directly — enforced by `test/pi-boundary.test.ts`.
 */
export { piRuntimeManager, piResourceDiagnostics } from "./runtime";
export type {
  AgentSessionEvent,
  LoggedPiEvent,
  PiAgentSession,
  PiAgentStatus,
  PiContextUsage,
  PiPromptOptions,
  RuntimeStartOptions,
} from "./types";
export type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type {
  SessionSnapshot,
  TranscriptItem,
  TranscriptProgress,
} from "@earendil-works/pi-protocol";
export { projectSnapshot, projectTranscript, TranscriptProjector } from "./projection";
export { canonicalSessionSnapshot, loadSessionSnapshot } from "./sessions";

/** Capability probe for setup checks: is the bundled pi SDK loadable? */
import { createAgentSessionRuntime } from "@earendil-works/pi-coding-agent";
export const PI_SDK_PACKAGE = "@earendil-works/pi-coding-agent";
export const piSdkAvailable = (): boolean => typeof createAgentSessionRuntime === "function";
