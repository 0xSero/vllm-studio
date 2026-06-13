"use client";

import { type TerminalOwner } from "@/features/agent/terminal-owners";
import { TerminalPanel } from "@/features/agent/ui/terminal-panel";

// Keep terminal panels mounted per session once opened so each session keeps its
// own PTY and scrollback while the user navigates elsewhere.
export function PersistentTerminals({
  active,
  activeOwnerKey,
  terminals,
}: {
  active: boolean;
  activeOwnerKey: string | null;
  terminals: TerminalOwner[];
}) {
  if (!terminals.length) return null;
  return (
    <>
      {terminals.map((terminal) => {
        const visible = Boolean(active && activeOwnerKey === terminal.mountKey);
        return (
          <div
            key={terminal.mountKey}
            className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <TerminalPanel cwd={terminal.cwd} ownerKey={terminal.mountKey} />
          </div>
        );
      })}
    </>
  );
}
