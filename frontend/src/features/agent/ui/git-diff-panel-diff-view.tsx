"use client";

import { CodeView, FileDiff } from "@pierre/diffs/react";
import type { CodeViewDiffItem } from "@pierre/diffs";
import { useAppStore } from "@/store";
import { THEME_BY_ID, type ThemeId } from "@/lib/themes";
import type { DiffViewMode } from "@/features/agent/ui/git-diff-panel-model";

const DIFF_SURFACE_CSS = `
[data-diffs-header],
[data-diff],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--color-panel) !important;
  --diffs-light-bg: var(--color-panel) !important;
  --diffs-dark-bg: var(--color-panel) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: var(--color-panel);
  --diffs-bg-hover-override: var(--color-surface-hover);
  --diffs-bg-addition-override: var(--color-diff-added-bg);
  --diffs-bg-deletion-override: var(--color-diff-removed-bg);
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  min-height: 32px !important;
  background: var(--color-header) !important;
  border-color: var(--border) !important;
  font-family: var(--font-sans) !important;
  font-size: var(--fs-xs) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 24px !important;
  margin-block: 0 !important;
  background: var(--color-panel) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-expand-button] {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  overflow: hidden !important;
  clip-path: inset(50%) !important;
  border: 0 !important;
}

[data-title] {
  color: var(--fg) !important;
}

[data-code] {
  font-size: var(--fs-xs) !important;
  line-height: 1.5 !important;
}

[data-diff],
[data-file] {
  transition: opacity 150ms ease-out;
}

@starting-style {
  [data-diff],
  [data-file] {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-diff],
  [data-file] {
    transition: none;
  }
}
`;

function themeType(themeId: ThemeId): "light" | "dark" {
  const background = THEME_BY_ID.get(themeId)?.tokens.bg ?? "#111111";
  const hex = background.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return themeId.includes("light") ? "light" : "dark";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 160 ? "light" : "dark";
}

export function DiffFileList({
  files,
  viewMode,
  onViewMode,
}: {
  files: CodeViewDiffItem[];
  viewMode: DiffViewMode;
  onViewMode: (mode: DiffViewMode) => void;
}) {
  const themeId = useAppStore((state) => state.themeId);
  const resolvedThemeType = themeType(themeId);

  return (
    <div className="flex min-h-0 flex-1 flex-col font-mono text-[length:var(--fs-xs)]">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-(--border)/60 bg-(--color-panel) px-1.5 py-1">
        <DiffModeButton active={viewMode === "unified"} onClick={() => onViewMode("unified")}>
          Unified
        </DiffModeButton>
        <DiffModeButton active={viewMode === "split"} onClick={() => onViewMode("split")}>
          Side by side
        </DiffModeButton>
      </div>
      <CodeView
        items={files}
        className="min-h-0 flex-1 overflow-auto outline-none"
        options={{
          diffStyle: viewMode === "split" ? "split" : "unified",
          lineDiffType: "none",
          overflow: "scroll",
          stickyHeaders: true,
          theme: { dark: "github-dark", light: "github-light" },
          themeType: resolvedThemeType,
          unsafeCSS: DIFF_SURFACE_CSS,
          itemMetrics: {
            diffHeaderHeight: 32,
            hunkSeparatorHeight: 24,
            spacing: 0,
            paddingTop: 0,
            paddingBottom: 8,
          },
          layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
        }}
      />
    </div>
  );
}

export function PierreInlineDiff({ files }: { files: CodeViewDiffItem[] }) {
  const themeId = useAppStore((state) => state.themeId);
  const resolvedThemeType = themeType(themeId);

  return files.map(({ id, fileDiff }) => (
    <FileDiff
      key={id}
      fileDiff={fileDiff}
      className="block min-w-0"
      options={{
        collapsed: false,
        diffStyle: "unified",
        lineDiffType: "none",
        overflow: "wrap",
        theme: { dark: "github-dark", light: "github-light" },
        themeType: resolvedThemeType,
        unsafeCSS: DIFF_SURFACE_CSS,
      }}
    />
  ));
}

function DiffModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 rounded px-2 text-[length:var(--fs-xs)] ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}
