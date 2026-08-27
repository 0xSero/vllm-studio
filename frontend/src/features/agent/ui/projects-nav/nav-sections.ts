"use client";

import { useState, type DragEvent } from "react";
import {
  setWorkbenchSidebar,
  useWorkbenchPreferences,
} from "@/features/workbench/controller-state";

export type SectionId = "projects" | "chats";

const SECTION_IDS: readonly SectionId[] = ["projects", "chats"];

function sectionOrder(value: readonly string[]): SectionId[] {
  const valid = value.filter((entry): entry is SectionId =>
    SECTION_IDS.includes(entry as SectionId),
  );
  for (const id of SECTION_IDS) if (!valid.includes(id)) valid.push(id);
  return valid;
}

export function useNavSectionOrder(): {
  order: SectionId[];
  headerDragProps: (id: SectionId) => {
    draggable: true;
    onDragStart: () => void;
    onDragEnd: () => void;
  };
  sectionDropProps: (id: SectionId) => {
    onDragOver: (event: DragEvent) => void;
    onDrop: () => void;
  };
} {
  const order = sectionOrder(useWorkbenchPreferences().sidebarSectionOrder);
  const [dragId, setDragId] = useState<SectionId | null>(null);

  const moveBefore = (dragged: SectionId, target: SectionId) => {
    if (dragged === target) return;
    const next = order.filter((entry) => entry !== dragged);
    next.splice(next.indexOf(target), 0, dragged);
    setWorkbenchSidebar({ sidebarSectionOrder: next });
  };

  return {
    order,
    headerDragProps: (id) => ({
      draggable: true,
      onDragStart: () => setDragId(id),
      onDragEnd: () => setDragId(null),
    }),
    sectionDropProps: (id) => ({
      onDragOver: (event: DragEvent) => {
        if (dragId && dragId !== id) event.preventDefault();
      },
      onDrop: () => {
        if (dragId) moveBefore(dragId, id);
        setDragId(null);
      },
    }),
  };
}
