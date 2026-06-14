"use client";

import type { ModelInfo } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import type { EngineCapabilities } from "@/features/recipes/engine-capabilities";
import type { RecipeModalTabId } from "./tab-id";
import { RecipeModalTabCommand } from "./tab-command";
import { RecipeModalTabEnvironment } from "./tab-environment";
import { RecipeModalTabFeatures } from "./tab-features";
import { RecipeModalTabGeneral } from "./tab-general";
import { RecipeModalTabModel } from "./tab-model";
import { RecipeModalTabPerformance } from "./tab-performance";
import { RecipeModalTabResources } from "./tab-resources";

export function RecipeModalTabContent({
  activeTab,
  recipe,
  onChange,
  availableModels,
  modelServedNames,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
  envVarEntries,
  onAddEnvVar,
  onChangeEnvVar,
  onRemoveEnvVar,
  extraArgsText,
  extraArgsError,
  onExtraArgsChange,
  llamaConfigLoading,
  llamaConfigHelp,
  recipeSourceText,
  recipeSourceError,
  onRecipeSourceChange,
  onFormatRecipeSource,
  commandText,
  generatedCommand,
  hasCommandOverride,
  onCommandChange,
  onResetCommand,
}: {
  activeTab: RecipeModalTabId;
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
  capabilities: EngineCapabilities;
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
  envVarEntries: Array<{ key: string; value: string }>;
  onAddEnvVar: () => void;
  onChangeEnvVar: (index: number, field: "key" | "value", value: string) => void;
  onRemoveEnvVar: (index: number) => void;
  extraArgsText: string;
  extraArgsError: string | null;
  onExtraArgsChange: (value: string) => void;
  llamaConfigLoading: boolean;
  llamaConfigHelp: { config: string | null; error?: string | null } | null;
  recipeSourceText: string;
  recipeSourceError: string | null;
  onRecipeSourceChange: (value: string) => void;
  onFormatRecipeSource: () => void;
  commandText: string;
  generatedCommand: string;
  hasCommandOverride: boolean;
  onCommandChange: (value: string) => void;
  onResetCommand: () => void;
}) {
  switch (activeTab) {
    case "general":
      return (
        <RecipeModalTabGeneral
          recipe={recipe}
          onChange={onChange}
          availableModels={availableModels}
          modelServedNames={modelServedNames}
        />
      );
    case "model":
      return (
        <RecipeModalTabModel
          recipe={recipe}
          onChange={onChange}
          capabilities={capabilities}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "resources":
      return (
        <RecipeModalTabResources
          recipe={recipe}
          onChange={onChange}
          capabilities={capabilities}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "performance":
      return (
        <RecipeModalTabPerformance
          recipe={recipe}
          onChange={onChange}
          capabilities={capabilities}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "features":
      return (
        <RecipeModalTabFeatures
          recipe={recipe}
          onChange={onChange}
          capabilities={capabilities}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "environment":
      return (
        <RecipeModalTabEnvironment
          recipe={recipe}
          onChange={onChange}
          capabilities={capabilities}
          envVarEntries={envVarEntries}
          onAddEnvVar={onAddEnvVar}
          onChangeEnvVar={onChangeEnvVar}
          onRemoveEnvVar={onRemoveEnvVar}
          extraArgsText={extraArgsText}
          extraArgsError={extraArgsError}
          onExtraArgsChange={onExtraArgsChange}
          llamaConfigLoading={llamaConfigLoading}
          llamaConfigHelp={llamaConfigHelp}
        />
      );
    case "command":
      return (
        <RecipeModalTabCommand
          recipeSourceText={recipeSourceText}
          recipeSourceError={recipeSourceError}
          onRecipeSourceChange={onRecipeSourceChange}
          onFormatRecipeSource={onFormatRecipeSource}
          commandText={commandText}
          generatedCommand={generatedCommand}
          hasCommandOverride={hasCommandOverride}
          onCommandChange={onCommandChange}
          onResetCommand={onResetCommand}
        />
      );
  }
}
