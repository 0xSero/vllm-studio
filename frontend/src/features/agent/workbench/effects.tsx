"use client";

import { useState, type ComponentType } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import { useProjectsStore } from "@/features/agent/projects/store";
import { useToolsStore } from "@/features/agent/tools/store";

type CatalogueBridge = ComponentType<{
  catalogueEnabled: boolean;
  onCatalogueLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
}>;

let bridgePromise: Promise<CatalogueBridge> | null = null;

export function WorkbenchEffects() {
  const [Bridge, setBridge] = useState<CatalogueBridge | null>(null);
  useMountSubscription(() => {
    useProjectsStore.getState().initialize();
    useToolsStore.getState().initialize();
    if (Bridge) return;
    let cancelled = false;
    bridgePromise ??= import("@/features/agent/tools/effects-bridge").then(
      (module) => module.ToolsEffectsBridge,
    );
    void bridgePromise.then((component) => {
      if (!cancelled) setBridge(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, [Bridge]);
  return Bridge ? (
    <Bridge
      catalogueEnabled
      onCatalogueLoaded={({ skills, promptTemplates }) =>
        useToolsStore.getState().setCatalogues({ skills, promptTemplates })
      }
    />
  ) : null;
}
