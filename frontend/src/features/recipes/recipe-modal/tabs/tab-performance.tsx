"use client";

import { Clock, Database } from "lucide-react";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import type { RecipeEditor } from "@/lib/types";
import { LlamacppOptionsSection } from "../llamacpp-options-section";
import { CudaGraphsSection } from "./tab-performance/cuda-graphs-section";

export function RecipeModalTabPerformance({
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
          tab="performance"
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CudaGraphsSection recipe={recipe} onChange={onChange} />

      <FormSection icon={<Database className="h-4 w-4" />} title="KV Cache & Memory">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="KV Cache Dtype">
            <Select
              value={recipe.kv_cache_dtype || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  kv_cache_dtype: e.target.value === "auto" ? undefined : e.target.value,
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="fp8">FP8</option>
              <option value="fp8_e5m2">FP8 E5M2</option>
              <option value="fp8_e4m3">FP8 E4M3</option>
            </Select>
          </FormField>
          <FormField label="Block Size">
            <Select
              value={recipe.block_size || "16"}
              onChange={(e) =>
                onChange({ ...recipe, block_size: Number(e.target.value) || undefined })
              }
            >
              <option value="8">8</option>
              <option value="16">16</option>
              <option value="32">32</option>
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CheckboxRow
            checked={recipe.enable_prefix_caching || false}
            onChange={(checked) => onChange({ ...recipe, enable_prefix_caching: checked })}
            label="Prefix Caching"
            description="Cache shared prefixes"
          />
          <CheckboxRow
            checked={recipe.enable_chunked_prefill || false}
            onChange={(checked) => onChange({ ...recipe, enable_chunked_prefill: checked })}
            label="Chunked Prefill"
            description="Interleave prefill/decode"
          />
        </div>
      </FormSection>

      <FormSection icon={<Clock className="h-4 w-4" />} title="Scheduler & Batching">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Max Sequences">
            <Input
              type="number"
              value={recipe.max_num_seqs || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_num_seqs: Number(e.target.value) || undefined })
              }
              placeholder="256"
            />
          </FormField>
          <FormField label="Max Batched Tokens">
            <Input
              type="number"
              value={recipe.max_num_batched_tokens || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_num_batched_tokens: Number(e.target.value) || undefined })
              }
              placeholder="Auto"
            />
          </FormField>
          <FormField label="Max Paddings">
            <Input
              type="number"
              value={recipe.max_paddings || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_paddings: Number(e.target.value) || undefined })
              }
              placeholder="Auto"
            />
          </FormField>
        </div>

        <FormField label="Scheduling Policy">
          <Select
            value={recipe.scheduling_policy || ""}
            onChange={(e) =>
              onChange({
                ...recipe,
                scheduling_policy: e.target.value
                  ? (e.target.value as "fcfs" | "priority")
                  : undefined,
              })
            }
          >
            <option value="">Default</option>
            <option value="fcfs">FCFS (First Come First Serve)</option>
            <option value="priority">Priority</option>
          </Select>
        </FormField>
      </FormSection>
    </div>
  );
}
