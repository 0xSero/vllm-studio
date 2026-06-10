export function isAgentEndEvent(event: { type?: unknown } | null | undefined): boolean {
  return event?.type === "agent_end";
}
