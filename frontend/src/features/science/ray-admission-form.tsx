"use client";

import { useMemo, useState } from "react";
import api from "@/lib/api/client";
import type {
  ScientificComputeProfile,
  ScientificDatasetAttachment,
  ScientificNotebookSession,
  ScientificRayJobSubmission,
} from "@local-studio/contracts/scientific-workbench";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Claim } from "./science-workbench-components";

type AdmissionFields = {
  experimentId: string;
  providerId: string;
  modelId: string;
  environmentImage: string;
  environmentDigest: string;
  entrypoint: string;
  approvalId: string;
  datasetId: string;
  datasetVersion: string;
  datasetDigest: string;
  datasetPurpose: string;
};

const initialFields: AdmissionFields = {
  experimentId: "",
  providerId: "",
  modelId: "",
  environmentImage: "",
  environmentDigest: "",
  entrypoint: "",
  approvalId: "",
  datasetId: "",
  datasetVersion: "",
  datasetDigest: "",
  datasetPurpose: "",
};

const profileFor = (notebook: ScientificNotebookSession): ScientificComputeProfile => ({
  id: notebook.compute_profile_id,
  name: notebook.compute_profile_id,
  cpu_cores: 4,
  memory_gb: 16,
  gpu_count: 1,
  gpu_resource: "nvidia.com/gpu",
  min_workers: 0,
  max_workers: 1,
  max_runtime_minutes: 120,
  idle_timeout_minutes: 30,
  network_policy: "deny-by-default",
  classification_ceiling: "C2",
});

const requiredFields = (
  fields: AdmissionFields,
  notebook: ScientificNotebookSession | undefined,
): boolean =>
  Boolean(
    notebook &&
    ["ready", "active", "idle"].includes(notebook.state) &&
    fields.experimentId.trim() &&
    fields.providerId.trim() &&
    fields.modelId.trim() &&
    fields.environmentImage.trim() &&
    fields.environmentDigest.trim() &&
    fields.entrypoint.trim() &&
    fields.approvalId.trim(),
  );

export function RayAdmissionForm({
  notebooks,
  onAdmitted,
}: {
  notebooks: ScientificNotebookSession[];
  onAdmitted: () => Promise<void>;
}) {
  const eligible = useMemo(
    () => notebooks.filter(({ state }) => ["ready", "active", "idle"].includes(state)),
    [notebooks],
  );
  const [notebookId, setNotebookId] = useState("");
  const [fields, setFields] = useState(initialFields);
  const [includeDataset, setIncludeDataset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = eligible.find(({ id }) => id === notebookId);
  const canSubmit =
    requiredFields(fields, selected) &&
    (!includeDataset ||
      Boolean(
        fields.datasetId.trim() &&
        fields.datasetVersion.trim() &&
        fields.datasetDigest.trim() &&
        fields.datasetPurpose.trim(),
      ));

  const update = (field: keyof AdmissionFields, value: string) =>
    setFields((current) => ({ ...current, [field]: value }));

  const admit = async () => {
    if (!selected || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const profile = profileFor(selected);
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const { lease } = await api.issueScientificComputeLease({
        project_id: selected.project_id,
        notebook_id: selected.id,
        profile,
        classification: "C2",
        expires_at: expiresAt,
      });
      const datasets: ScientificDatasetAttachment[] = [];
      if (includeDataset) {
        const { attachment } = await api.issueScientificDatasetAttachment(
          {
            project_id: selected.project_id,
            dataset_id: fields.datasetId.trim(),
            version: fields.datasetVersion.trim(),
            digest: fields.datasetDigest.trim(),
            classification: "C2",
            purpose: fields.datasetPurpose.trim(),
            lease_expires_at: expiresAt,
          },
          selected.owner_id,
        );
        datasets.push(attachment);
      }
      const requestedAt = new Date().toISOString();
      const submission: ScientificRayJobSubmission = {
        id: crypto.randomUUID(),
        project_id: selected.project_id,
        notebook_id: selected.id,
        compute_lease_id: lease.id,
        experiment_id: fields.experimentId.trim(),
        classification: "C2",
        compute_profile: lease.profile,
        environment_image: fields.environmentImage.trim(),
        environment_digest: fields.environmentDigest.trim(),
        entrypoint: fields.entrypoint.trim(),
        datasets,
        models: [
          {
            provider_id: fields.providerId.trim(),
            model_id: fields.modelId.trim(),
            qualified_id: `${fields.providerId.trim()}/${fields.modelId.trim()}`,
            endpoint_class: "openai-compatible",
            tool_mode: "approved",
          },
        ],
        parameters: {},
        random_seeds: [],
        approval_ids: [fields.approvalId.trim()],
        requested_by: selected.owner_id,
        requested_at: requestedAt,
      };
      await api.admitScientificRayJob(submission);
      setFields(initialFields);
      setNotebookId("");
      setIncludeDataset(false);
      await onAdmitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ray-admission-title" className="mt-5 border border-(--ui-border) p-4">
      <h2 id="ray-admission-title" className="text-[14px] font-medium">
        Admit Ray experiment
      </h2>
      <p className="mt-1 text-[12px] text-(--ui-muted)">
        The controller issues the compute lease and optional dataset attachment before admission.
      </p>
      {eligible.length === 0 ? (
        <div className="mt-3">
          <Claim state="contradicted">No execution-ready notebook is available</Claim>
        </div>
      ) : (
        <>
          <label className="mt-4 block text-[12px] text-(--ui-muted)">
            Governed notebook
            <select
              value={notebookId}
              onChange={(event) => setNotebookId(event.target.value)}
              className="mt-1 min-h-11 w-full border border-(--ui-border) bg-(--ui-surface) px-3 text-(--ui-fg)"
            >
              <option value="">Choose a ready notebook</option>
              {eligible.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.project_id} · {notebook.document_path} · {notebook.compute_profile_id}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
            {(
              [
                ["Experiment ID", "experimentId", "experiment-01"],
                ["Approval ID", "approvalId", "approved change or ticket ID"],
                ["Provider ID", "providerId", "configured provider"],
                ["Model ID", "modelId", "provider catalog model ID"],
                ["Pinned environment image", "environmentImage", "registry/image@sha256:…"],
                ["Environment digest", "environmentDigest", "sha256:…"],
                ["Ray entrypoint", "entrypoint", "python train.py"],
              ] as const
            ).map(([label, field, placeholder]) => (
              <label key={field} className="text-[12px] text-(--ui-muted)">
                {label}
                <Input
                  value={fields[field]}
                  placeholder={placeholder}
                  onChange={(event) => update(field, event.target.value)}
                  className="mt-1"
                />
              </label>
            ))}
          </div>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-[12px]">
            <input
              type="checkbox"
              checked={includeDataset}
              onChange={(event) => setIncludeDataset(event.target.checked)}
            />
            Issue a read-only dataset attachment
          </label>
          {includeDataset ? (
            <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
              {(
                [
                  ["Dataset ID", "datasetId"],
                  ["Version", "datasetVersion"],
                  ["Digest", "datasetDigest"],
                  ["Purpose", "datasetPurpose"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className="text-[12px] text-(--ui-muted)">
                  {label}
                  <Input
                    value={fields[field]}
                    onChange={(event) => update(field, event.target.value)}
                    className="mt-1"
                  />
                </label>
              ))}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 border border-(--ui-danger) p-3 text-(--ui-danger)">
              Admission failed: {error}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button
              className="min-h-11 rounded-none"
              disabled={!canSubmit}
              loading={busy}
              onClick={() => void admit()}
            >
              Issue lease and admit
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
