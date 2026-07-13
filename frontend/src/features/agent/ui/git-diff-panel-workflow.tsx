"use client";

import { GitBranchIcon, ReloadIcon } from "@/ui/icons";
import { Input, Button } from "@/ui";
import type { GitAction, GitRef, GitState } from "@/features/agent/contracts";
import { gitDiffHeaderTitle } from "@/features/agent/ui/git-diff-panel-model";

export function GitPanelHeader({
  cwd,
  loading,
  payload,
  onReload,
}: {
  cwd: string | null;
  loading: boolean;
  payload: Partial<GitState> | null;
  onReload: () => Promise<void>;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border)/80 bg-(--color-header) px-3 text-xs">
      <GitBranchIcon className="h-3.5 w-3.5 text-(--dim)" />
      <span className="min-w-0 flex-1 truncate text-(--fg)" title={cwd ?? ""}>
        {gitDiffHeaderTitle(payload, cwd)}
      </span>
      <button
        type="button"
        onClick={() => void onReload()}
        disabled={loading || !cwd}
        className="rounded-md p-1 text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-40"
        title="Refresh git state"
      >
        <ReloadIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

export function GitWorkflowBar({
  payload,
  loading,
  draftBranch,
  commitMessage,
  onDraftBranch,
  onCommitMessage,
  onRun,
}: {
  payload: (Partial<GitState> & { error?: string }) | null;
  loading: boolean;
  draftBranch: string;
  commitMessage: string;
  onDraftBranch: (value: string) => void;
  onCommitMessage: (value: string) => void;
  onRun: (action: GitAction) => Promise<void>;
}) {
  if (!payload?.isRepo) return null;
  const dirty = (payload.status?.length ?? 0) > 0;
  return (
    <div className="grid gap-2 border-b border-(--border)/80 bg-(--color-panel) p-2 text-[length:var(--fs-sm)] text-(--dim)">
      <div className="flex flex-wrap items-center gap-2">
        <RefSelect
          refs={payload.refs ?? []}
          branch={payload.branch}
          loading={loading}
          onRun={onRun}
        />
        <Input
          value={draftBranch}
          onChange={(event) => onDraftBranch(event.target.value)}
          placeholder="new branch"
          className="h-7 min-w-0 flex-1 rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-(--fg) outline-none focus:border-(--border-hover)"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || !draftBranch.trim()}
          onClick={() => void onRun({ action: "createBranch", branch: draftBranch.trim() })}
        >
          Branch
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || !payload.branch}
          onClick={() => void onRun({ action: "push" })}
        >
          Push
        </Button>
        {payload.prUrl ? (
          <a
            className="h-7 rounded-md border border-(--border)/80 px-2 leading-7 text-(--fg) hover:bg-(--hover)"
            href={payload.prUrl}
            target="_blank"
          >
            PR
          </a>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={commitMessage}
          onChange={(event) => onCommitMessage(event.target.value)}
          placeholder={dirty ? "commit message" : "working tree clean"}
          disabled={!dirty}
          className="h-7 min-w-0 flex-1 rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-(--fg) outline-none disabled:opacity-45 focus:border-(--border-hover)"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || !dirty || !commitMessage.trim()}
          onClick={() => void onRun({ action: "commit", message: commitMessage.trim(), paths: [] })}
          title="Stage all current changes and commit"
        >
          Commit all
        </Button>
        <span className="font-mono">
          <span className="text-emerald-400">+{payload.additions ?? 0}</span>{" "}
          <span className="text-red-400">-{payload.deletions ?? 0}</span>{" "}
          {payload.status?.length ?? 0} files
        </span>
      </div>
    </div>
  );
}

function RefSelect({
  refs,
  branch,
  loading,
  onRun,
}: {
  refs: GitRef[];
  branch?: string | null;
  loading: boolean;
  onRun: (action: GitAction) => Promise<void>;
}) {
  return (
    <select
      value={branch ?? ""}
      disabled={loading || refs.length === 0}
      onChange={(event) =>
        event.currentTarget.value &&
        void onRun({ action: "checkout", ref: event.currentTarget.value })
      }
      className="h-7 min-w-[9rem] rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-(--fg)"
      title="Switch branch"
    >
      <option value="">{branch ?? "detached"}</option>
      {refs.map((ref) => (
        <option key={ref.name} value={ref.name}>
          {ref.remote ? "remote/" : ""}
          {ref.name}
        </option>
      ))}
    </select>
  );
}
