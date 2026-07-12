"use client";

import { Search, X } from "@/ui/icon-registry";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  className?: string;
}

function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  onClear,
  className = "",
}: SearchInputProps) {
  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ui-muted)" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-full border border-(--ui-border) bg-(--surface-3) py-2 pl-10 pr-8 text-[length:var(--fs-base)] text-(--ui-fg) transition-all placeholder:text-(--hl2) focus:border-(--link)/70 focus:outline-none focus:ring-1 focus:ring-(--link)/25"
      />
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-(--ui-hover)"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5 text-(--ui-muted)" />
        </button>
      )}
    </div>
  );
}

export { SearchInput };
export type { SearchInputProps };
