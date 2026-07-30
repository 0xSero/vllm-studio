"use client";

import type { NotebookDocument } from "@local-studio/contracts/notebook-agent";
import type { ScientificNotebookSession } from "@local-studio/contracts/scientific-workbench";
import { AgentCard } from "@/ui/ai";
import { FlaskConical, Terminal } from "@/ui/icon-registry";
import { Claim } from "./science-workbench-components";

export type NotebookOption = {
  path: string;
  label: string;
  runtime: string;
  icon: typeof FlaskConical;
};

export const DEFAULT_NOTEBOOK_OPTIONS: NotebookOption[] = [
  {
    path: "agent-collaboration.ipynb",
    label: "Python · Jupyter",
    runtime: "Jupyter",
    icon: FlaskConical,
  },
  {
    path: "agent-collaboration-python-smolvm.ipynb",
    label: "Python · SmolVM",
    runtime: "SmolVM",
    icon: FlaskConical,
  },
  {
    path: "agent-collaboration-node.ipynb",
    label: "Node.js · SmolVM",
    runtime: "SmolVM",
    icon: Terminal,
  },
];

export const buildNotebookOptions = (sessions: ScientificNotebookSession[]): NotebookOption[] => {
  const sessionOptions = sessions
    .filter((session): session is ScientificNotebookSession & { document_path: string } =>
      Boolean(session.document_path),
    )
    .map((session) => ({
      path: session.document_path,
      label: session.document_path.replace(/\.ipynb$/u, ""),
      runtime: session.runtime?.endsWith("-smolvm") ? "SmolVM" : "Jupyter",
      icon: session.runtime === "node-smolvm" ? Terminal : FlaskConical,
    }));
  return [...DEFAULT_NOTEBOOK_OPTIONS, ...sessionOptions].filter(
    (option, index, values) => values.findIndex(({ path }) => path === option.path) === index,
  );
};

export function NotebookRuntimeSelector({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<NotebookOption>;
  onChange: (path: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Notebook runtime"
      className="mb-4 flex flex-wrap border border-(--ui-border) bg-(--ui-subtle)"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.path}
            type="button"
            aria-pressed={option.path === value}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 border-r border-(--ui-border) px-3 text-[12px] font-medium sm:flex-none ${
              option.path === value
                ? "bg-(--ui-surface) text-(--ui-fg)"
                : "text-(--ui-muted) hover:text-(--ui-fg)"
            }`}
            onClick={() => onChange(option.path)}
          >
            <Icon className="h-4 w-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function NotebookEvidence({
  notebook,
  error,
  activity,
  runtime,
  busy,
}: {
  notebook: NotebookDocument | null;
  error: string | null;
  activity: string;
  runtime: string;
  busy: boolean;
}) {
  const state = busy ? "running" : error ? "failed" : notebook ? "completed" : "pending";
  return (
    <aside
      aria-label="Agent notebook evidence"
      className="border-t border-(--ui-border) bg-(--ui-subtle)/35 p-4 forced-colors:bg-[Canvas] lg:border-t-0 lg:border-l"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--ui-muted)">
        Interaction evidence
      </div>
      <div className="mt-4 space-y-3 text-[12px]">
        <Claim state={error ? "contradicted" : notebook ? "observed" : "claimed"}>{activity}</Claim>
        <AgentCard
          name="Notebook agent"
          role="Revision-bound controller collaborator"
          status={state}
          className="p-3 text-[12px]"
        />
        <dl
          aria-label="Observable notebook controller activity"
          className="grid gap-2 border-t border-(--ui-border) pt-3"
        >
          <div>
            <dt className="text-(--ui-muted)">Mutation authority</dt>
            <dd>Controller-issued, revision-bound approval</dd>
          </div>
          <div>
            <dt className="text-(--ui-muted)">Execution boundary</dt>
            <dd>
              {notebook?.runtime === "node" || notebook?.runtime === "python"
                ? "Ephemeral SmolVM · network denied"
                : "Jupyter kernel · 60 s limit"}
            </dd>
          </div>
          <div>
            <dt className="text-(--ui-muted)">Runtime identity</dt>
            <dd className="font-mono">{notebook ? notebook.kernel_name : runtime}</dd>
          </div>
        </dl>
        {error ? (
          <p role="alert" className="border-t border-(--ui-border) pt-3 text-(--ui-fg)">
            {error}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
