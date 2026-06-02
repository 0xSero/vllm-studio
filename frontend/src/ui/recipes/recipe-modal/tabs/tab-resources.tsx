"use client";

import { Cpu, Database, GitBranch } from "lucide-react";
import { CheckboxRow, FormField, FormSection, Input, Slider } from "@/ui";
import type { RecipeEditor } from "@/lib/types";
import { LlamacppOptionsSection } from "../llamacpp-options-section";

export function RecipeModalTabResources({
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
        <LlamacppOptionsSection
          tab="resources"
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      </div>
    );
  }

  const gpuUtil = recipe.gpu_memory_utilization ?? 0.9;

  return (
    <div className="space-y-6">
      <FormSection icon={<GitBranch className="h-4 w-4" />} title="Parallelism">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Tensor Parallel">
            <Input
              type="number"
              min={1}
              value={recipe.tp ?? recipe.tensor_parallel_size ?? 1}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  tp: Number(e.target.value),
                  tensor_parallel_size: Number(e.target.value),
                })
              }
            />
          </FormField>
          <FormField label="Pipeline Parallel">
            <Input
              type="number"
              min={1}
              value={recipe.pp ?? recipe.pipeline_parallel_size ?? 1}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  pp: Number(e.target.value),
                  pipeline_parallel_size: Number(e.target.value),
                })
              }
            />
          </FormField>
          <FormField label="Data Parallel">
            <Input
              type="number"
              min={1}
              value={recipe.data_parallel_size || ""}
              onChange={(e) =>
                onChange({ ...recipe, data_parallel_size: Number(e.target.value) || undefined })
              }
              placeholder="1"
            />
          </FormField>
        </div>

        <CheckboxRow
          checked={recipe.enable_expert_parallel || false}
          onChange={(checked) => onChange({ ...recipe, enable_expert_parallel: checked })}
          label="Expert Parallel (MoE)"
          description="Shard MoE experts across the parallel group."
        />
      </FormSection>

      <FormSection icon={<Cpu className="h-4 w-4" />} title="GPU Settings">
        <FormField label="GPU Memory Utilization">
          <div className="flex items-center gap-3">
            <Slider
              min={0}
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
      </FormSection>

      <FormSection icon={<Database className="h-4 w-4" />} title="Memory Management">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Swap Space (GB)">
            <Input
              type="number"
              value={recipe.swap_space || ""}
              onChange={(e) =>
                onChange({ ...recipe, swap_space: Number(e.target.value) || undefined })
              }
              placeholder="0"
            />
          </FormField>
          <FormField label="CPU Offload (GB)">
            <Input
              type="number"
              value={recipe.cpu_offload_gb || ""}
              onChange={(e) =>
                onChange({ ...recipe, cpu_offload_gb: Number(e.target.value) || undefined })
              }
              placeholder="0"
            />
          </FormField>
          <FormField label="GPU Blocks Override">
            <Input
              type="number"
              value={recipe.num_gpu_blocks_override || ""}
              onChange={(e) =>
                onChange({ ...recipe, num_gpu_blocks_override: Number(e.target.value) || undefined })
              }
              placeholder="Auto"
            />
          </FormField>
        </div>
      </FormSection>
    </div>
  );
}
