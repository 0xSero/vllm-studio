"use client";

import { Cpu, Database, GitBranch, Settings } from "lucide-react";
import { FormField, FormSection, Input, Slider } from "@/ui";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import { createRecipeFields } from "../recipe-fields";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabResources({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "resources");
  const field = createRecipeFields(recipe, onChange);
  return (
    <div className="space-y-6">
      <ParallelismSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <GpuSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {capabilities.memoryManagement ? (
        <FormSection icon={<Database className="h-4 w-4" />} title="Memory Management">
          <div className="grid grid-cols-3 gap-3">
            {field.input("swap_space", "Swap Space (GB)", {
              type: "number",
              placeholder: "0",
            })}
            {field.input("cpu_offload_gb", "CPU Offload (GB)", {
              type: "number",
              placeholder: "0",
            })}
            {field.input("num_gpu_blocks_override", "GPU Blocks Override", {
              type: "number",
              placeholder: "Auto",
            })}
          </div>
        </FormSection>
      ) : null}
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Resource Options`}
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

function parallelSize(value: string): number {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function ParallelismSection({ recipe, onChange, capabilities }: SectionProps) {
  if (capabilities.parallelism === "none") return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<GitBranch className="h-4 w-4" />} title="Parallelism">
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Tensor Parallel">
          <Input
            type="number"
            min={1}
            value={recipe.tp ?? recipe.tensor_parallel_size ?? 1}
            onChange={(e) => {
              const size = parallelSize(e.target.value);
              onChange({ ...recipe, tp: size, tensor_parallel_size: size });
            }}
          />
        </FormField>
        <FormField label="Pipeline Parallel">
          <Input
            type="number"
            min={1}
            value={recipe.pp ?? recipe.pipeline_parallel_size ?? 1}
            onChange={(e) => {
              const size = Math.max(1, Math.floor(Number(e.target.value) || 1));
              onChange({ ...recipe, pp: size, pipeline_parallel_size: size });
            }}
          />
        </FormField>
        {capabilities.parallelism === "full"
          ? field.input("data_parallel_size", "Data Parallel", {
              type: "number",
              min: 1,
              placeholder: "1",
            })
          : null}
      </div>
      {capabilities.parallelism === "full"
        ? field.checkbox(
            "enable_expert_parallel",
            "Expert Parallel (MoE)",
            "Shard MoE experts across the parallel group.",
          )
        : null}
    </FormSection>
  );
}

function GpuSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.gpuMemoryUtil && !capabilities.visibleDevices) return null;
  const gpuUtil = recipe.gpu_memory_utilization ?? 0.9;
  return (
    <FormSection icon={<Cpu className="h-4 w-4" />} title="GPU">
      {capabilities.gpuMemoryUtil ? (
        <FormField
          asGroup
          label="GPU Memory Utilization"
          description={
            capabilities.backend === "sglang" ? "Maps to SGLang --mem-fraction-static." : undefined
          }
        >
          <div className="flex items-center gap-3">
            <Slider
              min={0.05}
              max={1}
              step={0.05}
              value={gpuUtil}
              onChange={(next) => onChange({ ...recipe, gpu_memory_utilization: next })}
              aria-label="GPU memory utilization"
            />
            <span className="atlas-num w-12 shrink-0 text-right text-sm tabular-nums">
              {Math.round(gpuUtil * 100)}%
            </span>
          </div>
        </FormField>
      ) : null}
      {capabilities.visibleDevices ? (
        <FormField label="Visible Devices">
          <Input
            type="text"
            value={recipe.visible_devices ?? recipe.cuda_visible_devices ?? ""}
            onChange={(e) =>
              onChange({
                ...recipe,
                visible_devices: e.target.value || undefined,
                cuda_visible_devices: undefined,
              })
            }
            placeholder="0,1,2,3 or all"
          />
        </FormField>
      ) : null}
    </FormSection>
  );
}
