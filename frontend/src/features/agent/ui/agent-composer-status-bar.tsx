"use client";

import { formatTokenCount } from "@/features/agent/messages";
import type { GitSummary } from "@/features/agent/projects/types";
import { GitBranchIcon } from "@/ui/icons";

export function AgentComposerStatusBar({
  cwd,
  projectName,
  gitBranch,
  gitSummary,
  onInitGit,
  currentContextTokens,
  taskTokenTotal,
  contextWindow,
  onOpenDiff,
}: {
  cwd: string;
  projectName?: string | null;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  currentContextTokens: number;
  taskTokenTotal: number;
  contextWindow: number;
  onOpenDiff: () => void;
}) {
  const displayCwd = projectName || projectNameFromPath(cwd);

  return (
    <div className="relative z-20 mt-1.5 flex w-full items-center gap-2 overflow-visible font-mono text-[length:var(--fs-xs)] text-(--dim) sm:mt-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
        <div className="min-w-0 max-w-[42%] shrink overflow-visible">
          {displayCwd ? (
            <span className="block min-w-0 truncate text-(--dim)" title={cwd}>
              {displayCwd}
            </span>
          ) : null}
        </div>
        <GitBranchState gitBranch={gitBranch} gitSummary={gitSummary} onInitGit={onInitGit} />
        <GitSummaryState gitSummary={gitSummary} onOpenDiff={onOpenDiff} />
      </div>
      <span
        className="shrink-0 tabular-nums text-(--dim)"
        title={`${formatTokenCount(taskTokenTotal)} tokens used by this task and its subagents`}
      >
        {formatTokenCount(taskTokenTotal)} total
      </span>
      <ContextReadout current={currentContextTokens} contextWindow={contextWindow} />
    </div>
  );
}

function GitBranchState({
  gitBranch,
  gitSummary,
  onInitGit,
}: {
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
}) {
  if (gitBranch) {
    return (
      <span className="inline-flex min-w-0 shrink items-center gap-1 text-(--dim)">
        <GitBranchIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{gitBranch}</span>
      </span>
    );
  }

  if (gitSummary && !gitSummary.isRepo) {
    return (
      <button
        type="button"
        onClick={onInitGit}
        className="inline-flex shrink-0 items-center gap-1 text-(--dim) hover:text-(--fg)"
        title="Init git"
      >
        <GitBranchIcon className="h-3 w-3" />
        git
      </button>
    );
  }

  return null;
}

function GitSummaryState({
  gitSummary,
  onOpenDiff,
}: {
  gitSummary?: GitSummary | null;
  onOpenDiff: () => void;
}) {
  if (!gitSummary?.isRepo) return null;

  return (
    <button
      type="button"
      onClick={onOpenDiff}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-(--fg)/[0.05]"
      title="View changes"
    >
      <span className="text-(--ok)">+{gitSummary.additions}</span>
      <span className="text-(--err)">-{gitSummary.deletions}</span>
    </button>
  );
}

function ContextReadout({ current, contextWindow }: { current: number; contextWindow: number }) {
  const title = `Context ${formatTokenCount(current)} / ${formatTokenCount(contextWindow)}`;
  const ratio = contextWindow > 0 ? Math.min(1, Math.max(0, current / contextWindow)) : 0;
  const circumference = 2 * Math.PI * 6;

  return (
    <span
      className="ml-auto inline-flex shrink-0 items-center gap-1.5 px-1 text-(--dim)"
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={
            ratio > 0.9 ? "var(--ui-danger)" : ratio > 0.75 ? "var(--ui-warning)" : "var(--accent)"
          }
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="tabular-nums">
        {formatTokenCount(current)}/{formatTokenCount(contextWindow)}
      </span>
    </span>
  );
}

function projectNameFromPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
