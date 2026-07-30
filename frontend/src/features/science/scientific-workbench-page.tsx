"use client";

import { useCallback, useMemo, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import type { ScientificRayJobView } from "@/lib/api/workbench";
import type {
  ScientificNotebookCreate,
  ScientificNotebookRuntime,
  ScientificNotebookSession,
} from "@local-studio/contracts/scientific-workbench";
import { NormalizedPrincipalSchema } from "@local-studio/contracts/enterprise-auth";
import { Schema } from "effect";
import { Button } from "@/ui/button";
import { Cpu, FlaskConical, Plus, RefreshCw, ShieldCheck } from "@/ui/icon-registry";
import { Input } from "@/ui/input";
import { AgentNotebookShowcase } from "./agent-notebook-showcase";
import { RayAdmissionForm } from "./ray-admission-form";
import {
  Metric,
  NotebookSessions,
  RayJobs,
  ScienceAuthorityFooter,
  ScienceEvidenceMargin,
} from "./science-workbench-components";

const zeroDigest = `sha256:${"0".repeat(64)}`;
const EnterpriseSubjectSchema = Schema.Struct({
  principal: Schema.NullOr(NormalizedPrincipalSchema),
});

const initialNotebook = (): ScientificNotebookCreate => ({
  project_id: "cortaix-research",
  owner_id: "scientist",
  runtime: "python-jupyter",
  document_path: "agent-collaboration.ipynb",
  classification: "C2",
  compute_profile_id: "gpu-small",
  image_digest: zeroDigest,
  expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
});

function CreateNotebook({
  draft,
  saving,
  onChange,
  onCancel,
  onSubmit,
  ownerLocked,
}: {
  draft: ScientificNotebookCreate;
  saving: boolean;
  onChange: (draft: ScientificNotebookCreate) => void;
  onCancel: () => void;
  onSubmit: () => void;
  ownerLocked: boolean;
}) {
  const runtimes: Array<{
    value: ScientificNotebookRuntime;
    label: string;
    path: string;
  }> = [
    { value: "python-jupyter", label: "Python · Jupyter", path: "agent-collaboration.ipynb" },
    {
      value: "python-smolvm",
      label: "Python · SmolVM",
      path: "agent-collaboration-python-smolvm.ipynb",
    },
    { value: "node-smolvm", label: "Node.js · SmolVM", path: "agent-collaboration-node.ipynb" },
  ];
  return (
    <section
      aria-labelledby="create-notebook-title"
      className="mt-4 border border-(--ui-border) p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="create-notebook-title" className="text-[15px] font-medium">
            Request notebook session
          </h2>
          <p className="mt-1 text-[12px] text-(--ui-muted)">
            This records a C2 request. Compute admission remains separate.
          </p>
        </div>
        <span className="font-mono text-[12px]">C2</span>
      </div>
      <fieldset className="mt-4">
        <legend className="text-[12px] text-(--ui-muted)">Notebook runtime</legend>
        <div className="mt-1 grid gap-2 @xl:grid-cols-2">
          {runtimes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={draft.runtime === option.value}
              onClick={() =>
                onChange({ ...draft, runtime: option.value, document_path: option.path })
              }
              className={`min-h-11 border px-3 py-2 text-left ${
                draft.runtime === option.value
                  ? "border-(--color-primary) bg-(--color-primary)/8"
                  : "border-(--ui-border)"
              }`}
            >
              <span className="font-mono text-[12px]">{option.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 grid gap-3 @3xl:grid-cols-2">
        {(
          [
            ["Project", "project_id"],
            ["Owner", "owner_id"],
            ["Compute profile", "compute_profile_id"],
            ["Notebook document", "document_path"],
          ] as const
        ).map(([label, field]) => (
          <label key={field} className="text-[12px] text-(--ui-muted)">
            {label}
            <Input
              value={draft[field]}
              readOnly={field === "owner_id" && ownerLocked}
              onChange={(event) => onChange({ ...draft, [field]: event.target.value })}
              className="mt-1"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" className="min-h-11 rounded-none" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          loading={saving}
          className="min-h-11 rounded-none"
          onClick={onSubmit}
          disabled={
            !draft.project_id.trim() || !draft.owner_id.trim() || !draft.document_path.trim()
          }
        >
          Submit request
        </Button>
      </div>
    </section>
  );
}

export default function ScientificWorkbenchPage() {
  const [notebooks, setNotebooks] = useState<ScientificNotebookSession[]>([]);
  const [jobs, setJobs] = useState<ScientificRayJobView[]>([]);
  const [draft, setDraft] = useState(initialNotebook);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [receiptDigest, setReceiptDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [principalSubject, setPrincipalSubject] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [notebookPayload, jobPayload] = await Promise.all([
        api.getScientificNotebooks(),
        api.getScientificRayJobs(),
      ]);
      setNotebooks(notebookPayload.notebooks);
      setJobs(jobPayload.jobs);
      try {
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
        if (sessionResponse.ok) {
          const session = Schema.decodeUnknownSync(EnterpriseSubjectSchema)(
            await sessionResponse.json(),
          );
          const subject = session.principal?.subject ?? null;
          setPrincipalSubject(subject);
          if (subject) {
            setDraft((current) => ({ ...current, owner_id: subject }));
          }
        }
      } catch {
        setPrincipalSubject(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const createNotebook = async () => {
    setSaving(true);
    setError(null);
    try {
      const { notebook } = await api.createScientificNotebook(draft);
      setDraft({
        ...initialNotebook(),
        ...(principalSubject ? { owner_id: principalSubject } : {}),
      });
      setSelectedPath(notebook.document_path ?? null);
      setShowCreate(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const runJobAction = async (
    jobId: string,
    action: () => Promise<{ job: ScientificRayJobView }>,
  ) => {
    setBusyJob(jobId);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyJob(null);
    }
  };

  const createReceipt = async (jobId: string) => {
    setBusyJob(jobId);
    setError(null);
    try {
      const { receipt } = await api.finalizeScientificRayJobReceipt(jobId, {
        artifact_digests: [],
        policy_decision_ids: [],
        resource_usage: { cpu_seconds: 0, gpu_seconds: 0, peak_memory_gb: 0 },
      });
      setReceiptDigest(receipt.receipt_digest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyJob(null);
    }
  };

  const readyCount = useMemo(
    () => notebooks.filter(({ state }) => state === "ready" || state === "active").length,
    [notebooks],
  );

  return (
    <div className="min-h-full bg-(--ui-bg) text-(--ui-fg)">
      <a
        href="#main-content"
        className="sr-only z-50 bg-(--ui-surface) p-3 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="@container mx-auto max-w-[1280px] px-4 py-5 sm:px-6"
      >
        <header className="flex flex-col justify-between gap-4 border-b border-(--ui-border) pb-5 @3xl:flex-row @3xl:items-end">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-(--ui-muted)">
              cortAIx Factory · Build
            </div>
            <h1 className="mt-2 text-[28px] font-medium">Scientific workbench</h1>
            <p className="mt-2 max-w-2xl text-[13px] text-(--ui-muted)">
              Govern notebooks, approved models and Ray compute within the C2 boundary.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void load()}
              disabled={loading}
              className="min-h-11 rounded-none"
            >
              Refresh
            </Button>
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setShowCreate((value) => !value)}
              className="min-h-11 rounded-none"
            >
              Create notebook
            </Button>
          </div>
        </header>
        {error ? (
          <div role="alert" className="mt-4 border border-(--ui-border) p-3 text-(--ui-fg)">
            Controller request failed: {error}
          </div>
        ) : null}
        {showCreate ? (
          <CreateNotebook
            draft={draft}
            saving={saving}
            onChange={setDraft}
            onCancel={() => setShowCreate(false)}
            onSubmit={() => void createNotebook()}
            ownerLocked={Boolean(principalSubject)}
          />
        ) : null}
        <section
          aria-label="Workbench summary"
          className="mt-5 grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-4"
        >
          <Metric
            label="Notebooks"
            value={loading ? "—" : String(notebooks.length)}
            detail={`${readyCount} controller-observed ready or active`}
            icon={<FlaskConical className="h-4 w-4" />}
          />
          <Metric
            label="Ray jobs"
            value={loading ? "—" : String(jobs.length)}
            detail={`${jobs.filter(({ cluster }) => cluster).length} reconciled with cluster evidence`}
            icon={<RefreshCw className="h-4 w-4" />}
          />
          <Metric
            label="Compute"
            value={
              jobs.length
                ? `${jobs.reduce((sum, job) => sum + job.submission.compute_profile.gpu_count, 0)} GPU`
                : "—"
            }
            detail="Derived from admitted Ray documents"
            icon={<Cpu className="h-4 w-4" />}
          />
          <Metric
            label="Handling"
            value="C2"
            detail="Derived from appliance"
            icon={<ShieldCheck className="h-4 w-4" />}
          />
        </section>
        <div className="mt-5 grid border border-(--ui-border) bg-(--ui-surface) @6xl:grid-cols-[minmax(0,1fr)_280px]">
          <NotebookSessions
            notebooks={notebooks}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onCreate={() => setShowCreate(true)}
          />
          <ScienceEvidenceMargin notebooks={notebooks} jobs={jobs} receiptDigest={receiptDigest} />
        </div>
        <RayJobs
          jobs={jobs}
          busyJob={busyJob}
          onSubmit={(id) => void runJobAction(id, () => api.submitScientificRayJob(id))}
          onReconcile={(id) => void runJobAction(id, () => api.reconcileScientificRayJob(id))}
          onReceipt={(id) => void createReceipt(id)}
        />
        <RayAdmissionForm notebooks={notebooks} onAdmitted={load} />
        <AgentNotebookShowcase
          key={selectedPath ?? "unselected"}
          sessions={notebooks}
          selectedPath={selectedPath}
        />
        <ScienceAuthorityFooter />
      </main>
    </div>
  );
}
