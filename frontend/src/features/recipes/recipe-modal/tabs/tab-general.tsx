"use client";

import { Info, Network, Server } from "@/ui/icon-registry";
import { FormField, FormSection, Input, Select } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { modelIdFromPath } from "@/lib/huggingface";
import type { ModelInfo } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

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
          <div className="flex items-center gap-2.5">
            <ModelLogo
              modelId={recipe.model_path ? modelIdFromPath(recipe.model_path) : "model"}
              size="md"
            />
            <Select
              value={recipe.model_path ?? ""}
              onChange={(e) => onChange({ ...recipe, model_path: e.target.value })}
              placeholder="Select a model…"
              className="flex-1"
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
          </div>
        </FormField>
      </FormSection>

      <FormSection icon={<Server className="h-4 w-4" />} title="Server">
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
              onChange={(e) => onChange({ ...recipe, port: Number(e.target.value) || undefined })}
            />
          </FormField>
        </div>

        <FormField label="Served Model Name" description="Optional — the name exposed in the API.">
          <Input
            value={recipe.served_model_name || ""}
            onChange={(e) =>
              onChange({ ...recipe, served_model_name: e.target.value || undefined })
            }
            placeholder="e.g. deepseek-v4-flash"
            icon={<Network className="h-3.5 w-3.5" />}
          />
        </FormField>
      </FormSection>
    </div>
  );
}
