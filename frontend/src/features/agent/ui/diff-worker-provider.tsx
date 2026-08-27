"use client";

import { useMemo, type ReactNode } from "react";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import { useAppStore } from "@/store";
import { THEME_BY_ID } from "@/lib/themes";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function resolvedTheme(themeId: string): "github-dark" | "github-light" {
  const background = THEME_BY_ID.get(themeId as never)?.tokens.bg ?? "#111111";
  const hex = background.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return themeId.includes("light") ? "github-light" : "github-dark";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 160 ? "github-light" : "github-dark";
}

function ThemeSync({ theme }: { theme: "github-dark" | "github-light" }) {
  const pool = useWorkerPool();
  useMountSubscription(() => {
    if (!pool) return;
    const current = pool.getDiffRenderOptions();
    if (current.theme === theme) return;
    void pool.setRenderOptions({ ...current, theme }).catch(() => undefined);
  }, [pool, theme]);
  return null;
}

export function DiffWorkerProvider({ children }: { children: ReactNode }) {
  const themeId = useAppStore((state) => state.themeId);
  const theme = resolvedTheme(themeId);
  const poolSize = useMemo(() => {
    const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4;
    return Math.max(2, Math.min(6, Math.floor(cores / 2)));
  }, []);
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () =>
          new Worker(new URL("./diff-worker.ts", import.meta.url), { type: "module" }),
        poolSize,
        totalASTLRUCacheSize: 240,
      }}
      highlighterOptions={{ theme, tokenizeMaxLineLength: 1000, useTokenTransformer: true }}
    >
      <ThemeSync theme={theme} />
      {children}
    </WorkerPoolContextProvider>
  );
}
