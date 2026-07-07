"use client";

import { useState } from "react";
import { SquarePen } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";

export function InlineRename({
  value,
  onRename,
  label,
  className,
  textClassName,
}: {
  value: string;
  onRename: (next: string) => Promise<void>;
  label: string;
  className?: string;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={saving}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cx(
          "h-7 rounded-md border border-(--ui-accent)/40 bg-(--ui-bg) px-2 text-(--ui-fg) outline-none",
          textClassName,
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      title={`Rename ${label}`}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cx(
        "group inline-flex min-w-0 items-center gap-1.5 rounded-md text-left transition-colors hover:text-(--ui-fg)",
        className,
      )}
    >
      <span className={cx("truncate", textClassName)}>{value}</span>
      <SquarePen className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
    </button>
  );
}
