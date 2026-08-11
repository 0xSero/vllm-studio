"use client";

import { Clock, Database, Settings, Zap } from "@/ui/icon-registry";
import { FormSection } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import { createRecipeFields } from "../recipe-fields";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabPerformance({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "performance");
  return (
    <div className="space-y-6">
      {capabilities.cudaGraphs ? <CudaGraphsSection recipe={recipe} onChange={onChange} /> : null}
      <KvCacheSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <SchedulerSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Performance Options`}
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

function KvCacheSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.kvCacheDtype && !capabilities.blockSize && !capabilities.caching) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Database className="h-4 w-4" />} title="KV Cache & Memory">
      <div className="grid grid-cols-2 gap-3">
        {capabilities.kvCacheDtype
          ? field.select(
              "kv_cache_dtype",
              "KV Cache Dtype",
              <>
                <option value="auto">Auto</option>
                <option value="fp8">FP8</option>
                <option value="fp8_e5m2">FP8 E5M2</option>
                <option value="fp8_e4m3">FP8 E4M3</option>
              </>,
              { fallback: "auto", empty: "auto" },
            )
          : null}
        {capabilities.blockSize
          ? field.select(
              "block_size",
              "Block Size",
              <>
                <option value="8">8</option>
                <option value="16">16</option>
                <option value="32">32</option>
              </>,
              { fallback: "16", numeric: true },
            )
          : null}
      </div>
      {capabilities.caching ? (
        <div className="grid grid-cols-2 gap-3">
          {field.checkbox("enable_prefix_caching", "Prefix Caching", "Cache shared prefixes")}
          {field.checkbox("enable_chunked_prefill", "Chunked Prefill", "Interleave prefill/decode")}
        </div>
      ) : null}
    </FormSection>
  );
}

function SchedulerSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.maxNumSeqs && !capabilities.schedulerAdvanced) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Clock className="h-4 w-4" />} title="Scheduler & Batching">
      <div className="grid grid-cols-3 gap-3">
        {capabilities.maxNumSeqs
          ? field.input("max_num_seqs", "Max Sequences", {
              type: "number",
              placeholder: "256",
              description: capabilities.backend === "sglang" ? "--max-running-requests" : undefined,
            })
          : null}
        {capabilities.schedulerAdvanced ? (
          <>
            {field.input("max_num_batched_tokens", "Max Batched Tokens", {
              type: "number",
              placeholder: "Auto",
            })}
            {field.input("max_paddings", "Max Paddings", {
              type: "number",
              placeholder: "Auto",
            })}
          </>
        ) : null}
      </div>
      {capabilities.schedulerAdvanced
        ? field.select(
            "scheduling_policy",
            "Scheduling Policy",
            <>
              <option value="">Default</option>
              <option value="fcfs">FCFS (First Come First Serve)</option>
              <option value="priority">Priority</option>
            </>,
          )
        : null}
    </FormSection>
  );
}

function CudaGraphsSection({
  recipe,
  onChange,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
}) {
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Zap className="h-4 w-4" />} title="CUDA Graphs & Compilation">
      <div className="grid grid-cols-2 gap-3">
        {field.checkbox("use_v2_block_manager", "v2 Block Manager", "New memory management")}
        {field.checkbox(
          "disable_custom_all_reduce",
          "Disable Custom AllReduce",
          "Use default NCCL collectives",
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field.input("cuda_graph_max_bs", "CUDA Graph Max Batch Size", {
          type: "number",
          placeholder: "Default",
        })}
        {field.input("compilation_config", "Compilation Config", {
          placeholder: `e.g., {"level": 3}`,
        })}
      </div>
    </FormSection>
  );
}
