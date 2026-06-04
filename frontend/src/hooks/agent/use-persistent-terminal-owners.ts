import { useCallback, useSyncExternalStore } from "react";
import {
  mergeTerminalKeys,
  terminalKeysMatch,
  type TerminalOwner,
} from "@/lib/agent/terminal-owners";

const terminalOwnerListeners = new Set<() => void>();
let terminalOwners: TerminalOwner[] = [];

function getTerminalOwnersSnapshot(): TerminalOwner[] {
  return terminalOwners;
}

function rememberTerminalOwner(owner: TerminalOwner): boolean {
  const ownerIndex = terminalOwners.findIndex((terminal) =>
    terminalKeysMatch(terminal.matchKeys, owner.matchKeys),
  );
  if (ownerIndex < 0) {
    terminalOwners = [...terminalOwners, owner];
    return true;
  }

  const current = terminalOwners[ownerIndex];
  const matchKeys = mergeTerminalKeys(current.matchKeys, owner.matchKeys);
  const nextOwner =
    matchKeys.length === current.matchKeys.length && current.cwd === owner.cwd
      ? current
      : { ...current, matchKeys, cwd: owner.cwd };
  if (nextOwner === current) return false;
  terminalOwners = terminalOwners.map((terminal, index) =>
    index === ownerIndex ? nextOwner : terminal,
  );
  return true;
}

function emitTerminalOwnersChanged(): void {
  for (const listener of terminalOwnerListeners) listener();
}

export function clearPersistentTerminalOwners(): TerminalOwner[] {
  if (terminalOwners.length === 0) return [];
  const removed = terminalOwners;
  terminalOwners = [];
  emitTerminalOwnersChanged();
  return removed;
}

export function usePersistentTerminalOwners(
  active: boolean,
  owner: TerminalOwner | null,
): TerminalOwner[] {
  const subscribe = useCallback(
    (notify: () => void) => {
      terminalOwnerListeners.add(notify);
      if (active && owner && rememberTerminalOwner(owner)) {
        queueMicrotask(emitTerminalOwnersChanged);
      }
      return () => terminalOwnerListeners.delete(notify);
    },
    [active, owner],
  );

  return useSyncExternalStore(subscribe, getTerminalOwnersSnapshot, getTerminalOwnersSnapshot);
}
