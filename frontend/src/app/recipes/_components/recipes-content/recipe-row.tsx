// CRITICAL
"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { MoreVertical, Pin, PinOff, Play, Square } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import {
  SettingsButton,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type StatusTone,
} from "@/components/settings-primitives";
import { formatBackendLabel } from "../../recipe-labels";

type Props = {
  recipe: RecipeWithStatus;
  isPinned: boolean;
  isMenuOpen: boolean;
  launchDisabled: boolean;
  onTogglePin: (recipeId: string) => void;
  onToggleMenu: (recipeId: string) => void;
  onLaunch: (recipeId: string) => void;
  onStop: () => void;
  onEdit: (recipe: RecipeWithStatus) => void;
  onRequestDelete: (recipeId: string) => void;
};

function statusTone(status: string): StatusTone {
  if (status === "running") return "good";
  if (status === "starting") return "info";
  if (status === "error") return "danger";
  return "default";
}

export const RecipeRow = memo(function RecipeRow({
  recipe,
  isPinned,
  isMenuOpen,
  launchDisabled,
  onTogglePin,
  onToggleMenu,
  onLaunch,
  onStop,
  onEdit,
  onRequestDelete,
}: Props) {
  const handleTogglePin = useCallback(() => onTogglePin(recipe.id), [onTogglePin, recipe.id]);
  const handleLaunch = useCallback(() => onLaunch(recipe.id), [onLaunch, recipe.id]);
  const handleToggleMenu = useCallback(
    (e?: MouseEvent<HTMLButtonElement>) => {
      e?.stopPropagation();
      onToggleMenu(recipe.id);
    },
    [onToggleMenu, recipe.id],
  );
  const handleEdit = useCallback(() => onEdit(recipe), [onEdit, recipe]);
  const handleRequestDelete = useCallback(
    () => onRequestDelete(recipe.id),
    [onRequestDelete, recipe.id],
  );

  const tp = recipe.tp || recipe.tensor_parallel_size || 1;
  const pp = recipe.pp || recipe.pipeline_parallel_size || 1;
  const status = recipe.status || "stopped";
  const modelName =
    recipe.served_model_name || recipe.model_path.split("/").pop() || recipe.model_path;

  return (
    <SettingsRow
      label={recipe.name}
      description={`${modelName} · ${formatBackendLabel(recipe.backend)} · tp/pp ${tp}/${pp}`}
      value={<SettingsValue mono>{recipe.model_path}</SettingsValue>}
      status={<StatusPill tone={statusTone(status)}>{status}</StatusPill>}
      actions={
        <>
          <SettingsButton onClick={handleTogglePin} title={isPinned ? "Unpin" : "Pin"}>
            {isPinned ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
          </SettingsButton>
          {status === "running" ? (
            <SettingsButton onClick={onStop} tone="danger" title="Stop">
              <Square className="h-3 w-3" />
            </SettingsButton>
          ) : (
            <SettingsButton onClick={handleLaunch} disabled={launchDisabled} title="Launch">
              <Play className="h-3 w-3" />
            </SettingsButton>
          )}
          <div className="relative">
            <SettingsButton onClick={() => handleToggleMenu()} title="Actions">
              <MoreVertical className="h-3 w-3" />
            </SettingsButton>
            {isMenuOpen ? (
              <div className="absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-lg border border-(--border) bg-(--surface) shadow-lg">
                <button
                  onClick={handleEdit}
                  className="w-full px-3 py-2 text-left text-[12px] hover:bg-(--hover)"
                >
                  Edit
                </button>
                <button
                  onClick={handleRequestDelete}
                  className="w-full px-3 py-2 text-left text-[12px] text-(--err) hover:bg-(--err)/10"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </>
      }
    />
  );
});
