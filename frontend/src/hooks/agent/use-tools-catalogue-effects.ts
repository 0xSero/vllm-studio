// One-shot fetch of the workspace-global plugin and skill catalogues.
//
// This used to live as a `useEffect` inside `ToolsProvider`, but our
// project-wide policy bans `useEffect` in production code; the only
// sanctioned home for genuine side effects is `src/hooks/agent/use-*-effects.ts`.
// `ToolsProvider` now calls this hook with `onLoaded` setters so the effect
// stays exactly where it has always lived (workspace-mounted), but the
// implementation is contained in this dedicated file.

import { useEffect } from "react";

import type {
  ComposerExtensionRef,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";

type UseToolsCatalogueEffectsOptions = {
  onLoaded: (payload: {
    plugins: ComposerPluginRef[];
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
    extensions: ComposerExtensionRef[];
  }) => void;
};

type ExtensionsApiResponse = {
  resources?: {
    extensions?: Array<{
      path: string;
      source: string;
      enabled: boolean;
      origin: "package" | "top-level";
      scope: "user" | "project" | "temporary";
    }>;
  };
};

function deriveExtensionName(source: string, absPath: string): string {
  if (source && source !== "auto") {
    const m = /^(?:npm|git|file|ssh|https?):(.+)$/.exec(source);
    const tail = (m?.[1] ?? source).trim();
    const last = tail.split(/[\\/]/).filter(Boolean).pop();
    if (last) return last;
  }
  const base = absPath.split(/[\\/]/).filter(Boolean).pop() ?? absPath;
  return base.replace(/\.(?:t|j)sx?$/i, "");
}

export function useToolsCatalogueEffects({ onLoaded }: UseToolsCatalogueEffectsOptions): void {
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
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
      fetch("/api/agent/extensions", { cache: "no-store" })
        .then((res) => res.json() as Promise<ExtensionsApiResponse>)
        .then((payload): ComposerExtensionRef[] =>
          (payload.resources?.extensions ?? []).map((ext) => {
            const id = ext.source && ext.source !== "auto" ? ext.source : ext.path;
            return {
              id,
              name: deriveExtensionName(ext.source, ext.path),
              source: ext.source,
              path: ext.path,
              scope: ext.scope,
              origin: ext.origin,
              enabled: ext.enabled,
            };
          }),
        )
        .catch(() => [] as ComposerExtensionRef[]),
    ]).then(([plugins, skills, promptTemplates, extensions]) => {
      if (cancelled) return;
      onLoaded({ plugins, skills, promptTemplates, extensions });
    });
    return () => {
      cancelled = true;
    };
    // Mount-once: we intentionally ignore the identity of `onLoaded`.
  }, []);
}
