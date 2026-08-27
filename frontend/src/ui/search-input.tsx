"use client";

import { forwardRef, type KeyboardEventHandler } from "react";
import { Search, X } from "@/ui/icon-registry";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  className?: string;
  "aria-label"?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder = "Search...",
    onClear,
    className = "",
    "aria-label": ariaLabel,
    onKeyDown,
  },
  ref,
) {
  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
  };

  return (
    <div className={`relative min-w-0 ${className}`}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)"
      />
      <input
        ref={ref}
        type="text"
        data-ui-control="field"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-[var(--control-height)] w-full rounded-[5px] border border-(--ui-separator) bg-(--ui-surface) pl-8 pr-8 text-[length:var(--fs-sm)] text-(--ui-fg) transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-(--ui-muted)/70 hover:border-(--ui-border-heavy) focus:border-(--ui-border-heavy) focus:bg-(--ui-bg) focus:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)"
      />
      {value && (
        <button
          type="button"
          data-ui-control="compact"
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] hover:bg-(--ui-hover) hover:text-(--ui-fg) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5 text-(--ui-muted)" />
        </button>
      )}
    </div>
  );
});

export { SearchInput };
export type { SearchInputProps };
