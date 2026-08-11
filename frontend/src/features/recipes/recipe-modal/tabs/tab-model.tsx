"use client";

import { Boxes, Layers, Settings } from "lucide-react";
import { FormSection } from "@/ui";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import { createRecipeFields } from "../recipe-fields";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabModel({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "model");
  return (
    <div className="space-y-6">
      <ContextSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <WeightsSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Model Options`}
          icon={<Settings className="h-4 w-4" />}
          options={options}
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      ) : null}
    </div>
  );
}

type SectionProps = RecipeModalSectionProps;

function ContextSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.contextLength && !capabilities.seed) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Layers className="h-4 w-4" />} title="Model & Context">
      <div className="grid grid-cols-2 gap-3">
        {capabilities.contextLength
          ? field.input("max_model_len", "Context Length", {
              type: "number",
              placeholder: capabilities.backend === "llamacpp" ? "8192" : "32768",
            })
          : null}
        {capabilities.seed
          ? field.input("seed", "Seed", { type: "number", placeholder: "Random" })
          : null}
      </div>
    </FormSection>
  );
}

function WeightsSection({ recipe, onChange, capabilities }: SectionProps) {
  if (
    !capabilities.advancedModelLoading &&
    !capabilities.quantization &&
    !capabilities.trustRemoteCode
  )
    return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Boxes className="h-4 w-4" />} title="Weights & Quantization">
      {capabilities.advancedModelLoading ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {field.input("tokenizer", "Tokenizer", { placeholder: "Path or name" })}
            {field.select(
              "tokenizer_mode",
              "Tokenizer Mode",
              <>
                <option value="auto">Auto</option>
                <option value="slow">Slow</option>
                <option value="mistral">Mistral</option>
              </>,
              { fallback: "auto", empty: "auto" },
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field.input("revision", "Revision", { placeholder: "e.g., main" })}
            {field.input("load_format", "Load Format", { placeholder: "auto, safetensors" })}
          </div>
          {field.input("quantization_param_path", "Quantization Param Path", {
            placeholder: "Path to calibration file",
          })}
        </>
      ) : null}
      {capabilities.quantization ? (
        <div className="grid grid-cols-2 gap-3">
          {field.input("quantization", "Quantization", { placeholder: "awq, gptq, fp8" })}
          {field.select(
            "dtype",
            "Dtype",
            <>
              <option value="auto">Auto</option>
              <option value="float16">float16</option>
              <option value="bfloat16">bfloat16</option>
              <option value="float32">float32</option>
            </>,
            { fallback: "auto", empty: "auto" },
          )}
        </div>
      ) : null}
      {capabilities.trustRemoteCode
        ? field.checkbox(
            "trust_remote_code",
            "Trust Remote Code",
            "Allow the model repo to execute custom modeling code.",
          )
        : null}
    </FormSection>
  );
}
