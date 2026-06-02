"use client";

import { Info, Server } from "lucide-react";
import { FormField, FormSection, Input, SegmentedControl, Select, type SegmentedItem } from "@/ui";
import type { Backend, ModelInfo, RecipeEditor } from "@/lib/types";

const BACKENDS: SegmentedItem<Backend>[] = [
  { id: "vllm", label: "vLLM" },
  { id: "sglang", label: "SGLang" },
  { id: "llamacpp", label: "llama.cpp" },
  { id: "mlx", label: "MLX" },
];

export function RecipeModalTabGeneral({
  recipe,
  onChange,
  availableModels,
  modelServedNames,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
}) {
  const isCustomPath =
    !!recipe.model_path && !availableModels.some((m) => m.path === recipe.model_path);

  return (
    <div className="space-y-6">
      <FormSection icon={<Info className="h-4 w-4" />} title="Basic Information">
        <FormField label="Recipe Name" required>
          <Input
            value={recipe.name ?? ""}
            onChange={(e) => onChange({ ...recipe, name: e.target.value })}
            placeholder="e.g., Llama 3.1 8B Instruct"
          />
        </FormField>

        <FormField
          label="Model Path"
          required
          description={isCustomPath ? `Custom path: ${recipe.model_path}` : undefined}
        >
          <Select
            value={recipe.model_path ?? ""}
            onChange={(e) => onChange({ ...recipe, model_path: e.target.value })}
            placeholder="Select a model…"
          >
            {availableModels.map((model) => {
              const servedName = modelServedNames[model.path];
              return (
                <option key={model.path} value={model.path}>
                  {servedName ? `${servedName} (${model.name})` : model.name}
                </option>
              );
            })}
          </Select>
        </FormField>
      </FormSection>

      <FormSection icon={<Server className="h-4 w-4" />} title="Server Configuration">
        <FormField label="Backend">
          <SegmentedControl
            items={BACKENDS}
            value={recipe.backend ?? "vllm"}
            onChange={(id) => onChange({ ...recipe, backend: id })}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Host">
            <Input
              value={recipe.host ?? "0.0.0.0"}
              onChange={(e) => onChange({ ...recipe, host: e.target.value || undefined })}
              placeholder="0.0.0.0"
            />
          </FormField>
          <FormField label="Port">
            <Input
              type="number"
              value={recipe.port ?? 8000}
              onChange={(e) => onChange({ ...recipe, port: Number(e.target.value) })}
            />
          </FormField>
        </div>

        <FormField label="Served Model Name" description="Optional — the name exposed in the API.">
          <Input
            value={recipe.served_model_name || ""}
            onChange={(e) => onChange({ ...recipe, served_model_name: e.target.value || undefined })}
            placeholder="e.g. deepseek-v4-flash"
          />
        </FormField>
      </FormSection>
    </div>
  );
}
