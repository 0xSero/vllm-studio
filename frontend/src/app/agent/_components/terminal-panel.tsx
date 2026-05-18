"use client";

import { useRef } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { useTerminalPanelEffects } from "@/hooks/agent/use-terminal-panel-effects";

type TerminalRefs = {
  term: XTerm | null;
  fit: FitAddon | null;
  input: string;
  running: boolean;
  disposed: boolean;
};

export function TerminalPanel({ cwd }: { cwd: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TerminalRefs>({
    term: null,
    fit: null,
    input: "",
    running: false,
    disposed: false,
  });

  useTerminalPanelEffects({ containerRef, cwd, stateRef });

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#070707]">
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden p-2 [--xterm-color-background:#070707]"
      />
    </section>
  );
}
