"use client";

import { useCallback, useState } from "react";
import {
  GitPullRequest,
  ReloadIcon,
  ExternalLink,
  CheckCircle2,
  CircleAlert,
  Clock,
} from "@/ui/icon-registry";
import { Button } from "@/ui";
import { MarkdownContent } from "@/ui/markdown-content";
import { safeJson } from "@/features/agent/safe-json";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

// Shape mirrors services/agent-runtime/src/http/pr-handlers.ts normalizers.
type CheckBucket = "pending" | "passing" | "failing";

type PrCheck = {
  name: string;
  status: string;
  conclusion: string | null;
  bucket: CheckBucket;
};

type ChecksSummary = { pending: number; passing: number; failing: number; total: number };

type PullRequest = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  reviewers: string[];
  commentsCount: number;
  body: string;
  mergeable: string;
  checks: PrCheck[];
  checksSummary: ChecksSummary;
};

type PrListItem = {
  number: number;
  title: string;
  headRefName: string;
  updatedAt: string;
  isDraft: boolean;
};

type PrPayload = { pr?: PullRequest; prs?: PrListItem[]; error?: string };

type MergeMethod = "merge" | "squash" | "rebase";

async function loadPr(cwd: string): Promise<PrPayload> {
  const response = await fetch(`/api/agent/pr?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<PrPayload>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load pull request");
  return payload;
}

async function mergePr(cwd: string, number: number, method: MergeMethod): Promise<void> {
  const response = await fetch("/api/agent/pr/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, number, method }),
  });
  const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
  if (!response.ok || payload.error) throw new Error(payload.error || "Merge failed");
}

export function PrPanel({ cwd }: { cwd: string | null }) {
  const [payload, setPayload] = useState<PrPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) return setPayload(null);
    setLoading(true);
    setMergeError(null);
    try {
      setPayload(await loadPr(cwd));
    } catch (error) {
      setPayload({ error: error instanceof Error ? error.message : "Failed to load pull request" });
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  const merge = useCallback(
    async (method: MergeMethod) => {
      if (!cwd || !payload?.pr) return;
      setMerging(true);
      setMergeError(null);
      try {
        await mergePr(cwd, payload.pr.number, method);
        await load();
      } catch (error) {
        setMergeError(error instanceof Error ? error.message : "Merge failed");
      } finally {
        setMerging(false);
      }
    },
    [cwd, payload?.pr, load],
  );

  useMountSubscription(() => {
    void load();
  }, [load]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--color-panel)">
      <PrPanelHeader cwd={cwd} loading={loading} onReload={load} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PrPanelBody
          cwd={cwd}
          payload={payload}
          loading={loading}
          merging={merging}
          mergeError={mergeError}
          onMerge={merge}
        />
      </div>
    </section>
  );
}

function PrPanelHeader({
  cwd,
  loading,
  onReload,
}: {
  cwd: string | null;
  loading: boolean;
  onReload: () => Promise<void>;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border)/80 bg-(--color-header) px-3 text-xs">
      <GitPullRequest className="h-3.5 w-3.5 text-(--dim)" />
      <span className="min-w-0 flex-1 truncate text-(--fg)">Pull request</span>
      <button
        type="button"
        onClick={() => void onReload()}
        disabled={loading || !cwd}
        className="rounded-md p-1 text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-40"
        title="Refresh pull request"
        aria-label="Refresh pull request"
      >
        <ReloadIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

function PrPanelBody({
  cwd,
  payload,
  loading,
  merging,
  mergeError,
  onMerge,
}: {
  cwd: string | null;
  payload: PrPayload | null;
  loading: boolean;
  merging: boolean;
  mergeError: string | null;
  onMerge: (method: MergeMethod) => Promise<void>;
}) {
  if (!cwd) {
    return <PrNotice>Choose a project directory to view its pull request.</PrNotice>;
  }
  if (!payload) {
    return <PrNotice>{loading ? "Loading pull request…" : "No pull request loaded."}</PrNotice>;
  }
  if (payload.error) {
    return <PrNotice>{payload.error}</PrNotice>;
  }
  if (payload.pr) {
    return (
      <PrDetail pr={payload.pr} merging={merging} mergeError={mergeError} onMerge={onMerge} />
    );
  }
  return <PrPicker prs={payload.prs ?? []} />;
}

function PrNotice({ children }: { children: React.ReactNode }) {
  return <div className="p-4 text-[length:var(--fs-sm)] text-(--dim)">{children}</div>;
}

function PrDetail({
  pr,
  merging,
  mergeError,
  onMerge,
}: {
  pr: PullRequest;
  merging: boolean;
  mergeError: string | null;
  onMerge: (method: MergeMethod) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[length:var(--fs-lg)] font-semibold text-(--fg)">
          {pr.title}
          <span className="ml-1.5 font-normal text-(--dim)">#{pr.number}</span>
        </h2>
      </div>
      <PrMetadata pr={pr} />
      <PrActions pr={pr} merging={merging} onMerge={onMerge} />
      {mergeError ? (
        <p className="text-[length:var(--fs-sm)] text-(--color-diff-removed)">{mergeError}</p>
      ) : null}
      <PrDescription body={pr.body} />
    </div>
  );
}

function PrMetadata({ pr }: { pr: PullRequest }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[length:var(--fs-sm)]">
      <MetaRow label="Branch">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <code className="rounded bg-(--color-input) px-1 py-0.5 text-(--fg)">
            {pr.headRefName || "—"}
          </code>
          <span className="text-(--dim)">→</span>
          <code className="rounded bg-(--color-input) px-1 py-0.5 text-(--fg)">
            {pr.baseRefName || "—"}
          </code>
          <span className="text-(--color-diff-added)">+{pr.additions}</span>
          <span className="text-(--color-diff-removed)">−{pr.deletions}</span>
        </span>
      </MetaRow>
      <MetaRow label="Reviewers">
        {pr.reviewers.length ? (
          <span className="text-(--fg)">{pr.reviewers.join(", ")}</span>
        ) : (
          <span className="text-(--dim)">Request review</span>
        )}
      </MetaRow>
      <MetaRow label="Comments">
        <span className="text-(--fg)">
          {pr.commentsCount} {pr.commentsCount === 1 ? "comment" : "comments"}
        </span>
      </MetaRow>
      <MetaRow label="Checks">
        <ChecksValue summary={pr.checksSummary} />
      </MetaRow>
      <MetaRow label="Status">
        <span className="text-(--fg)">{prStatusLabel(pr)}</span>
      </MetaRow>
    </dl>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-(--dim)">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function ChecksValue({ summary }: { summary: ChecksSummary }) {
  if (summary.total === 0) return <span className="text-(--dim)">No checks</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      {summary.passing > 0 ? (
        <span className="inline-flex items-center gap-1 text-(--color-diff-added)">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {summary.passing} passing
        </span>
      ) : null}
      {summary.failing > 0 ? (
        <span className="inline-flex items-center gap-1 text-(--color-diff-removed)">
          <CircleAlert className="h-3.5 w-3.5" />
          {summary.failing} failing
        </span>
      ) : null}
      {summary.pending > 0 ? (
        <span className="inline-flex items-center gap-1 text-(--dim)">
          <Clock className="h-3.5 w-3.5" />
          {summary.pending} pending
        </span>
      ) : null}
    </span>
  );
}

function prStatusLabel(pr: PullRequest): string {
  if (pr.state !== "OPEN") {
    return pr.state.charAt(0) + pr.state.slice(1).toLowerCase();
  }
  return pr.isDraft ? "Draft" : "Ready for review";
}

function PrActions({
  pr,
  merging,
  onMerge,
}: {
  pr: PullRequest;
  merging: boolean;
  onMerge: (method: MergeMethod) => Promise<void>;
}) {
  const [method, setMethod] = useState<MergeMethod>("merge");
  const mergeDisabled = merging || pr.state !== "OPEN" || pr.mergeable === "CONFLICTING";
  return (
    <div className="flex flex-col gap-2">
      <a
        href={pr.url || "#"}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-(--color-primary) text-[length:var(--fs-sm)] font-medium text-(--color-primary-foreground) transition-opacity hover:opacity-90"
      >
        <ExternalLink className="h-4 w-4" />
        Open on GitHub
      </a>
      <div className="flex items-stretch gap-2">
        <Button
          variant="secondary"
          size="md"
          className="flex-1 rounded-md"
          disabled={mergeDisabled}
          loading={merging}
          onClick={() => void onMerge(method)}
        >
          Merge pull request
        </Button>
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value as MergeMethod)}
          disabled={mergeDisabled}
          aria-label="Merge method"
          className="h-8 rounded-md border border-(--border) bg-(--color-input) px-2 text-[length:var(--fs-sm)] text-(--fg) transition-colors focus:outline-none focus:ring-1 focus:ring-(--ring) disabled:opacity-50"
        >
          <option value="merge">Merge</option>
          <option value="squash">Squash</option>
          <option value="rebase">Rebase</option>
        </select>
      </div>
      {pr.mergeable === "CONFLICTING" ? (
        <p className="text-[length:var(--fs-sm)] text-(--dim)">
          This branch has conflicts that must be resolved.
        </p>
      ) : null}
    </div>
  );
}

function PrDescription({ body }: { body: string }) {
  const trimmed = body.trim();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[length:var(--fs-sm)] font-semibold text-(--dim)">
        Description
      </h3>
      {trimmed ? (
        <MarkdownContent markdown={trimmed} className="text-[length:var(--fs-sm)]" />
      ) : (
        <p className="text-[length:var(--fs-sm)] text-(--dim)">No description provided.</p>
      )}
    </div>
  );
}

function PrPicker({ prs }: { prs: PrListItem[] }) {
  if (prs.length === 0) {
    return <PrNotice>No pull request for this branch, and no open pull requests found.</PrNotice>;
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[length:var(--fs-sm)] text-(--dim)">
        No pull request for the current branch. Open pull requests:
      </p>
      <ul className="flex flex-col gap-1">
        {prs.map((pr) => (
          <li
            key={pr.number}
            className="flex flex-col gap-0.5 rounded-md border border-(--border)/70 px-3 py-2"
          >
            <span className="flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--fg)">
              <span className="text-(--dim)">#{pr.number}</span>
              <span className="min-w-0 flex-1 truncate">{pr.title}</span>
              {pr.isDraft ? (
                <span className="shrink-0 rounded bg-(--color-input) px-1.5 py-0.5 text-[length:var(--fs-2xs)] text-(--dim)">
                  Draft
                </span>
              ) : null}
            </span>
            <code className="truncate text-[length:var(--fs-xs)] text-(--dim)">
              {pr.headRefName}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
