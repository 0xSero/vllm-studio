// Global, client-only preference for whether model reasoning ("Thinking"/
// "Thought") is shown in the timeline. Stored in localStorage so it survives
// reloads without touching the (separately-owned) settings service. Default is
// visible — reasoning streams unless the user explicitly hides it.
const REASONING_VISIBLE_KEY = "local-studio.agent.reasoningVisible";

/** Synchronous localStorage read — safe to call during render. Defaults to
 *  `true` when unset, off the server, or if storage is unavailable. */
export function loadReasoningVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Only the explicit "0" sentinel hides reasoning; anything else stays on.
    return window.localStorage.getItem(REASONING_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}
