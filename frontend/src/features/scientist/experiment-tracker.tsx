"use client";

import { useCallback, useState } from "react";
import { Alert, Button, Card, Input, Spinner } from "@/ui";
import { FormField } from "@/ui/form-field";
import api from "@/lib/api/client";
import type { ExperimentRecord } from "@local-studio/contracts/experiment-tracking";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const STATUS_COLORS: Record<ExperimentRecord["status"], string> = {
  running: "bg-blue-100 text-blue-700",
  succeeded: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-700",
};

export function ExperimentTracker({ projectId }: { projectId: string }) {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedLineage, setSelectedLineage] = useState<ExperimentRecord[] | null>(null);

  const loadExperiments = useCallback(async () => {
    try {
      const { experiments: fetched } = await api.getExperiments(projectId);
      setExperiments(fetched);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load experiments");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useMountSubscription(() => {
    void loadExperiments();
  }, [loadExperiments]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { experiment } = await api.createExperiment({
        project_id: projectId,
        name: newName.trim(),
        notes: newNotes.trim() || undefined,
      });
      setExperiments((prev) => [experiment, ...prev]);
      setNewName("");
      setNewNotes("");
      setShowNewForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create experiment");
    } finally {
      setCreating(false);
    }
  }, [projectId, newName, newNotes]);

  const handleUpdateStatus = useCallback(async (id: string, status: ExperimentRecord["status"]) => {
    try {
      const { experiment } = await api.updateExperiment(id, {
        status,
        completed_at: status !== "running" ? new Date().toISOString() : undefined,
      });
      setExperiments((prev) => prev.map((e) => (e.id === id ? experiment : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update experiment");
    }
  }, []);

  const handleViewLineage = useCallback(async (id: string) => {
    try {
      const { lineage } = await api.getExperimentLineage(id);
      setSelectedLineage(lineage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load lineage");
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Experiments</h2>
        <Button size="sm" onClick={() => setShowNewForm(!showNewForm)}>
          {showNewForm ? "Cancel" : "New experiment"}
        </Button>
      </div>

      {error && (
        <Alert variant="error">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </Alert>
      )}

      {showNewForm && (
        <Card className="p-4">
          <FormField label="Experiment name">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., baseline-v2"
            />
          </FormField>
          <FormField label="Notes (optional)" className="mt-3">
            <Input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="What are you testing?"
            />
          </FormField>
          <div className="mt-3 flex justify-end">
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </Card>
      )}

      {experiments.length === 0 && !showNewForm ? (
        <Card className="p-6 text-center text-muted-foreground">
          No experiments yet. Create one to start tracking parameters, metrics, and results.
        </Card>
      ) : (
        <div className="space-y-2">
          {experiments.map((exp) => (
            <Card key={exp.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{exp.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[exp.status]}`}
                    >
                      {exp.status}
                    </span>
                  </div>
                  {exp.notes && <p className="mt-1 text-sm text-muted-foreground">{exp.notes}</p>}
                  <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                    <span>Created: {new Date(exp.created_at).toLocaleString()}</span>
                    {exp.completed_at && (
                      <span>Completed: {new Date(exp.completed_at).toLocaleString()}</span>
                    )}
                  </div>
                  {Object.keys(exp.parameters).length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs font-medium text-muted-foreground">Parameters:</span>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(exp.parameters, null, 2)}
                      </pre>
                    </div>
                  )}
                  {Object.keys(exp.metrics).length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs font-medium text-muted-foreground">Metrics:</span>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(exp.metrics, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {exp.status === "running" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleUpdateStatus(exp.id, "succeeded")}
                      >
                        Mark succeeded
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleUpdateStatus(exp.id, "failed")}
                      >
                        Mark failed
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleViewLineage(exp.id)}>
                    View lineage
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selectedLineage && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">Experiment lineage</h3>
            <Button size="sm" variant="ghost" onClick={() => setSelectedLineage(null)}>
              Close
            </Button>
          </div>
          <div className="space-y-2">
            {selectedLineage.map((exp, i) => (
              <div key={exp.id} className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{i + 1}.</span>
                <span className="font-medium">{exp.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[exp.status]}`}>
                  {exp.status}
                </span>
                {i < selectedLineage.length - 1 && <span className="text-muted-foreground">←</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
