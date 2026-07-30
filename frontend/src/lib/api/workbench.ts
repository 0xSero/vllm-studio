import type { ApiCore } from "./core";
import type {
  ScientificComputeLease,
  ScientificComputeLeaseIssue,
  ScientificDatasetAttachment,
  ScientificDatasetAttachmentIssue,
  ScientificExperimentReceipt,
  ScientificExperimentReceiptFinalize,
  ScientificNotebookCreate,
  ScientificNotebookSession,
  ScientificRayJobSubmission,
} from "@local-studio/contracts/scientific-workbench";
import type {
  NotebookApproval,
  NotebookApprovalRequest,
  NotebookCellExecute,
  NotebookCellPatch,
  NotebookCellStructure,
  NotebookDocument,
} from "@local-studio/contracts/notebook-agent";

export type ScientificRayJobView = {
  id: string;
  state: "queued" | "submitted" | "running" | "succeeded" | "failed" | "suspended";
  admitted_at: string;
  submitted_at?: string;
  reconciled_at?: string;
  submission: {
    experiment_id: string;
    project_id: string;
    notebook_id: string;
    classification: "C2";
    compute_profile: { name: string; gpu_count: number; max_workers: number };
    models: ReadonlyArray<{ qualified_id: string }>;
  };
  resource: {
    metadata: { name: string; namespace: string };
  };
  cluster?: {
    uid: string | null;
    job_status: string | null;
    deployment_status: string | null;
    message: string | null;
    started_at: string | null;
    ended_at: string | null;
  };
};

export function createWorkbenchApi(core: ApiCore) {
  return {
    getScientificNotebooks: (): Promise<{ notebooks: ScientificNotebookSession[] }> =>
      core.request("/workbench/notebooks"),
    createScientificNotebook: (
      payload: ScientificNotebookCreate,
    ): Promise<{ notebook: ScientificNotebookSession }> =>
      core.request("/workbench/notebooks", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    getScientificRayJobs: (): Promise<{ jobs: ScientificRayJobView[] }> =>
      core.request("/workbench/ray-jobs"),
    issueScientificComputeLease: (
      payload: ScientificComputeLeaseIssue,
    ): Promise<{ lease: ScientificComputeLease }> =>
      core.request("/workbench/compute-leases", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    issueScientificDatasetAttachment: (
      payload: ScientificDatasetAttachmentIssue,
      actorId: string,
    ): Promise<{ attachment: ScientificDatasetAttachment }> =>
      core.request("/workbench/dataset-attachments", {
        method: "POST",
        headers: {
          "x-local-studio-actor-id": actorId,
          "x-local-studio-project-id": payload.project_id,
        },
        body: JSON.stringify(payload),
      }),
    admitScientificRayJob: (
      payload: ScientificRayJobSubmission,
    ): Promise<{ job: ScientificRayJobView }> =>
      core.request("/workbench/ray-jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    submitScientificRayJob: (jobId: string): Promise<{ job: ScientificRayJobView }> =>
      core.request(`/workbench/ray-jobs/${encodeURIComponent(jobId)}/submit`, {
        method: "POST",
      }),
    reconcileScientificRayJob: (jobId: string): Promise<{ job: ScientificRayJobView }> =>
      core.request(`/workbench/ray-jobs/${encodeURIComponent(jobId)}/reconcile`, {
        method: "POST",
      }),
    finalizeScientificRayJobReceipt: (
      jobId: string,
      payload: ScientificExperimentReceiptFinalize,
    ): Promise<{ receipt: ScientificExperimentReceipt }> =>
      core.request(`/workbench/ray-jobs/${encodeURIComponent(jobId)}/receipt`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    inspectNotebookDocument: (notebookId: string): Promise<{ notebook: NotebookDocument }> =>
      core.request(`/workbench/notebooks/${encodeURIComponent(notebookId)}/document`),
    requestNotebookApproval: (
      notebookId: string,
      payload: NotebookApprovalRequest,
    ): Promise<{ approval: NotebookApproval }> =>
      core.request(`/workbench/notebooks/${encodeURIComponent(notebookId)}/approvals`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    patchNotebookCell: (
      notebookId: string,
      payload: NotebookCellPatch,
    ): Promise<{ notebook: NotebookDocument }> =>
      core.request(`/workbench/notebooks/${encodeURIComponent(notebookId)}/document`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    executeNotebookCell: (
      notebookId: string,
      payload: NotebookCellExecute,
    ): Promise<{ notebook: NotebookDocument }> =>
      core.request(`/workbench/notebooks/${encodeURIComponent(notebookId)}/document/execute`, {
        method: "POST",
        body: JSON.stringify(payload),
        timeout: 130_000,
        retries: 0,
      }),
    mutateNotebookStructure: (
      notebookId: string,
      payload: NotebookCellStructure,
    ): Promise<{ notebook: NotebookDocument }> =>
      core.request(`/workbench/notebooks/${encodeURIComponent(notebookId)}/document/structure`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  };
}
