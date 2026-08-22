"use client";

import { useRef } from "react";
import { Effect } from "effect";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type ToolsCatalogue = {
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
};

export type ToolsEffectsBridgeProps = {
  catalogueEnabled: boolean;
  onCatalogueLoaded: (payload: ToolsCatalogue) => void;
};

/** One catalogue list; any failure (network, non-JSON, missing key) is empty. */
function loadCatalogueListEffect<TItem>(url: string, key: string): Effect.Effect<TItem[]> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { cache: "no-store" });
      const payload = (await response.json()) as Record<string, TItem[] | undefined>;
      return payload[key] ?? [];
    },
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.succeed([])));
}

function loadToolsCatalogueEffect(): Effect.Effect<ToolsCatalogue> {
  return Effect.all([
    loadCatalogueListEffect<ComposerSkillRef>("/api/agent/skills", "skills"),
    loadCatalogueListEffect<ComposerPromptTemplateRef>("/api/agent/prompt-templates", "templates"),
  ] as const).pipe(Effect.map(([skills, promptTemplates]) => ({ skills, promptTemplates })));
}

/** Loads the skill / prompt-template catalogues once, off the render path. */
export function ToolsEffectsBridge({
  catalogueEnabled,
  onCatalogueLoaded,
}: ToolsEffectsBridgeProps) {
  const onLoadedRef = useRef(onCatalogueLoaded);
  useMountSubscription(() => {
    if (!catalogueEnabled) return;
    let cancelled = false;
    void Effect.runPromise(
      loadToolsCatalogueEffect().pipe(
        Effect.map((payload) => {
          if (!cancelled) onLoadedRef.current(payload);
        }),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [catalogueEnabled]);
  return null;
}
