"use client";

import Link from "next/link";
import { ListGroup, RowValue, StatusPill, EmptySafeNotice } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { ExternalLink } from "@/ui/icon-registry";
import { modelIdFromPath } from "@/lib/huggingface";
import type { RecipeWithStatus } from "@/lib/types";
import type { ConfigureState } from "./use-configure";
import { InlineRename } from "./inline-rename";

const recipeFacts = (recipe: RecipeWithStatus): string =>
  [recipe.backend, recipe.served_model_name].filter(Boolean).join(" · ");

export function ModelsSection({ state }: { state: ConfigureState }) {
  return (
    <div className="space-y-4">
      <ListGroup
        title="Model names"
        description="Rename how each saved model appears across Local Studio. The served model id stays unchanged for API clients."
      >
        {state.recipes.map((recipe) => (
          <div
            key={recipe.id}
            className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-(--ui-hover)/35"
          >
            <ModelLogo modelId={modelIdFromPath(recipe.model_path)} size="sm" />
            <div className="min-w-0 flex-1">
              <InlineRename
                value={recipe.name}
                label={`model ${recipe.name}`}
                onRename={(name) => state.renameRecipe(recipe, name)}
                textClassName="text-[length:var(--fs-base)] font-medium text-(--ui-fg)"
              />
              <p className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
                {recipeFacts(recipe)}
              </p>
            </div>
            {recipe.status === "running" ? <StatusPill tone="good">running</StatusPill> : null}
            <div className="hidden min-w-0 max-w-[45%] shrink sm:block">
              <RowValue mono dim truncate>
                {recipe.model_path}
              </RowValue>
            </div>
          </div>
        ))}
        {state.recipes.length === 0 ? (
          <EmptySafeNotice>
            No saved models yet. Add one from the Models page and it becomes renamable here.
          </EmptySafeNotice>
        ) : null}
      </ListGroup>
      <Link
        href="/recipes"
        className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--ui-accent) hover:underline"
      >
        Open the full model library
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
