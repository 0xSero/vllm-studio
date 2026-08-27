"use client";

import { useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  defaultAnimateLayoutChanges,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { sessionActivity, useSessionActivity } from "@/features/agent/session-index";
import type { SessionPrefs } from "@/features/agent/messages/prefs";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import { mergeActiveSessionPref } from "./helpers";
import { SidebarRail, SidebarSectionHeader } from "./nav-chrome";
import { toggleProjectPin, type PinnedNav, type PinnedNavEntry } from "./pinned";
import { ActiveSessionRow, ProjectRow, SessionRow } from "./session-rows";
import type { ActiveAgentSession } from "./types";

/** Pinned projects and sessions, in one drag-orderable rail that matches the
 *  Tasks and Projects rails exactly — same indent, same guide line, same rows. */
export function PinnedSection({
  pinned,
  activeSessions,
  prefs,
  onRemoveProject,
}: {
  pinned: PinnedNav;
  activeSessions: readonly ActiveAgentSession[];
  prefs: SessionPrefs;
  onRemoveProject: (project: ProjectEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openProjectIds, setOpenProjectIds] = useState<ReadonlySet<string>>(new Set());
  const activity = useSessionActivity();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  if (pinned.entries.length === 0) return null;

  const toggleProject = (projectId: string) =>
    setOpenProjectIds((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });

  const renderEntry = (entry: PinnedNavEntry, dragging: boolean) => {
    if (entry.kind === "project") {
      return (
        <ProjectRow
          key={entry.id}
          project={entry.project}
          open={openProjectIds.has(entry.project.id)}
          onToggle={() => toggleProject(entry.project.id)}
          activeSessions={activeSessions.filter(
            (session) => session.projectId === entry.project.id,
          )}
          prefs={prefs}
          excludedIds={pinned.renderedSessionIds}
          pinned
          onTogglePin={() => toggleProjectPin(entry.project.id, false)}
          onRemove={() => onRemoveProject(entry.project)}
          dragging={dragging}
        />
      );
    }
    if (entry.kind === "active") {
      return (
        <ActiveSessionRow
          key={entry.id}
          project={entry.project}
          session={entry.session}
          pref={mergeActiveSessionPref(entry.session, prefs)}
          activity={sessionActivity(
            [entry.session.id, entry.session.threadId],
            activity,
            entry.session.status,
            entry.session.focused,
          )}
          dragging={dragging}
          card
        />
      );
    }
    return (
      <SessionRow
        key={entry.id}
        project={entry.project}
        session={entry.session}
        pref={prefs[entry.session.id] ?? {}}
        dragging={dragging}
        card
      />
    );
  };

  const finishDrag = ({ active, over }: DragEndEvent) => {
    pinned.setDraggingId(null);
    if (over && active.id !== over.id) pinned.moveEntry(String(active.id), String(over.id));
  };

  return (
    <div
      className={`flex flex-col gap-[var(--sidebar-row-gap)] rounded-[var(--sidebar-row-radius)] transition-[background-color,box-shadow] duration-[var(--motion-fast)] ${
        pinned.dragging ? "bg-(--surface-2)/40 ring-1 ring-inset ring-(--border)" : ""
      }`}
    >
      <SidebarSectionHeader label="Pinned" open={open} onToggle={() => setOpen((v) => !v)} />
      {open ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
          onDragStart={({ active }) => pinned.setDraggingId(String(active.id))}
          onDragCancel={() => pinned.setDraggingId(null)}
          onDragEnd={finishDrag}
        >
          <SortableContext
            items={pinned.entries.map((entry) => entry.id)}
            strategy={verticalListSortingStrategy}
          >
            <SidebarRail animate={false} className="gap-1">
              {pinned.entries.map((entry) => (
                <SortablePinnedEntry key={entry.id} id={entry.id}>
                  {(dragging) => renderEntry(entry, dragging)}
                </SortablePinnedEntry>
              ))}
            </SidebarRail>
          </SortableContext>
        </DndContext>
      ) : null}
    </div>
  );
}

const animatePinnedLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting ? defaultAnimateLayoutChanges(args) : false;

function SortablePinnedEntry({
  id,
  children,
}: {
  id: string;
  children: (dragging: boolean) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: animatePinnedLayoutChanges,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className="relative touch-none"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      {children(isDragging)}
    </div>
  );
}
