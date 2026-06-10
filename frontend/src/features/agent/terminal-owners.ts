export type TerminalOwner = {
  mountKey: string;
  matchKeys: string[];
  cwd: string | null;
};

export function uniqueTerminalKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

export function terminalKeysMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key));
}

export function mergeTerminalKeys(a: readonly string[], b: readonly string[]): string[] {
  return uniqueTerminalKeys([...a, ...b]);
}
