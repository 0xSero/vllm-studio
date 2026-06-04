// One-shot fetch of the workspace-global plugin and skill catalogues.

import { useCallback, useRef, useSyncExternalStore } from "react";

import type {
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";

type UseToolsCatalogueEffectsOptions = {
  onLoaded: (payload: {
    plugins: ComposerPluginRef[];
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

export function useToolsCatalogueEffects({ onLoaded }: UseToolsCatalogueEffectsOptions): void {
  const onLoadedRef = useRef(onLoaded);
  const subscribe = useCallback((_notify: () => void) => {
    let cancelled = false;
    void loadToolsCatalogue().then((payload) => {
      if (!cancelled) onLoadedRef.current(payload);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useSyncExternalStore(subscribe, getToolsCatalogueSnapshot, getToolsCatalogueSnapshot);
}

async function loadToolsCatalogue(): Promise<{
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
}> {
  const [plugins, skills, promptTemplates] = await Promise.all([
    fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ plugins?: ComposerPluginRef[] }>)
      .then((payload) => payload.plugins ?? [])
      .catch(() => [] as ComposerPluginRef[]),
    fetch("/api/agent/skills", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ skills?: ComposerSkillRef[] }>)
      .then((payload) => payload.skills ?? [])
      .catch(() => [] as ComposerSkillRef[]),
    fetch("/api/agent/prompt-templates", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ templates?: ComposerPromptTemplateRef[] }>)
      .then((payload) => payload.templates ?? [])
      .catch(() => [] as ComposerPromptTemplateRef[]),
  ]);

  return { plugins, skills, promptTemplates };
}

const getToolsCatalogueSnapshot = (): number => 0;
