"use client";

import { useState } from "react";
import { type TerminalOwner } from "@/features/agent/terminal-owners";
import { TerminalPanel } from "@/features/agent/ui/terminal-panel";

export function PersistentTerminals({
  active,
  activeOwnerKey,
  terminals,
}: {
  active: boolean;
  activeOwnerKey: string | null;
  terminals: TerminalOwner[];
}) {
  const [openedKeys, setOpenedKeys] = useState<ReadonlySet<string>>(new Set());
  if (active && activeOwnerKey && !openedKeys.has(activeOwnerKey)) {
    setOpenedKeys(new Set(openedKeys).add(activeOwnerKey));
  }
  const opened = terminals.filter((terminal) => openedKeys.has(terminal.mountKey));
  if (!opened.length) return null;
  return (
    <>
      {opened.map((terminal) => {
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
