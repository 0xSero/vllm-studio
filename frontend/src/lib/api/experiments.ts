import type { ApiCore } from "./core";
import type {
  ExperimentRecord,
  ExperimentArtifact,
} from "@local-studio/contracts/experiment-tracking";

export function createExperimentApi(core: ApiCore) {
  return {
    getExperiments: (projectId?: string): Promise<{ experiments: ExperimentRecord[] }> =>
      core.request(
        projectId ? `/experiments?project_id=${encodeURIComponent(projectId)}` : "/experiments",
      ),

    getExperiment: (id: string): Promise<{ experiment: ExperimentRecord }> =>
      core.request(`/experiments/${encodeURIComponent(id)}`),

    getExperimentLineage: (id: string): Promise<{ lineage: ExperimentRecord[] }> =>
      core.request(`/experiments/${encodeURIComponent(id)}/lineage`),

    createExperiment: (payload: {
      project_id: string;
      name: string;
      parameters?: Record<string, unknown>;
      notes?: string;
      parent_experiment_id?: string;
    }): Promise<{ experiment: ExperimentRecord }> =>
      core.request("/experiments", { method: "POST", body: JSON.stringify(payload) }),

    updateExperiment: (
      id: string,
      payload: {
        name?: string;
        parameters?: Record<string, unknown>;
        metrics?: Record<string, unknown>;
        notes?: string;
        artifacts?: ExperimentArtifact[];
        status?: "running" | "succeeded" | "failed" | "cancelled";
        completed_at?: string;
      },
    ): Promise<{ experiment: ExperimentRecord }> =>
      core.request(`/experiments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    deleteExperiment: (id: string): Promise<{ success: boolean }> =>
      core.request(`/experiments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}
