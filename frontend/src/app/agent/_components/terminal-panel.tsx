"use client";

import { useRef } from "react";
import {
  useTerminalPanelEffects,
  type TerminalRefs,
} from "@/hooks/agent/use-terminal-panel-effects";

export function TerminalPanel({ cwd, ownerKey }: { cwd: string | null; ownerKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TerminalRefs>({
    term: null,
    fit: null,
    input: "",
    running: false,
    disposed: false,
  });

  useTerminalPanelEffects({ containerRef, cwd, ownerKey, stateRef });

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#070707]">
      <div
        ref={containerRef}
        tabIndex={0}
        onClick={(event) => {
          if (window.getSelection()?.toString()) return;
          if ((event.target as HTMLElement)?.tagName === "A") return;
          stateRef.current.term?.focus();
        }}
        className="min-h-0 flex-1 overflow-hidden p-2 [--xterm-color-background:#070707]"
      />
    </section>
  );
}
