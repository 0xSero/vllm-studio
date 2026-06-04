"use client";

import { usePersistentTerminalOwners } from "@/hooks/agent/use-persistent-terminal-owners";
import { terminalKeysMatch, type TerminalOwner } from "@/lib/agent/terminal-owners";
import { TerminalPanel } from "./terminal-panel";

// Keep terminal panels mounted per session once opened so each session keeps its
// own PTY and scrollback while the user navigates elsewhere.
export function PersistentTerminals({
  active,
  owner,
}: {
  active: boolean;
  owner: TerminalOwner | null;
}) {
  const terminals = usePersistentTerminalOwners(active, owner);
  if (!terminals.length) return null;
  return (
    <>
      {terminals.map((terminal) => {
        const visible = Boolean(
          active && owner && terminalKeysMatch(terminal.matchKeys, owner.matchKeys),
        );
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
