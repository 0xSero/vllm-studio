"use client";

import { useState, type DragEvent } from "react";
import { readStoredJson, writeStored } from "@/lib/storage";

export type SectionId = "projects" | "tasks" | "terminals";

const SECTION_IDS: SectionId[] = ["projects", "tasks", "terminals"];
const NAV_SECTION_ORDER_KEY = "local-studio.agent.nav-section-order.v1";

function readSectionOrder(): SectionId[] {
  return readStoredJson(NAV_SECTION_ORDER_KEY, [...SECTION_IDS], (value) => {
    if (!Array.isArray(value)) return null;
    const valid = value.filter((entry): entry is SectionId =>
      SECTION_IDS.includes(entry as SectionId),
    );
    if (valid.length === 0) return null;
    // Tolerate orders saved before new sections existed.
    for (const id of SECTION_IDS) if (!valid.includes(id)) valid.push(id);
    return valid;
  });
}

function writeSectionOrder(order: readonly SectionId[]): void {
  writeStored(NAV_SECTION_ORDER_KEY, JSON.stringify([...order]));
}

/** Drag-to-reorder for the top-level sidebar sections. The header is the drag
 *  handle; the section body is the drop target. */
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
  const [order, setOrder] = useState(readSectionOrder);
  const [dragId, setDragId] = useState<SectionId | null>(null);

  const moveBefore = (dragged: SectionId, target: SectionId) => {
    if (dragged === target) return;
    setOrder((current) => {
      const next = current.filter((entry) => entry !== dragged);
      next.splice(next.indexOf(target), 0, dragged);
      writeSectionOrder(next);
      return next;
    });
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
