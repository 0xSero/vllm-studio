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

function loadCatalogueListEffect<TItem>(url: string, key: string): Effect.Effect<TItem[]> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { cache: "no-store" }),
      catch: (error) => error,
    });
    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Record<string, TItem[] | undefined>>,
      catch: (error) => error,
    });
    return payload[key] ?? [];
  }).pipe(Effect.catch(() => Effect.succeed([])));
}

function loadToolsCatalogueEffect(): Effect.Effect<ToolsCatalogue> {
  return Effect.gen(function* () {
    const [skills, promptTemplates] = yield* Effect.all([
      loadCatalogueListEffect<ComposerSkillRef>("/api/agent/skills", "skills"),
      loadCatalogueListEffect<ComposerPromptTemplateRef>(
        "/api/agent/prompt-templates",
        "templates",
      ),
    ] as const);
    return { skills, promptTemplates };
  });
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
