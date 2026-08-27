"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Check } from "@/ui/icon-registry";
import { handleMenuKeyboard } from "@/ui";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { Folder } from "@/ui/icons";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";

type Props = {
  projects: ProjectsContextValue;
};

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}

export function QuickProjectPicker({ projects }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // The projects store seeds from localStorage synchronously, so the client
  // knows the project on its first render and the server does not. Naming it
  // during hydration mismatches, and React answers a mismatch by discarding
  // and re-rendering the subtree — here, the whole composer toolbar.
  const [hydrated, setHydrated] = useState(false);
  useMountSubscription(() => setHydrated(true), []);
  const active = hydrated ? (projects.selectedProject ?? projects.projects[0] ?? null) : null;
  useClickOutside(ref, open, () => setOpen(false));

  return (
    <div
      ref={ref}
      className="relative shrink-0"
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "inline-flex !h-auto !min-h-0 !min-w-0 max-w-[140px] items-center gap-1 rounded-sm bg-transparent px-1 py-0.5 font-mono text-[length:var(--fs-xs)] text-(--dim) transition-colors hover:text-(--fg)",
          open && "text-(--fg)",
        )}
        title={active?.name ?? "Choose project"}
        aria-label={`Project: ${active?.name ?? "none"}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{active?.name ?? "Choose project"}</span>
      </button>
      {open ? (
        <div
          className={`ui-popover-enter absolute left-0 top-full z-[80] mt-1 max-h-[280px] w-[220px] overflow-y-auto p-1 ${POPOVER_SURFACE_CLASS}`}
          role="menu"
          aria-label="Choose project"
          onKeyDown={(event) => handleMenuKeyboard(event, () => setOpen(false))}
        >
          {projects.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                projects.selectProject(project);
                setOpen(false);
              }}
              role="menuitemradio"
              aria-checked={project.id === active?.id}
              className={cx(
                "flex h-7 w-full min-w-0 items-center gap-2 rounded-[5px] px-2 text-left text-[length:var(--fs-xs)] text-(--fg) transition-[background-color,color] duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
                project.id === active?.id
                  ? "bg-(--color-selected)"
                  : "hover:bg-(--color-menu-hover)",
              )}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  project.id === active?.id ? "bg-(--accent)" : "bg-(--dim)/35",
                )}
              />
              <span className="truncate text-(--fg)">{project.name}</span>
              {project.id === active?.id ? (
                <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-(--fg)" strokeWidth={1.75} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
