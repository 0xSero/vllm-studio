"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input, Spinner } from "@/ui";
import { FormField } from "@/ui/form-field";
import api from "@/lib/api/client";
import type { ProjectTemplate } from "@local-studio/contracts/project-templates";
import { addProjectFromPath } from "@/features/agent/projects/api";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const TEMPLATE_ICONS: Record<string, string> = {
  "book-open": "📚",
  "chart-bar": "📊",
  flask: "🧪",
  document: "📄",
};

export function ProjectTemplatePicker({ onProjectCreated }: { onProjectCreated?: () => void }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Array<ProjectTemplate & { match_score?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useMountSubscription(() => {
    let cancelled = false;
    api
      .getProjectTemplates()
      .then(({ templates: fetched }) => {
        if (!cancelled) {
          const sorted = [...fetched].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
          setTemplates(sorted);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load templates");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = useCallback(async () => {
    if (!selectedTemplate || !projectPath.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api.materializeProjectTemplate(selectedTemplate, {
        project_path: projectPath.trim(),
      });
      await addProjectFromPath(result.project_path);
      onProjectCreated?.();
      router.push(`/agent?project=${encodeURIComponent(result.project_path)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setCreating(false);
    }
  }, [selectedTemplate, projectPath, router, onProjectCreated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error">
        {error}
        <Button variant="ghost" className="ml-2" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Start a new project</h2>
        <p className="text-sm text-muted-foreground">
          Pick a template that fits your work. Each one creates a notebook with starter code and
          sets up the AI assistant with the right context.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => setSelectedTemplate(template.id)}
            className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
              selectedTemplate === template.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-border-hover"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{TEMPLATE_ICONS[template.icon] ?? "📄"}</span>
              <span className="font-medium">{template.name}</span>
              {template.match_score !== undefined && template.match_score > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Recommended
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{template.description}</p>
          </button>
        ))}
      </div>

      {selectedTemplate && (
        <Card className="p-4">
          <FormField
            label="Project location"
            description="Choose where to create your project folder"
          >
            <Input
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/home/me/my-research"
            />
          </FormField>

          {createError && (
            <Alert variant="error" className="mt-3">
              {createError}
            </Alert>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSelectedTemplate(null)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !projectPath.trim()}>
              {creating ? "Creating..." : "Create project"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
