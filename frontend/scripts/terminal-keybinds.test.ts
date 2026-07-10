import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TERMINAL_KEYBINDS,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  eventToKeybind,
  getTerminalFontSize,
  getTerminalKeybinds,
  matchKeybind,
  matchTerminalAction,
  subscribeTerminalStore,
  type TerminalKeybinds,
} from "../src/lib/terminal-keybinds";

type KeyEventFields = {
  code: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

function keyEvent(fields: KeyEventFields): KeyboardEvent {
  const event = {
    code: fields.code,
    metaKey: fields.metaKey === true,
    ctrlKey: fields.ctrlKey === true,
    altKey: fields.altKey === true,
    shiftKey: fields.shiftKey === true,
  };
  return event as unknown as KeyboardEvent;
}

function withPlatform(platform: string, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
}

type MutableStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function createStorage(): { storage: MutableStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  const storage: MutableStorage = {
    getItem(key) {
      const value = values.get(key);
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  return { storage, values };
}

class StoreWindow extends EventTarget {
  readonly localStorage: MutableStorage;
  constructor(localStorage: MutableStorage) {
    super();
    this.localStorage = localStorage;
  }
}

test("matchKeybind requires the exact modifier set and the bound key", () => {
  withPlatform("MacIntel", () => {
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", metaKey: true }), "mod+d"), true);
    assert.equal(
      matchKeybind(keyEvent({ code: "KeyD", metaKey: true, shiftKey: true }), "mod+d"),
      false,
    );
    assert.equal(
      matchKeybind(keyEvent({ code: "KeyD", metaKey: true, shiftKey: true }), "mod+shift+d"),
      true,
    );
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", metaKey: true }), "mod+shift+d"), false);
    assert.equal(
      matchKeybind(keyEvent({ code: "KeyD", metaKey: true, altKey: true }), "mod+d"),
      false,
    );
    assert.equal(matchKeybind(keyEvent({ code: "KeyF", metaKey: true }), "mod+d"), false);
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", metaKey: true }), "mod"), false);
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", metaKey: true }), ""), false);
  });
});

test("matchKeybind resolves mod to the platform accelerator key", () => {
  withPlatform("MacIntel", () => {
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", metaKey: true }), "mod+d"), true);
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", ctrlKey: true }), "mod+d"), false);
  });
  withPlatform("Linux x86_64", () => {
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", ctrlKey: true }), "mod+d"), true);
    assert.equal(matchKeybind(keyEvent({ code: "KeyD", metaKey: true }), "mod+d"), false);
  });
});

test("eventToKeybind serializes modifiers canonically and round-trips through matchKeybind", () => {
  withPlatform("MacIntel", () => {
    const shifted = keyEvent({ code: "KeyD", metaKey: true, shiftKey: true });
    assert.equal(eventToKeybind(shifted), "mod+shift+d");
    assert.equal(matchKeybind(shifted, "mod+shift+d"), true);

    const symbol = keyEvent({ code: "Equal", metaKey: true });
    assert.equal(eventToKeybind(symbol), "mod+=");
    assert.equal(matchKeybind(symbol, eventToKeybind(symbol) ?? ""), true);

    const secondary = keyEvent({ code: "KeyK", ctrlKey: true });
    assert.equal(eventToKeybind(secondary), "ctrl+k");
  });
  withPlatform("Linux x86_64", () => {
    const ctrl = keyEvent({ code: "KeyD", ctrlKey: true });
    assert.equal(eventToKeybind(ctrl), "mod+d");
    assert.equal(matchKeybind(ctrl, "mod+d"), true);
  });
});

test("eventToKeybind returns null for modifier-only and unmodified events", () => {
  withPlatform("MacIntel", () => {
    assert.equal(eventToKeybind(keyEvent({ code: "ShiftLeft", shiftKey: true })), null);
    assert.equal(eventToKeybind(keyEvent({ code: "MetaLeft", metaKey: true })), null);
    assert.equal(eventToKeybind(keyEvent({ code: "KeyD" })), null);
  });
});

test("matchTerminalAction returns only supported terminal-local actions", () => {
  const keybinds: TerminalKeybinds = {
    clearTerminal: "mod+k",
    fontSizeUp: "mod+=",
    fontSizeDown: "mod+-",
    fontSizeReset: "mod+0",
  };
  withPlatform("MacIntel", () => {
    assert.equal(
      matchTerminalAction(keyEvent({ code: "KeyK", metaKey: true }), keybinds),
      "clearTerminal",
    );
    assert.equal(matchTerminalAction(keyEvent({ code: "KeyG", metaKey: true }), keybinds), null);
  });
});

test("the terminal store re-reads keybinds and font size from localStorage on storage events", () => {
  const KEYBINDS_KEY = "local-studio.terminalKeybinds.v1";
  const FONT_SIZE_KEY = "local-studio.terminalFontSize";
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { storage, values } = createStorage();
  const storeWindow = new StoreWindow(storage);
  Object.defineProperty(globalThis, "window", {
    value: storeWindow,
    configurable: true,
    writable: true,
  });
  const unsubscribe = subscribeTerminalStore(() => {});
  const sync = () => {
    storeWindow.dispatchEvent(new Event("storage"));
  };
  try {
    withPlatform("MacIntel", () => {
      values.set(
        KEYBINDS_KEY,
        JSON.stringify({ fontSizeReset: "alt+r", clearTerminal: 5, unknownAction: "mod+z" }),
      );
      sync();
      const merged = getTerminalKeybinds();
      assert.equal(merged.fontSizeReset, "alt+r");
      assert.equal(
        matchTerminalAction(keyEvent({ code: "KeyR", altKey: true }), merged),
        "fontSizeReset",
      );
      assert.equal(matchTerminalAction(keyEvent({ code: "Digit0", metaKey: true }), merged), null);
      assert.equal(merged.clearTerminal, DEFAULT_TERMINAL_KEYBINDS.clearTerminal);
      assert.equal(Object.prototype.hasOwnProperty.call(merged, "unknownAction"), false);

      values.set(FONT_SIZE_KEY, "40");
      sync();
      assert.equal(getTerminalFontSize(), TERMINAL_FONT_SIZE_MAX);

      values.set(FONT_SIZE_KEY, "1");
      sync();
      assert.equal(getTerminalFontSize(), TERMINAL_FONT_SIZE_MIN);

      values.set(FONT_SIZE_KEY, "13.4");
      sync();
      assert.equal(getTerminalFontSize(), 13);

      values.set(KEYBINDS_KEY, "{ not json");
      sync();
      assert.deepEqual(getTerminalKeybinds(), DEFAULT_TERMINAL_KEYBINDS);

      values.delete(KEYBINDS_KEY);
      values.delete(FONT_SIZE_KEY);
      sync();
      assert.deepEqual(getTerminalKeybinds(), DEFAULT_TERMINAL_KEYBINDS);
      assert.equal(getTerminalFontSize(), TERMINAL_FONT_SIZE_DEFAULT);
    });
  } finally {
    unsubscribe();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Object.defineProperty(globalThis, "window", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  }
});
