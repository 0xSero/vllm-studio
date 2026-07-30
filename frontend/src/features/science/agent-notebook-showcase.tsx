"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { NotebookDocument } from "@local-studio/contracts/notebook-agent";
import type { ScientificNotebookSession } from "@local-studio/contracts/scientific-workbench";
import api from "@/lib/api/client";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "@/ui/icon-registry";
import { Textarea } from "@/ui/textarea";
import { Claim } from "./science-workbench-components";
import {
  buildNotebookOptions,
  DEFAULT_NOTEBOOK_OPTIONS,
  NotebookEvidence,
  NotebookRuntimeSelector,
} from "./notebook-panel-support";

const shortRevision = (value: string) =>
  value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value;

const initialNotebookPath = (
  selectedPath: string | null,
  sessions: ScientificNotebookSession[],
): string =>
  selectedPath ??
  sessions.find(({ document_path }) => document_path)?.document_path ??
  DEFAULT_NOTEBOOK_OPTIONS[0].path;

const notebookPlaceholder = (busy: boolean, error: string | null, hasSession: boolean) => {
  if (busy) {
    return {
      title: "Loading notebook",
      detail: "The controller is inspecting the selected revision.",
    };
  }
  if (error) {
    return {
      title: "Notebook unavailable",
      detail: hasSession
        ? "Inspect the controller session again after resolving the reported error."
        : "Create or select a controller notebook session to begin editing.",
    };
  }
  return {
    title: "No notebook loaded",
    detail: hasSession
      ? "Inspect the controller session to begin editing."
      : "Create or select a controller notebook session to begin editing.",
  };
};

export function AgentNotebookShowcase({
  sessions = [],
  selectedPath = null,
}: {
  sessions?: ScientificNotebookSession[];
  selectedPath?: string | null;
}) {
  const [notebook, setNotebook] = useState<NotebookDocument | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [activity, setActivity] = useState("Waiting for notebook inspection");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const orbRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const expandedRef = useRef(false);
  const unsavedRef = useRef(false);
  const initialPath = initialNotebookPath(selectedPath, sessions);
  const [demoPath, setDemoPath] = useState<string>(initialPath);
  const options = useMemo(() => buildNotebookOptions(sessions), [sessions]);
  const hasUnsavedChanges =
    notebook?.cells.some((cell) => (drafts[cell.index] ?? cell.source) !== cell.source) ?? false;
  const currentSession = sessions.find(({ document_path }) => document_path === demoPath);
  const placeholder = notebookPlaceholder(busy, error, Boolean(currentSession));
  const bindPanel = useCallback((element: HTMLElement | null) => {
    panelRef.current = element;
    element?.focus();
  }, []);
  expandedRef.current = expanded;
  unsavedRef.current = hasUnsavedChanges;

  useMountSubscription(() => {
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (unsavedRef.current) event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !expandedRef.current) return;
      if (unsavedRef.current && !window.confirm("Discard unsaved notebook cell changes?")) return;
      setExpanded(false);
      orbRef.current?.focus();
    };
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const perform = async (
    label: string,
    operation: () => Promise<{ notebook: NotebookDocument }>,
  ) => {
    setBusy(true);
    setError(null);
    setActivity(label);
    try {
      const payload = await operation();
      setNotebook(payload.notebook);
      setDrafts(
        Object.fromEntries(payload.notebook.cells.map((cell) => [cell.index, cell.source])),
      );
      setActivity(`${label} completed`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setActivity(`${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const inspectPath = (path: string) => {
    const session = sessions.find(({ document_path }) => document_path === path);
    if (!session) {
      setError("A controller notebook session is required before inspection");
      setActivity("Notebook unavailable");
      return Promise.resolve();
    }
    return perform("Notebook loaded", () => api.inspectNotebookDocument(session.id));
  };

  const inspect = () => inspectPath(demoPath);

  const approvalFor = async (
    operation: "patch" | "execute" | "structure",
    cellIndex: number,
    revision: string,
  ) => {
    if (!currentSession) return null;
    try {
      const { approval } = await api.requestNotebookApproval(currentSession.id, {
        actor_id: currentSession.owner_id,
        project_id: currentSession.project_id,
        expected_revision: revision,
        operation,
        cell_index: cellIndex,
      });
      return approval;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setActivity("Approval request failed");
      return null;
    }
  };

  const patch = async (cellIndex: number) => {
    if (!notebook || !currentSession) return;
    const source = drafts[cellIndex] ?? "";
    if (
      !window.confirm(
        `Approve saving cell ${cellIndex + 1}?\n\nCurrent:\n${notebook.cells[cellIndex]?.source ?? ""}\n\nProposed:\n${source}`,
      )
    )
      return;
    const approval = await approvalFor("patch", cellIndex, notebook.revision);
    if (!approval) return;
    void perform("Approved cell change", () =>
      api.patchNotebookCell(currentSession.id, {
        expected_revision: notebook.revision,
        cell_index: cellIndex,
        source,
        approval_id: approval.id,
      }),
    );
  };

  const execute = async (cellIndex: number) => {
    if (!notebook || !currentSession) return;
    const selected = notebook.cells.find(({ index }) => index === cellIndex);
    const source = drafts[cellIndex] ?? "";
    if (
      !window.confirm(
        `Approve executing cell ${cellIndex + 1} in the ${notebook.kernel_name} boundary?\n\n${source}`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setActivity("Executing cell");
    const save = async () => {
      if (!selected || source === selected.source) return { notebook };
      const approval = await approvalFor("patch", cellIndex, notebook.revision);
      if (!approval) throw new Error("Controller approval was not issued");
      return api.patchNotebookCell(currentSession.id, {
        expected_revision: notebook.revision,
        cell_index: cellIndex,
        source,
        approval_id: approval.id,
      });
    };
    void save()
      .then(async (saved) => {
        const approval = await approvalFor("execute", cellIndex, saved.notebook.revision);
        if (!approval) throw new Error("Controller approval was not issued");
        return api.executeNotebookCell(currentSession.id, {
          expected_revision: saved.notebook.revision,
          cell_index: cellIndex,
          approval_id: approval.id,
          timeout_seconds: 60,
        });
      })
      .then((payload) => {
        setNotebook(payload.notebook);
        setDrafts(
          Object.fromEntries(payload.notebook.cells.map((cell) => [cell.index, cell.source])),
        );
        setActivity("Cell execution completed");
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setActivity("Cell execution failed");
      })
      .finally(() => setBusy(false));
  };

  const structure = async (
    operation: "insert" | "delete" | "move",
    cellIndex: number,
    options: { cell_type?: "code" | "markdown"; direction?: "up" | "down" } = {},
  ) => {
    if (!notebook || !currentSession) return;
    if (!window.confirm(`Approve notebook ${operation} for cell ${cellIndex + 1}?`)) return;
    const approval = await approvalFor("structure", cellIndex, notebook.revision);
    if (!approval) return;
    void perform(`Notebook ${operation}`, () =>
      api.mutateNotebookStructure(currentSession.id, {
        expected_revision: notebook.revision,
        operation,
        cell_index: cellIndex,
        ...options,
        approval_id: approval.id,
      }),
    );
  };

  const openPanel = () => {
    const path =
      currentSession?.document_path ??
      sessions.find(({ document_path }) => document_path)?.document_path ??
      demoPath;
    if (path !== demoPath) setDemoPath(path);
    setExpanded(true);
    if (!busy) void inspectPath(path);
  };

  const selectNotebook = (path: string) => {
    if (hasUnsavedChanges && !window.confirm("Discard unsaved notebook cell changes?")) return;
    setDemoPath(path);
    setNotebook(null);
    setDrafts({});
    setError(null);
    setActivity("Loading notebook");
    void inspectPath(path);
  };

  if (!expanded) {
    return (
      <div className="fixed right-5 bottom-5 z-40">
        <Button
          ref={orbRef}
          variant="icon"
          size="lg"
          aria-label="Open agent notebook collaboration"
          aria-expanded="false"
          aria-controls="agent-notebook-panel"
          className="h-12 w-12 rounded-full border border-(--ui-border) bg-(--ui-surface) text-(--ui-muted) forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]"
          icon={<Sparkles className="h-5 w-5" />}
          onClick={openPanel}
        />
      </div>
    );
  }

  return (
    <section
      ref={bindPanel}
      role="dialog"
      aria-modal="false"
      tabIndex={-1}
      id="agent-notebook-panel"
      aria-labelledby="agent-notebook-title"
      className="fixed inset-x-3 bottom-3 z-40 max-h-[calc(100vh-24px)] max-w-[1180px] overflow-auto border border-(--ui-border) bg-(--ui-surface) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) sm:right-5 sm:left-auto sm:w-[calc(100vw-40px)]"
    >
      <Card className="rounded-none p-0">
        <div className="flex flex-col justify-between gap-3 border-b border-(--ui-border) p-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-(--signal)" />
              <h2 id="agent-notebook-title" className="text-[14px] font-medium">
                Agent notebook collaboration
              </h2>
              <Claim state={notebook ? "observed" : "claimed"}>
                {notebook ? "notebook loaded" : "not inspected"}
              </Claim>
            </div>
            <p className="mt-1 text-[12px] text-(--ui-muted)">
              Edit, organize and execute notebook cells through revision-bound controls.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void inspect()}
              loading={busy}
              className="min-h-11 rounded-none whitespace-nowrap"
            >
              Inspect notebook
            </Button>
            <Button
              variant="icon"
              size="lg"
              aria-label="Collapse agent notebook collaboration"
              aria-expanded="true"
              aria-controls="agent-notebook-panel"
              className="h-11 w-11 rounded-none"
              icon={<X className="h-4 w-4" />}
              onClick={() => {
                if (hasUnsavedChanges && !window.confirm("Discard unsaved notebook cell changes?"))
                  return;
                setExpanded(false);
                orbRef.current?.focus();
              }}
            />
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 p-4">
            <NotebookRuntimeSelector value={demoPath} options={options} onChange={selectNotebook} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-border) pb-3">
              <div>
                <div className="font-mono text-[11px] text-(--ui-muted)">{demoPath}</div>
                <div className="mt-1 text-[12px] text-(--ui-fg)">
                  {notebook?.cells.length ?? 0} cells · {notebook?.kernel_name ?? "Loading kernel"}
                </div>
              </div>
              {notebook ? (
                <span className="font-mono text-[11px] text-(--ui-muted)">
                  {shortRevision(notebook.revision)}
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                disabled={!notebook || busy}
                onClick={() =>
                  structure("insert", notebook?.cells.length ?? 0, { cell_type: "code" })
                }
                className="min-h-11 rounded-none"
              >
                Code cell
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                disabled={!notebook || busy}
                onClick={() =>
                  structure("insert", notebook?.cells.length ?? 0, { cell_type: "markdown" })
                }
                className="min-h-11 rounded-none"
              >
                Markdown cell
              </Button>
            </div>

            {!notebook ? (
              <div
                role="status"
                aria-live="polite"
                className="mt-3 border border-dashed border-(--ui-border) p-6 text-center"
              >
                <h3 className="text-[14px] font-medium">{placeholder.title}</h3>
                <p className="mt-1 text-[12px] text-(--ui-muted)">{placeholder.detail}</p>
              </div>
            ) : null}

            <div className="mt-3 space-y-3" aria-label="Editable notebook cells">
              {notebook?.cells.map((cell) => {
                const draft = drafts[cell.index] ?? cell.source;
                const changed = draft !== cell.source;
                return (
                  <article
                    key={`${notebook.revision}-${cell.index}`}
                    className="border border-(--ui-border) bg-(--ui-surface)"
                  >
                    <header className="flex min-h-11 flex-wrap items-center justify-between gap-1 border-b border-(--ui-border) bg-(--ui-subtle) px-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[11px] text-(--ui-muted)">
                          [{cell.execution_count ?? " "}]
                        </span>
                        <span className="text-[12px] font-medium text-(--ui-fg)">
                          {cell.cell_type === "code" ? "Code" : "Markdown"} cell {cell.index + 1}
                        </span>
                        {changed ? <Claim state="claimed">modified</Claim> : null}
                      </div>
                      <div className="flex items-center">
                        <Button
                          variant="icon"
                          size="lg"
                          aria-label={`Move cell ${cell.index + 1} up`}
                          disabled={busy || cell.index === 0}
                          icon={<ChevronUp className="h-3.5 w-3.5" />}
                          onClick={() => structure("move", cell.index, { direction: "up" })}
                        />
                        <Button
                          variant="icon"
                          size="lg"
                          aria-label={`Move cell ${cell.index + 1} down`}
                          disabled={busy || cell.index === notebook.cells.length - 1}
                          icon={<ChevronDown className="h-3.5 w-3.5" />}
                          onClick={() => structure("move", cell.index, { direction: "down" })}
                        />
                        <Button
                          variant="icon"
                          size="lg"
                          aria-label={`Delete cell ${cell.index + 1}`}
                          disabled={busy}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => structure("delete", cell.index)}
                        />
                      </div>
                    </header>
                    <div className="p-3">
                      <div
                        id={`cell-${cell.index}-editing-help`}
                        className="mb-2 flex flex-wrap justify-between gap-2 text-[11px] text-(--ui-muted)"
                      >
                        <span>Edit source</span>
                        {cell.cell_type === "code" ? (
                          <span>Control or Command + Enter runs this cell</span>
                        ) : (
                          <span>Save records a revision-bound change</span>
                        )}
                      </div>
                      <Textarea
                        aria-label={`Cell ${cell.index + 1} source`}
                        aria-describedby={`cell-${cell.index}-editing-help`}
                        value={draft}
                        onChange={(event) =>
                          setDrafts((value) => ({
                            ...value,
                            [cell.index]: event.target.value,
                          }))
                        }
                        className="min-h-28 rounded-none font-mono text-[13px]"
                        disabled={busy}
                        spellCheck={false}
                        onKeyDown={(event) => {
                          if (
                            cell.cell_type === "code" &&
                            event.key === "Enter" &&
                            (event.ctrlKey || event.metaKey)
                          ) {
                            event.preventDefault();
                            void execute(cell.index);
                          }
                        }}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Code2 className="h-3.5 w-3.5" />}
                          disabled={busy || !changed}
                          onClick={() => void patch(cell.index)}
                          className="min-h-11 rounded-none"
                        >
                          Save cell
                        </Button>
                        {cell.cell_type === "code" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Play className="h-3.5 w-3.5" />}
                            disabled={busy}
                            onClick={() => void execute(cell.index)}
                            className="min-h-11 rounded-none"
                          >
                            Run cell
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {cell.outputs.length ? (
                      <div className="border-t border-(--ui-border) bg-(--ui-subtle) p-3">
                        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-(--ui-muted)">
                          Output
                        </div>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-(--ui-fg)">
                          {cell.outputs.map(({ text }) => text).join("\n")}
                        </pre>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          <NotebookEvidence
            notebook={notebook}
            error={error}
            activity={activity}
            runtime={options.find(({ path }) => path === demoPath)?.runtime ?? "Unavailable"}
            busy={busy}
          />
        </div>
      </Card>
    </section>
  );
}
