import { useCallback, useRef, useSyncExternalStore } from "react";
import { Effect } from "effect";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";

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

function loadToolsCatalogueEffect(): Effect.Effect<{
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
}> {
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

const getToolsCatalogueSnapshot = (): number => 0;

type UseToolsCatalogueEffectsOptions = {
  onLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

export function useToolsCatalogueEffects({ onLoaded }: UseToolsCatalogueEffectsOptions): void {
  const onLoadedRef = useRef(onLoaded);
  const subscribe = useCallback((_notify: () => void) => {
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
  }, []);

  useSyncExternalStore(subscribe, getToolsCatalogueSnapshot, getToolsCatalogueSnapshot);
}
