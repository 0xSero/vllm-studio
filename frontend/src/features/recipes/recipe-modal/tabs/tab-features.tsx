"use client";

import { Brain, Eye, MessageSquare, Settings, Wrench } from "lucide-react";
import { FormField, FormSection, SegmentedControl, type SegmentedItem } from "@/ui";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import {
  type VisionMode,
  visionForMode,
  visionModeForRecipe,
} from "@/features/recipes/recipe-vision";
import { EngineOptionsSection } from "../engine-options-section";
import { createRecipeFields } from "../recipe-fields";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabFeatures({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "features");
  return (
    <div className="space-y-6">
      <ModelInputSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <ToolCallingSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <ReasoningSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <ChatTemplatesSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Sampling & Features`}
          icon={<Settings className="h-4 w-4" />}
          options={options}
          helpText={
            capabilities.options === "llamacpp"
              ? "All llama.cpp flags are supported via Extra CLI Arguments. These cover the most-used options."
              : undefined
          }
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      ) : null}
    </div>
  );
}

type SectionProps = RecipeModalSectionProps;

const VISION_MODE_ITEMS: SegmentedItem<VisionMode>[] = [
  { id: "auto", label: "Auto" },
  { id: "enabled", label: "Enabled" },
  { id: "text", label: "Text only" },
];

const VISION_MODE_DESCRIPTIONS: Record<VisionMode, string> = {
  auto: "Detect image support from the model metadata and architecture.",
  enabled: "Advertise image input even when model metadata is incomplete.",
  text: "Keep this recipe text-only even when the model appears multimodal.",
};

function ModelInputSection({ recipe, onChange }: SectionProps) {
  const mode = visionModeForRecipe(recipe);
  return (
    <FormSection icon={<Eye className="h-4 w-4" />} title="Model Input">
      <FormField label="Image input" description={VISION_MODE_DESCRIPTIONS[mode]} asGroup>
        <SegmentedControl
          items={VISION_MODE_ITEMS}
          value={mode}
          onChange={(next) => onChange({ ...recipe, vision: visionForMode(next) })}
          size="sm"
        />
      </FormField>
    </FormSection>
  );
}

function ToolCallingSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.toolCalling) return null;
  const isVllm = capabilities.backend === "vllm";
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Wrench className="h-4 w-4" />} title="Tool Calling">
      {field.select(
        "tool_call_parser",
        "Tool Call Parser",
        <>
          <option value="">None</option>
          <optgroup label="General">
            <option value="hermes">Hermes</option>
            <option value="pythonic">Pythonic</option>
            <option value="openai">OpenAI</option>
          </optgroup>
          <optgroup label="Llama">
            <option value="llama3_json">Llama 3 JSON</option>
            <option value="llama4_json">Llama 4 JSON</option>
            <option value="llama4_pythonic">Llama 4 Pythonic</option>
          </optgroup>
          <optgroup label="DeepSeek">
            <option value="deepseek_v3">DeepSeek V3</option>
            <option value="deepseek_v31">DeepSeek V3.1</option>
            <option value="deepseek_v32">DeepSeek V3.2</option>
          </optgroup>
          <optgroup label="Qwen">
            <option value="qwen3_xml">Qwen3 XML</option>
            <option value="qwen3_coder">Qwen3 Coder</option>
          </optgroup>
          <optgroup label="GLM">
            <option value="glm45">GLM-4.5</option>
            <option value="glm47">GLM-4.7</option>
          </optgroup>
          <optgroup label="Other">
            <option value="mistral">Mistral</option>
            <option value="granite">Granite</option>
            <option value="minimax">MiniMax</option>
            <option value="kimi_k2">Kimi K2</option>
          </optgroup>
        </>,
      )}
      {isVllm ? (
        <>
          {field.input("tool_parser_plugin", "Tool Parser Plugin", {
            placeholder: "Path to custom parser module",
          })}
          {field.checkbox(
            "enable_auto_tool_choice",
            "Enable Auto Tool Choice",
            "Automatically decide when to use tools",
          )}
        </>
      ) : null}
    </FormSection>
  );
}

function ReasoningSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.reasoning) return null;
  const isVllm = capabilities.backend === "vllm";
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Brain className="h-4 w-4" />} title="Reasoning & Thinking">
      {field.select(
        "reasoning_parser",
        "Reasoning Parser",
        <>
          <option value="">None</option>
          <optgroup label="DeepSeek">
            <option value="deepseek_r1">DeepSeek R1</option>
            <option value="deepseek_v3">DeepSeek V3</option>
          </optgroup>
          <optgroup label="Others">
            <option value="qwen3">Qwen3</option>
            <option value="glm45">GLM-4.5</option>
            <option value="granite">Granite</option>
          </optgroup>
        </>,
      )}
      {isVllm ? (
        <>
          {field.input("guided_decoding_backend", "Guided Decoding Backend", {
            placeholder: "e.g., xgrammar, outlines",
          })}
          {field.checkbox(
            "enable_thinking",
            "Enable Thinking Mode",
            "Show the model's thinking process",
          )}
          {recipe.enable_thinking
            ? field.input("thinking_budget", "Thinking Budget (tokens)", {
                type: "number",
                placeholder: "1024",
              })
            : null}
        </>
      ) : null}
    </FormSection>
  );
}

function ChatTemplatesSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.chatTemplates) return null;
  const isVllm = capabilities.backend === "vllm";
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<MessageSquare className="h-4 w-4" />} title="Chat & Templates">
      <div className={isVllm ? "grid grid-cols-2 gap-3" : undefined}>
        {field.input("chat_template", "Chat Template", { placeholder: "Path or name" })}
        {isVllm
          ? field.input("response_role", "Response Role", { placeholder: "assistant" })
          : null}
      </div>
      {isVllm
        ? field.select(
            "chat_template_content_format",
            "Chat Template Format",
            <>
              <option value="auto">Auto</option>
              <option value="string">String</option>
              <option value="openai">OpenAI</option>
            </>,
            { fallback: "auto", empty: "auto" },
          )
        : null}
    </FormSection>
  );
}
