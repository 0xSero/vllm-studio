"use client";

import { Check, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "@/store";
import {
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  THEMES,
  type FontFamilyId,
  type FontSizeId,
  type ThemeId,
  type ThemeMeta,
} from "@/lib/themes";
import {
  EmptySafeNotice,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/components/settings-primitives";

export function AppearanceSettings() {
  const themeId = useAppStore((s) => s.themeId);
  const setThemeId = useAppStore((s) => s.setThemeId);
  const fontFamilyId = useAppStore((s) => s.fontFamilyId);
  const setFontFamilyId = useAppStore((s) => s.setFontFamilyId);
  const fontSizeId = useAppStore((s) => s.fontSizeId);
  const setFontSizeId = useAppStore((s) => s.setFontSizeId);
  const [query, setQuery] = useState("");

  const currentTheme = THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
  const filteredThemes = useMemo(() => filterThemes(query), [query]);
  const visibleThemes = filteredThemes.length
    ? filteredThemes
    : [currentTheme, ...THEMES.slice(0, 5)].filter(uniqueTheme);

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Typography"
        description="Global font decisions stay compact and code-native."
      >
        <SettingsRow
          label="Font family"
          description="Applied through theme variables across dashboard and agent surfaces."
          control={
            <SegmentedOptions
              value={fontFamilyId}
              options={FONT_FAMILY_OPTIONS.map((option) => ({
                id: option.id,
                label: option.label,
              }))}
              onChange={(value) => setFontFamilyId(value as FontFamilyId)}
            />
          }
          status={
            <StatusPill tone="info">{labelFor(FONT_FAMILY_OPTIONS, fontFamilyId)}</StatusPill>
          }
        />
        <SettingsRow
          label="Text scale"
          description="Resizes interface numbers and row text without changing the layout model."
          control={
            <SegmentedOptions
              value={fontSizeId}
              options={FONT_SIZE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
              onChange={(value) => setFontSizeId(value as FontSizeId)}
            />
          }
          status={<StatusPill tone="info">{labelFor(FONT_SIZE_OPTIONS, fontSizeId)}</StatusPill>}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Theme"
        description="Uses the existing token system; the settings layout only consumes variables."
        actions={<ThemeSwatches theme={currentTheme} />}
      >
        <SettingsRow
          label="Current theme"
          description={currentTheme.description}
          value={<SettingsValue>{currentTheme.name}</SettingsValue>}
          status={<StatusPill tone="good">active</StatusPill>}
        />
        <SettingsRow
          label="Search themes"
          description="Filter the library while keeping useful fallback rows visible."
          control={
            <SettingsInput
              value={query}
              placeholder="Search by name, group, or description"
              onChange={setQuery}
            />
          }
          actions={
            query ? (
              <SettingsButton onClick={() => setQuery("")} title="Clear theme search">
                <X className="h-3 w-3" />
              </SettingsButton>
            ) : (
              <Search className="h-3.5 w-3.5 text-(--dim)" />
            )
          }
          status={<StatusPill>{filteredThemes.length || THEMES.length} shown</StatusPill>}
        />

        {filteredThemes.length === 0 ? (
          <SettingsRow
            label="Search fallback"
            description="No exact theme match, so the picker keeps useful defaults visible."
            value={
              <EmptySafeNotice>
                Showing the active theme and the first five defaults. Clear search to restore the
                full library.
              </EmptySafeNotice>
            }
            status={<StatusPill tone="warning">no blank state</StatusPill>}
          />
        ) : null}

        <div className="max-h-[46vh] overflow-y-auto">
          {visibleThemes.map((theme) => (
            <ThemeRow
              key={theme.id}
              theme={theme}
              active={theme.id === themeId}
              onSelect={() => setThemeId(theme.id as ThemeId)}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}

function SegmentedOptions({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
              active ? "bg-(--fg) text-(--bg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ThemeRow({
  theme,
  active,
  onSelect,
}: {
  theme: ThemeMeta;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <SettingsRow
      label={theme.name}
      description={`${theme.group} · ${theme.description}`}
      value={<ThemeSwatches theme={theme} />}
      status={
        <StatusPill tone={active ? "good" : "default"}>
          {active ? "active" : "available"}
        </StatusPill>
      }
      actions={
        <SettingsButton onClick={onSelect} disabled={active} tone={active ? "default" : "primary"}>
          {active ? <Check className="h-3 w-3" /> : "Use"}
        </SettingsButton>
      }
    />
  );
}

function ThemeSwatches({ theme }: { theme: ThemeMeta }) {
  return (
    <div className="flex items-center gap-1.5">
      {theme.swatches.map((color, index) => (
        <span
          key={`${theme.id}-${index}`}
          className="h-3.5 w-3.5 rounded-full border border-white/15 ring-1 ring-black/10"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function filterThemes(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return THEMES;
  return THEMES.filter((theme) => {
    const haystack = `${theme.name} ${theme.group} ${theme.description}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

function uniqueTheme(theme: ThemeMeta, index: number, themes: ThemeMeta[]) {
  return themes.findIndex((candidate) => candidate.id === theme.id) === index;
}

function labelFor<T extends { id: string; label: string }>(options: T[], id: string) {
  return options.find((option) => option.id === id)?.label ?? "Custom";
}
