/**
 * The frontend's pi module (docs/agent-state-plan.md, Stage A): pi's own
 * transcript model — snapshot + progress reducer, wire guards, and the one
 * adapter into the timeline's ChatMessage shape. Everything that consumes the
 * new `{type:"snapshot"|"progress"}` runtime frames goes through here.
 */
export type {
  SessionSnapshot,
  TranscriptItem,
  TranscriptProgress,
} from "@earendil-works/pi-protocol";
export {
  applyTranscriptProgress,
  createTranscriptState,
  selectTranscript,
  type TranscriptState,
} from "./transcript";
export {
  finalizeRunningToolBlocks,
  isProjectedMessageId,
  mergeProjectedMessages,
  transcriptToMessages,
  type AdapterCache,
} from "./adapter";
export { asSessionSnapshot, asTranscriptProgress } from "./wire";
