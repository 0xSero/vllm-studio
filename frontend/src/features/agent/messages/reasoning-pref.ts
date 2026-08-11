import { REASONING_VISIBILITY_CHANGED_EVENT } from "@/lib/workspace-events";
import { readStored, writeStored } from "@/lib/storage";

// Global, client-only preference for whether model reasoning ("Thinking"/
// "Thought") is shown in the timeline. Stored in localStorage so it survives
// reloads without touching the (separately-owned) settings service. Default is
// visible — reasoning streams unless the user explicitly hides it.
const REASONING_VISIBLE_KEY = "local-studio.agent.reasoningVisible";

/** Synchronous localStorage read — safe to call during render. Defaults to
 *  `true` when unset, off the server, or if storage is unavailable. */
export function loadReasoningVisible(): boolean {
  return readStored(REASONING_VISIBLE_KEY) !== "0";
}

/** Persist the preference and notify open panes so they re-render at once. */
export function setReasoningVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  writeStored(REASONING_VISIBLE_KEY, visible ? "1" : "0");
  window.dispatchEvent(new Event(REASONING_VISIBILITY_CHANGED_EVENT));
}
