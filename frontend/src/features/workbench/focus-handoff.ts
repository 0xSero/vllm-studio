let keyboardTabFocusTarget: string | null = null;

export function requestKeyboardTabFocus(tabId: string): void {
  keyboardTabFocusTarget = tabId;
}

export function clearKeyboardTabFocus(): void {
  keyboardTabFocusTarget = null;
}

export function isKeyboardTabFocusPending(): boolean {
  return keyboardTabFocusTarget !== null;
}
