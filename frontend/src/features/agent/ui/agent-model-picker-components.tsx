"use client";

import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import { LegendList } from "@legendapp/list/react";
import { Check, ChevronDown, Search, Star } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import {
  modelChoiceSearchText,
  routeForChoice,
  type ModelChoice,
  type ModelCompany,
  type ModelRoute,
} from "./agent-model-picker-data";
import { ModelLabLogo } from "./model-lab-logo";
import { readModelFavorites, writeModelFavorites } from "./model-picker-favorites";

export function ModelPickerPanel({
  choices,
  companies,
  selectedCompany,
  onSelectCompany,
  query,
  onQueryChange,
  searchRef,
  selectedModel,
  onSelect,
  activeRoute,
  onClose,
}: {
  choices: ModelChoice[];
  companies: ModelCompany[];
  selectedCompany: string;
  onSelectCompany: (company: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  selectedModel: string;
  onSelect: (choice: ModelChoice) => void;
  activeRoute: ModelRoute | null;
  onClose: () => void;
}) {
  const [favorites, setFavorites] = useState<Set<string>>(readModelFavorites);
  const updateFavorite = useCallback((modelId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      writeModelFavorites(next);
      return next;
    });
  }, []);
  const deferredQuery = useDeferredValue(query);
  const visibleChoices = useMemo(
    () => filteredChoices(choices, selectedCompany, deferredQuery, favorites),
    [choices, deferredQuery, favorites, selectedCompany],
  );
  const searching = query.trim().length > 0;
  const renderChoice = useCallback(
    ({ item: choice }: { item: ModelChoice }) => {
      const selected = choice.model.id === selectedModel;
      const preferredRoute = routeForChoice(choice, activeRoute);
      const isFavorite = favorites.has(choice.model.id);
      return (
        <ModelChoiceRow
          choice={choice}
          selected={selected}
          showCompany={searching}
          isFavorite={isFavorite}
          disabled={!preferredRoute}
          onSelect={() => onSelect(choice)}
          onToggleFavorite={() => updateFavorite(choice.model.id)}
        />
      );
    },
    [activeRoute, favorites, onSelect, searching, selectedModel, updateFavorite],
  );
  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-[calc(var(--rad-md)-1px)]">
      {!searching ? (
        <CompanySidebar
          companies={companies}
          selectedCompany={selectedCompany}
          onSelectCompany={onSelectCompany}
        />
      ) : null}
      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col overflow-hidden bg-(--color-popover)",
          !searching && "border-l border-(--border)",
        )}
      >
        <div className="px-2 pt-2">
          <div className="flex h-8 items-center gap-2 border-b border-(--border) pb-2 transition-colors focus-within:border-(--focus-ring)">
            <Search className="h-4 w-4 shrink-0 text-(--dim) opacity-70" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search models..."
              aria-label="Search models"
              className="h-6 min-w-0 flex-1 appearance-none !border-0 bg-transparent p-0 text-[length:var(--fs-sm)] leading-6 text-(--fg) !outline-none !ring-0 placeholder:text-(--dim) focus:!border-0 focus:!outline-none focus:!ring-0 focus-visible:!outline-none focus-visible:!ring-0"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {visibleChoices.length ? (
            <LegendList
              data={visibleChoices}
              extraData={favorites}
              keyExtractor={(choice) => choice.key}
              renderItem={renderChoice}
              estimatedItemSize={40}
              className="h-full overscroll-contain p-1.5 pt-1 [scrollbar-gutter:stable]"
            />
          ) : (
            <div className="px-2 py-3 text-[length:var(--fs-xs)] text-(--dim)">
              <p>{query ? `No models match “${query}”.` : "No models are available."}</p>
              <Link
                href="/settings#models"
                onClick={onClose}
                className="mt-2 inline-flex h-7 items-center rounded-md bg-(--active) px-2 text-(--fg) hover:bg-(--hover)"
              >
                Open Models
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompanySidebar({
  companies,
  selectedCompany,
  onSelectCompany,
}: {
  companies: ModelCompany[];
  selectedCompany: string;
  onSelectCompany: (company: string) => void;
}) {
  return (
    <div className="flex w-12 shrink-0 flex-col overflow-hidden bg-(--color-panel-subtle)">
      <div className="shrink-0 border-b border-(--separator) p-1.5">
        <button
          type="button"
          role="tab"
          aria-selected={selectedCompany === "favorites"}
          aria-label="Favorites"
          title="Favorites"
          onClick={() => onSelectCompany("favorites")}
          className={cx(
            "relative flex aspect-square w-full items-center justify-center text-(--dim) transition-colors hover:text-(--fg) focus-visible:text-(--fg) focus-visible:outline-none",
            selectedCompany === "favorites" && "text-amber-400",
          )}
        >
          <Star className={cx("h-5 w-5", selectedCompany === "favorites" && "fill-current")} />
          {selectedCompany === "favorites" ? (
            <span className="absolute -right-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-l-full bg-(--accent)" />
          ) : null}
        </button>
      </div>
      <div
        role="tablist"
        aria-label="Model companies"
        className="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-1.5"
      >
        {companies.map((company) => {
          const selected = company.key === selectedCompany;
          return (
            <div key={company.key} className="relative w-full">
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={company.label}
                title={company.label}
                onClick={() => onSelectCompany(company.key)}
                className={cx(
                  "relative flex aspect-square w-full cursor-pointer items-center justify-center text-(--dim) opacity-70 transition-[color,opacity] hover:text-(--fg) hover:opacity-100 focus-visible:text-(--fg) focus-visible:opacity-100 focus-visible:outline-none",
                  selected && "text-(--fg) opacity-100",
                )}
              >
                <CompanyGlyph company={company} />
                {selected ? (
                  <span className="absolute -right-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-l-full bg-(--accent)" />
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompanyGlyph({ company }: { company: ModelCompany }) {
  return <ModelLabLogo lab={company.key} />;
}

function ModelChoiceRow({
  choice,
  selected,
  showCompany,
  isFavorite,
  disabled,
  onSelect,
  onToggleFavorite,
}: {
  choice: ModelChoice;
  selected: boolean;
  showCompany: boolean;
  isFavorite: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className={cx(
        "group/model-choice relative flex min-h-10 w-full min-w-0 items-center rounded-md transition-[background-color,color] hover:bg-(--hover) focus-within:bg-(--hover)",
        selected && "bg-(--active)",
      )}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-45"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[length:var(--fs-xs)] font-medium leading-snug text-(--fg)">
            {choice.label}
          </div>
          {showCompany || disabled ? (
            <div className="mt-1 truncate text-[length:var(--fs-xs)] font-normal leading-snug text-(--dim)/70">
              {disabled ? "No connected route" : choice.company.label}
            </div>
          ) : null}
        </div>
      </button>
      {!disabled ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={
            isFavorite ? `Remove ${choice.label} from favorites` : `Favorite ${choice.label}`
          }
          title={isFavorite ? "Remove favorite" : "Add favorite"}
          className={cx(
            "mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--dim)/70 opacity-65 transition-[background-color,color,opacity] hover:bg-(--active) hover:text-(--fg) hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) group-hover/model-choice:opacity-100",
            isFavorite && "text-amber-400 opacity-100",
          )}
        >
          <Star className={cx("h-3.5 w-3.5", isFavorite && "fill-current")} />
        </button>
      ) : null}
    </div>
  );
}

export function SimplePickerPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex h-7 items-center border-b border-(--border) px-2 text-[length:var(--fs-xs)] font-medium text-(--dim)">
        {title}
      </div>
      <div className="grid gap-0.5 pt-1">{children}</div>
    </div>
  );
}

export function SimplePickerOption({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[length:var(--fs-sm)] text-(--fg) transition-colors hover:bg-(--hover) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) disabled:opacity-45",
        selected && "bg-(--active)",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check className="h-3 w-3 shrink-0" /> : null}
    </button>
  );
}

export function ComposerPickerTrigger({
  label,
  title,
  company,
  disabled,
  open,
  notRunning,
  compact = false,
  onToggle,
}: {
  label: string;
  title: string;
  company?: ModelCompany;
  disabled: boolean;
  open: boolean;
  notRunning: boolean;
  compact?: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
      onClick={onToggle}
      disabled={disabled}
      className={cx(
        "group/model inline-flex !h-7 !min-h-7 !min-w-0 items-center justify-between gap-1.5 rounded-md bg-transparent px-1.5 text-[length:var(--fs-sm)] whitespace-nowrap text-(--fg)/78 transition-[background-color,color,transform] duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg) active:scale-[0.98] active:bg-(--active) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) disabled:opacity-60",
        compact ? "max-w-[8rem]" : "max-w-[12rem]",
        open && "bg-(--active) text-(--fg)",
      )}
      title={notRunning ? `${title} is not running` : title}
      aria-label={`${title}${notRunning ? " (not running)" : ""}`}
      aria-expanded={open}
      aria-haspopup="menu"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {company ? <CompanyGlyph company={company} /> : null}
        <span className="min-w-0 truncate text-left text-(--fg)/90">{label}</span>
        {notRunning ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--warn)" /> : null}
      </span>
      <ChevronDown className="pointer-events-none h-3 w-3 shrink-0 text-(--dim)" />
    </button>
  );
}

export function filteredChoices(
  choices: ModelChoice[],
  selectedCompany: string,
  query: string,
  favorites: ReadonlySet<string> = new Set(),
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized) {
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return choices
      .flatMap((choice) => {
        const text = modelChoiceSearchText(choice);
        let score = favorites.has(choice.model.id) ? 1000 : 0;
        for (const token of tokens) {
          const index = text.indexOf(token);
          if (index < 0) return [];
          score += index === 0 ? 100 : Math.max(1, 50 - index);
        }
        return [{ choice, score }];
      })
      .toSorted(
        (left, right) =>
          right.score - left.score || left.choice.label.localeCompare(right.choice.label),
      )
      .map(({ choice }) => choice);
  }
  return choices
    .filter((choice) =>
      selectedCompany === "favorites"
        ? favorites.has(choice.model.id)
        : choice.company.key === selectedCompany,
    )
    .toSorted(
      (left, right) =>
        Number(favorites.has(right.model.id)) - Number(favorites.has(left.model.id)) ||
        left.label.localeCompare(right.label),
    );
}

export function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
