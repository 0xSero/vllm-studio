"use client";

import { Zap } from "lucide-react";
import { CheckboxRow, FormField, FormSection, Input } from "@/ui";
import type { RecipeEditor } from "@/lib/types";

export function CudaGraphsSection({
  recipe,
  onChange,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
}) {
  return (
    <FormSection icon={<Zap className="h-4 w-4" />} title="CUDA Graphs & Compilation">
      <div className="grid grid-cols-2 gap-3">
        <CheckboxRow
          checked={recipe.enforce_eager || false}
          onChange={(checked) => onChange({ ...recipe, enforce_eager: checked })}
          label="Enforce Eager Mode"
          description="Disables CUDA graphs for debugging"
        />
        <CheckboxRow
          checked={recipe.disable_cuda_graph || false}
          onChange={(checked) => onChange({ ...recipe, disable_cuda_graph: checked })}
          label="Disable CUDA Graph"
          description="Skip graph capture for dynamic shapes"
        />
        <CheckboxRow
          checked={recipe.use_v2_block_manager || false}
          onChange={(checked) => onChange({ ...recipe, use_v2_block_manager: checked })}
          label="v2 Block Manager"
          description="New memory management"
        />
        <CheckboxRow
          checked={recipe.disable_custom_all_reduce || false}
          onChange={(checked) => onChange({ ...recipe, disable_custom_all_reduce: checked })}
          label="Disable Custom AllReduce"
          description="Use default NCCL collectives"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="CUDA Graph Max Batch Size">
          <Input
            type="number"
            value={recipe.cuda_graph_max_bs || ""}
            onChange={(e) =>
              onChange({ ...recipe, cuda_graph_max_bs: Number(e.target.value) || undefined })
            }
            placeholder="Default"
          />
        </FormField>
        <FormField label="Compilation Config">
          <Input
            type="text"
            value={recipe.compilation_config || ""}
            onChange={(e) => onChange({ ...recipe, compilation_config: e.target.value || undefined })}
            placeholder={`e.g., {"level": 3}`}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
