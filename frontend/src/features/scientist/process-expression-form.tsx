"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input, Select, Spinner } from "@/ui";
import { FormField } from "@/ui/form-field";
import api from "@/lib/api/client";
import { addProjectFromPath } from "@/features/agent/projects/api";
import type { ScientistProcessStep } from "@local-studio/contracts/scientist-profile";

const STEP_TYPES: Array<{
  value: ScientistProcessStep["step_type"];
  label: string;
  hint: string;
}> = [
  { value: "data_collection", label: "Data Collection", hint: "Gather or download data" },
  { value: "data_cleaning", label: "Data Cleaning", hint: "Clean, filter, transform" },
  { value: "exploration", label: "Exploration", hint: "Summary statistics, distributions" },
  { value: "analysis", label: "Analysis", hint: "Statistical tests, modeling" },
  { value: "modeling", label: "Modeling", hint: "Train and evaluate models" },
  { value: "visualization", label: "Visualization", hint: "Charts, plots, figures" },
  { value: "interpretation", label: "Interpretation", hint: "Draw conclusions, explain" },
  { value: "reporting", label: "Reporting", hint: "Write up results" },
  { value: "custom", label: "Custom", hint: "Your own step type" },
];

interface ProcessStepForm {
  id: string;
  label: string;
  description: string;
  step_type: ScientistProcessStep["step_type"];
}

export function ProcessExpressionForm() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [steps, setSteps] = useState<ProcessStepForm[]>([
    { id: "step-1", label: "", description: "", step_type: "data_collection" },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addStep = useCallback(() => {
    setSteps((prev) => [
      ...prev,
      {
        id: `step-${prev.length + 1}`,
        label: "",
        description: "",
        step_type: "analysis",
      },
    ]);
  }, []);

  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const updateStep = useCallback((id: string, field: keyof ProcessStepForm, value: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }, []);

  const generateNotebookCells = useCallback((steps: ProcessStepForm[], projectName: string) => {
    const cells: Array<{ cell_type: "code" | "markdown"; source: string }> = [
      {
        cell_type: "markdown",
        source: `# ${projectName || "My Workflow"}\n\nThis notebook was generated from your workflow description.\nFollow the steps below — each section corresponds to a step in your process.\nAsk the AI assistant for help at any time.`,
      },
    ];

    for (const step of steps) {
      if (!step.label.trim()) continue;
      cells.push({
        cell_type: "markdown",
        source: `## Step: ${step.label}${step.description ? `\n\n${step.description}` : ""}`,
      });
      cells.push({
        cell_type: "code",
        source: `# ${step.label}\n# ${step.description || "Add your code here"}\n# Ask the AI: "Help me with ${step.label.toLowerCase()}"\npass`,
      });
    }

    cells.push({
      cell_type: "markdown",
      source: `## Results\n\nUse this section to summarize your findings.\nAsk the AI: "Summarize what I found in this analysis."`,
    });

    return cells;
  }, []);

  const generateAgentPrompt = useCallback((steps: ProcessStepForm[], projectName: string) => {
    const stepDescriptions = steps
      .filter((s) => s.label.trim())
      .map((s, i) => `${i + 1}. ${s.label}${s.description ? ` — ${s.description}` : ""}`)
      .join("\n");

    return `You are a research assistant helping a scientist with a project called "${projectName || "My Workflow"}.

The scientist has described their workflow as follows:
${stepDescriptions}

Help the scientist work through each step in order. When they ask for help:
1. Write code that addresses the current step
2. Explain what the code does in plain language
3. Suggest next steps based on the workflow
4. Save any results or outputs to the project directory

If the scientist is unsure what to do next, remind them which step they're on and suggest how to proceed.`;
  }, []);

  const handleCreate = useCallback(async () => {
    if (!projectPath.trim() || steps.every((s) => !s.label.trim())) return;
    setCreating(true);
    setError(null);
    try {
      const cells = generateNotebookCells(steps, projectName);
      const agentPrompt = generateAgentPrompt(steps, projectName);

      const templatePayload = {
        id: "blank" as const,
        name: projectName || "Custom Workflow",
        description: "Generated from process description",
        icon: "document",
        recommended_goals: [] as never[],
        recommended_data_types: [] as never[],
        compute_preference: "local-smolvm" as const,
        notebook_cells: cells,
        agent_prompt: agentPrompt,
      };

      const result = await api.materializeProjectTemplate("blank", {
        project_path: projectPath.trim(),
        project_name: projectName.trim() || undefined,
      });

      await addProjectFromPath(result.project_path);
      router.push(`/agent?project=${encodeURIComponent(result.project_path)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setCreating(false);
    }
  }, [projectPath, projectName, steps, generateNotebookCells, generateAgentPrompt, router]);

  const canCreate = projectPath.trim() && steps.some((s) => s.label.trim());

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Describe your workflow</h1>
        <p className="mt-2 text-muted-foreground">
          Tell us about your process, step by step. We&apos;ll generate a notebook with a section
          for each step and set up the AI assistant to help you through it.
        </p>
      </div>

      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Project name" description="What is this project about?">
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., Climate impact on crop yield"
            />
          </FormField>
          <FormField label="Project location" description="Where to create the project folder">
            <Input
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/home/me/projects/climate-study"
            />
          </FormField>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Workflow steps</h2>
          <Button size="sm" variant="secondary" onClick={addStep}>
            Add step
          </Button>
        </div>

        {steps.map((step, i) => (
          <Card key={step.id} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Step {i + 1}</span>
              {steps.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => removeStep(step.id)}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid gap-3">
              <FormField label="What do you do in this step?">
                <Input
                  value={step.label}
                  onChange={(e) => updateStep(step.id, "label", e.target.value)}
                  placeholder="e.g., Load sensor data from CSV files"
                />
              </FormField>
              <FormField label="Describe this step (optional)">
                <Input
                  value={step.description}
                  onChange={(e) => updateStep(step.id, "description", e.target.value)}
                  placeholder="e.g., Read all CSV files from the data directory and combine them"
                />
              </FormField>
              <FormField label="Step type">
                <Select
                  value={step.step_type}
                  onChange={(e) =>
                    updateStep(step.id, "step_type", e.target.value as ProcessStepForm["step_type"])
                  }
                >
                  {STEP_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label} — {type.hint}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </Card>
        ))}
      </div>

      {error && (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-6 flex justify-end">
        <Button onClick={handleCreate} disabled={creating || !canCreate}>
          {creating ? (
            <>
              <Spinner className="mr-2" />
              Creating...
            </>
          ) : (
            "Generate project"
          )}
        </Button>
      </div>
    </div>
  );
}
