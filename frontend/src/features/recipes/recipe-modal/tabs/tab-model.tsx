"use client";

import { Layers } from "lucide-react";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { LlamacppOptionsSection } from "../llamacpp-options-section";

export function RecipeModalTabModel({
  recipe,
  onChange,
  isLlamacpp,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  isLlamacpp: boolean;
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
}) {
  if (isLlamacpp) {
    return (
      <div className="space-y-6">
        <FormSection icon={<Layers className="h-4 w-4" />} title="Model & Context">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Context Size">
              <Input
                type="number"
                value={recipe.max_model_len || ""}
                onChange={(e) =>
                  onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })
                }
                placeholder="8192"
              />
            </FormField>
            <FormField label="Seed">
              <Input
                type="number"
                value={recipe.seed || ""}
                onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
                placeholder="Random"
              />
            </FormField>
          </div>
        </FormSection>

        <LlamacppOptionsSection
          tab="model"
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FormSection icon={<Layers className="h-4 w-4" />} title="Model Loading">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Max Model Length">
            <Input
              type="number"
              value={recipe.max_model_len || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })
              }
              placeholder="32768"
            />
          </FormField>
          <FormField label="Seed">
            <Input
              type="number"
              value={recipe.seed || ""}
              onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
              placeholder="Random"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tokenizer">
            <Input
              type="text"
              value={recipe.tokenizer || ""}
              onChange={(e) => onChange({ ...recipe, tokenizer: e.target.value || undefined })}
              placeholder="Path or name"
            />
          </FormField>
          <FormField label="Tokenizer Mode">
            <Select
              value={recipe.tokenizer_mode || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  tokenizer_mode:
                    e.target.value === "auto"
                      ? undefined
                      : (e.target.value as "auto" | "slow" | "mistral"),
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="slow">Slow</option>
              <option value="mistral">Mistral</option>
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Revision">
            <Input
              type="text"
              value={recipe.revision || ""}
              onChange={(e) => onChange({ ...recipe, revision: e.target.value || undefined })}
              placeholder="e.g., main"
            />
          </FormField>
          <FormField label="Code Revision">
            <Input
              type="text"
              value={recipe.code_revision || ""}
              onChange={(e) => onChange({ ...recipe, code_revision: e.target.value || undefined })}
              placeholder="Optional"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Load Format">
            <Input
              type="text"
              value={recipe.load_format || ""}
              onChange={(e) => onChange({ ...recipe, load_format: e.target.value || undefined })}
              placeholder="auto, safetensors"
            />
          </FormField>
          <FormField label="Quantization">
            <Input
              type="text"
              value={recipe.quantization || ""}
              onChange={(e) => onChange({ ...recipe, quantization: e.target.value || undefined })}
              placeholder="awq, gptq, fp8"
            />
          </FormField>
        </div>

        <FormField label="Quantization Param Path">
          <Input
            type="text"
            value={recipe.quantization_param_path || ""}
            onChange={(e) =>
              onChange({ ...recipe, quantization_param_path: e.target.value || undefined })
            }
            placeholder="Path to calibration file"
          />
        </FormField>

        <FormField label="Dtype">
          <Select
            value={recipe.dtype || "auto"}
            onChange={(e) =>
              onChange({ ...recipe, dtype: e.target.value === "auto" ? undefined : e.target.value })
            }
          >
            <option value="auto">Auto</option>
            <option value="float16">float16</option>
            <option value="bfloat16">bfloat16</option>
            <option value="float32">float32</option>
          </Select>
        </FormField>

        <CheckboxRow
          checked={recipe.trust_remote_code || false}
          onChange={(checked) => onChange({ ...recipe, trust_remote_code: checked })}
          label="Trust Remote Code"
          description="Allow the model repo to execute custom modeling code."
        />
      </FormSection>
    </div>
  );
}
