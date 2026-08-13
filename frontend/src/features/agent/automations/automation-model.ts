import type {
  Automation,
  AutomationRun,
  AutomationSchedule,
  AutomationTarget,
} from "@shared/agent/automation";

export type AutomationFilter = "all" | "active" | "paused";

export type AutomationDraft = {
  name: string;
  prompt: string;
  modelId: string;
  cwd: string;
  schedule: AutomationSchedule;
  target?: AutomationTarget;
};

export type AutomationSuggestion = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: AutomationSchedule;
};

export const NEW_AUTOMATION_DRAFT: AutomationDraft = {
  name: "",
  prompt: "",
  modelId: "",
  cwd: "",
  schedule: { kind: "daily", time: "08:00" },
};

export const AUTOMATION_SUGGESTIONS: readonly AutomationSuggestion[] = [
  {
    id: "daily-brief",
    name: "Daily brief",
    description: "Start each weekday with your priorities, blockers, and next actions",
    prompt: "Review my recent work and summarize priorities, blockers, and next actions.",
    schedule: { kind: "daily", time: "08:00", weekdaysOnly: true },
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    description: "Turn your recent work into a concise status update every Friday",
    prompt: "Review what I worked on this week and draft a concise status update.",
    schedule: { kind: "weekly", day: 5, time: "16:00" },
  },
  {
    id: "follow-up-monitor",
    name: "Follow-up monitor",
    description: "Check recent activity hourly and flag anything that needs attention",
    prompt: "Review recent activity and flag anything that needs my attention.",
    schedule: { kind: "interval", minutes: 60 },
  },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function draftFromAutomation(automation: Automation): AutomationDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    modelId: automation.modelId,
    cwd: automation.cwd,
    schedule: automation.schedule,
    ...(automation.target ? { target: automation.target } : {}),
  };
}

export function draftFromSuggestion(
  draft: AutomationDraft,
  suggestion: AutomationSuggestion,
): AutomationDraft {
  return {
    ...draft,
    name: suggestion.name,
    prompt: suggestion.prompt,
    schedule: suggestion.schedule,
  };
}

export function scheduleLabel(schedule: AutomationSchedule): string {
  if (schedule.kind === "interval") {
    if (schedule.minutes === 60) return "Every hour";
    if (schedule.minutes > 60 && schedule.minutes % 60 === 0) {
      return `Every ${schedule.minutes / 60} hours`;
    }
    return `Every ${schedule.minutes} minutes`;
  }
  if (schedule.kind === "daily") {
    return `${schedule.weekdaysOnly ? "Weekdays" : "Daily"} at ${schedule.time}`;
  }
  return `${WEEKDAYS[schedule.day] ?? "Monday"} at ${schedule.time}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const delta = timestamp - Date.now();
  const absolute = Math.abs(delta);
  const suffix = delta >= 0 ? "from now" : "ago";
  if (absolute < 60_000) return delta >= 0 ? "in less than a minute" : "less than a minute ago";
  if (absolute < 3_600_000) return `${Math.round(absolute / 60_000)}m ${suffix}`;
  if (absolute < 86_400_000) return `${Math.round(absolute / 3_600_000)}h ${suffix}`;
  return `${Math.round(absolute / 86_400_000)}d ${suffix}`;
}

export function shortRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const delta = timestamp - Date.now();
  const absolute = Math.abs(delta);
  if (absolute < 60_000) return "now";
  const value =
    absolute < 3_600_000
      ? `${Math.round(absolute / 60_000)}m`
      : absolute < 86_400_000
        ? `${Math.round(absolute / 3_600_000)}h`
        : `${Math.round(absolute / 86_400_000)}d`;
  return delta >= 0 ? `in ${value}` : `${value} ago`;
}

export function absoluteTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Unknown time";
}

export function automationTarget(automation: Automation): AutomationTarget {
  return automation.target ?? { kind: "global" };
}

export function threadIdOf(automation: Automation): string | null {
  const target = automationTarget(automation);
  return target.kind === "thread" ? target.threadId : null;
}

export function threadAutomations(
  automations: readonly Automation[],
  threadId: string | null,
): Automation[] {
  if (!threadId) return [];
  return automations.filter((automation) => threadIdOf(automation) === threadId);
}

export function folderLabel(cwd: string): string {
  const trimmed = cwd.trim().replace(/\/+$/, "");
  if (!trimmed) return "Default folder";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

export function targetTypeLabel(automation: Automation): string {
  return threadIdOf(automation) ? "Scheduled chat" : "Scheduled task";
}

export function sourceLabel(automation: Automation): string {
  return threadIdOf(automation) ? "In this chat" : folderLabel(automation.cwd);
}

export function statusLabel(automation: Automation): string {
  return automation.status === "paused" ? "Paused" : "Active";
}

export function nextRunLabel(automation: Automation): string {
  if (automation.status === "paused") return "Paused";
  if (!automation.nextRunAt) return "Not scheduled";
  return `Next run ${shortRelativeTime(automation.nextRunAt)}`;
}

export function runOutcomeLabel(run: AutomationRun): string {
  return run.outcome === "error" ? "Failed" : "Completed";
}

export function runProvenance(run: AutomationRun): string | null {
  const requested = run.requestedModelId;
  const actual = run.actualModelId;
  if (!requested) return null;
  if (!actual) return `Requested ${requested}`;
  if (actual === requested) return `Ran on ${actual}`;
  return run.fallbackReason === "requested_model_inactive"
    ? `Ran on ${actual} because ${requested} was not loaded`
    : `Ran on ${actual} instead of ${requested}`;
}

export function runTranscriptHref(run: AutomationRun): string | null {
  if (!run.piSessionId) return null;
  const project = run.projectId ? `project=${encodeURIComponent(run.projectId)}&` : "";
  return `/agent?${project}session=${encodeURIComponent(run.piSessionId)}&replace=1`;
}

export function unreadAutomations(automations: readonly Automation[]): Automation[] {
  return automations.filter((automation) => automation.unread);
}

export function filterAutomations(
  automations: readonly Automation[],
  query: string,
  filter: AutomationFilter,
): Automation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return automations.filter((automation) => {
    if (filter !== "all" && automation.status !== filter) return false;
    if (!normalizedQuery) return true;
    return [
      automation.name,
      automation.prompt,
      automation.modelId,
      automation.cwd,
      scheduleLabel(automation.schedule),
      sourceLabel(automation),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

export function draftIsValid(draft: AutomationDraft): boolean {
  return Boolean(draft.name.trim() && draft.prompt.trim() && draft.modelId.trim());
}
