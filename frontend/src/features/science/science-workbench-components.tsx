"use client";

import type { ReactNode } from "react";
import type { ScientificRayJobView } from "@/lib/api/workbench";
import type { ScientificNotebookSession } from "@local-studio/contracts/scientific-workbench";
import { Button } from "@/ui/button";
import { Database, FlaskConical, Play, RefreshCw } from "@/ui/icon-registry";

export const runtimeLabel = (runtime: ScientificNotebookSession["runtime"]): string => {
  if (runtime === "python-jupyter") return "Python · Jupyter";
  if (runtime === "python-smolvm") return "Python · SmolVM";
  if (runtime === "node-smolvm") return "Node.js · SmolVM";
  return "Legacy · unspecified";
};

export const shortEvidence = (value: string): string =>
  value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value;

export function Claim({
  state,
  children,
}: {
  state: "observed" | "inferred" | "claimed" | "attested" | "contradicted" | "quarantined";
  children: ReactNode;
}) {
  const glyph = {
    observed: "⊢",
    inferred: "⇝",
    claimed: "○",
    attested: "◆",
    contradicted: "⊭",
    quarantined: "⊘",
  }[state];
  const tone =
    state === "attested"
      ? "text-(--proof)"
      : state === "quarantined"
        ? "text-(--emergency)"
        : "text-(--ui-muted)";
  return (
    <span className={`flex min-h-11 min-w-0 items-center gap-2 font-mono text-[12px] ${tone}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>{state}</span>
      <span className="min-w-0 font-sans text-(--ui-fg) [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

export function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="min-h-[88px] border border-(--ui-border) bg-(--ui-surface) p-3 forced-colors:border-[CanvasText]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-(--ui-border) text-(--ui-muted)">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xl font-medium text-(--ui-fg)">{value}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-(--ui-muted)">
              {label}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-(--ui-muted)">{detail}</div>
        </div>
      </div>
    </div>
  );
}

export function NotebookSessions({
  notebooks,
  selectedPath,
  onSelect,
  onCreate,
}: {
  notebooks: ScientificNotebookSession[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreate: () => void;
}) {
  return (
    <section aria-labelledby="sessions-title" className="min-w-0">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4">
        <div>
          <h2 id="sessions-title" className="text-[14px] font-medium">
            Notebook sessions
          </h2>
          <p className="mt-0.5 text-[11px] text-(--ui-muted)">Lifecycle and compute admission</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-(--ui-muted)">
          <Database className="h-4 w-4" />
          Controller persistence
        </div>
      </div>
      {notebooks.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center border-t border-(--ui-border) p-6 text-center">
          <FlaskConical className="h-7 w-7 text-(--ui-muted)" />
          <h3 className="mt-3 text-[14px] font-medium">No notebook sessions</h3>
          <p className="mt-1 max-w-md text-[12px] text-(--ui-muted)">
            Request a governed C2 session before admitting compute.
          </p>
          <Button className="mt-4 min-h-11 rounded-none" onClick={onCreate}>
            Create notebook
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-(--ui-border)">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
            <thead className="bg-(--ui-subtle) text-(--ui-muted)">
              <tr>
                {["Session", "Runtime", "Compute", "State", "Classification", "Expires"].map(
                  (label) => (
                    <th key={label} className="border-b border-(--ui-border) px-4 py-2 font-medium">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {notebooks.map((notebook) => (
                <tr key={notebook.id} className="border-b border-(--ui-border)">
                  <td className="px-4 py-2">
                    {notebook.document_path ? (
                      <button
                        type="button"
                        aria-pressed={selectedPath === notebook.document_path}
                        onClick={() => onSelect(notebook.document_path!)}
                        className="min-h-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                      >
                        <span className="block font-medium">{notebook.owner_id}</span>
                        <span className="font-mono text-[11px] text-(--ui-muted)">
                          {notebook.document_path}
                        </span>
                      </button>
                    ) : (
                      notebook.owner_id
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">{runtimeLabel(notebook.runtime)}</td>
                  <td className="px-4 py-2 font-mono text-(--ui-muted)">
                    {notebook.compute_profile_id}
                  </td>
                  <td className="px-4 py-2">
                    <Claim state="observed">{notebook.state}</Claim>
                  </td>
                  <td className="px-4 py-2 font-mono">{notebook.classification}</td>
                  <td className="px-4 py-2 font-mono text-(--ui-muted)">
                    {new Date(notebook.expires_at).toISOString().slice(0, 16).replace("T", " ")}Z
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function RayJobs({
  jobs,
  busyJob,
  onSubmit,
  onReconcile,
  onReceipt,
}: {
  jobs: ScientificRayJobView[];
  busyJob: string | null;
  onSubmit: (id: string) => void;
  onReconcile: (id: string) => void;
  onReceipt: (id: string) => void;
}) {
  return (
    <section aria-labelledby="ray-jobs-title" className="mt-5 border border-(--ui-border)">
      <div className="px-4 py-3">
        <h2 id="ray-jobs-title" className="text-[14px] font-medium">
          Ray jobs
        </h2>
        <p className="mt-1 text-[11px] text-(--ui-muted)">
          Admission records are distinct from observed cluster execution.
        </p>
      </div>
      <div className="overflow-x-auto border-t border-(--ui-border)">
        <table className="w-full min-w-[780px] text-left text-[12px]">
          <thead className="bg-(--ui-subtle) text-(--ui-muted)">
            <tr>
              {["Experiment", "Compute", "State", "Cluster evidence", "Actions"].map((label) => (
                <th key={label} className="border-b border-(--ui-border) px-4 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-(--ui-muted)">
                  No Ray admission records.
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const terminal = job.state === "succeeded" || job.state === "failed";
                return (
                  <tr key={job.id} className="border-b border-(--ui-border)">
                    <td className="px-4 py-2 font-mono">{job.submission.experiment_id}</td>
                    <td className="px-4 py-2">{job.submission.compute_profile.name}</td>
                    <td className="px-4 py-2">
                      <Claim state={terminal && job.cluster ? "observed" : "claimed"}>
                        {job.state}
                      </Claim>
                    </td>
                    <td className="px-4 py-2 text-(--ui-muted)">
                      {job.cluster?.job_status ?? "Not reconciled"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {job.state === "queued" ? (
                          <Button
                            size="sm"
                            className="min-h-11 rounded-none"
                            icon={<Play className="h-4 w-4" />}
                            loading={busyJob === job.id}
                            onClick={() => onSubmit(job.id)}
                          >
                            Submit
                          </Button>
                        ) : null}
                        {job.state !== "queued" && !terminal ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-11 rounded-none"
                            icon={<RefreshCw className="h-4 w-4" />}
                            loading={busyJob === job.id}
                            onClick={() => onReconcile(job.id)}
                          >
                            Reconcile
                          </Button>
                        ) : null}
                        {terminal ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-11 rounded-none"
                            loading={busyJob === job.id}
                            onClick={() => onReceipt(job.id)}
                          >
                            Create receipt
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ScienceEvidenceMargin({
  notebooks,
  jobs,
  receiptDigest,
}: {
  notebooks: ScientificNotebookSession[];
  jobs: ScientificRayJobView[];
  receiptDigest: string | null;
}) {
  return (
    <aside
      aria-label="Evidence margin"
      className="border-t border-(--ui-border) bg-(--ui-subtle)/35 p-4 forced-colors:bg-[Canvas] @6xl:border-t-0 @6xl:border-l"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--ui-muted)">
        Evidence margin
      </div>
      <h2 className="mt-2 text-[15px] font-medium">Current standing</h2>
      <div className="mt-4 space-y-3">
        <Claim state="observed">{notebooks.length} controller notebook records</Claim>
        <Claim state="claimed">{jobs.length} admitted Ray documents</Claim>
        <Claim state="inferred">
          {jobs.filter(({ cluster }) => cluster).length} cluster observations
        </Claim>
        {receiptDigest ? (
          <button
            type="button"
            data-proof={receiptDigest}
            className="min-h-11 w-full border border-(--proof) px-2 text-left font-mono text-[13px] text-(--proof)"
            onClick={() => void navigator.clipboard.writeText(receiptDigest)}
          >
            ◆ attested {shortEvidence(receiptDigest)}
          </button>
        ) : (
          <Claim state="claimed">No experiment receipt in this view</Claim>
        )}
      </div>
    </aside>
  );
}

export function ScienceAuthorityFooter() {
  return (
    <footer
      aria-label="C2 handling authority"
      data-handling-level="restricted"
      data-handling-origin="derived"
      className="mt-5 grid min-h-11 gap-2 border-t border-(--ui-border) px-3 py-2 font-mono text-[11px] sm:grid-cols-[auto_1fr_auto] sm:items-center"
    >
      <span className="flex items-center gap-2">
        <strong className="text-[13px] tracking-[0.14em]">C2</strong>
        <span className="flex h-[13px] items-end gap-0.5" aria-hidden="true">
          {[1, 2, 3, 4].map((tick) => (
            <span
              key={tick}
              className={`w-[3px] bg-current ${tick <= 2 ? "opacity-100" : "opacity-20"}`}
              style={{ height: `${4 + tick * 2}px` }}
            />
          ))}
        </span>
        <span>Derived · appliance profile</span>
      </span>
      <span className="font-sans">mode changes deployment, not governance semantics</span>
    </footer>
  );
}
