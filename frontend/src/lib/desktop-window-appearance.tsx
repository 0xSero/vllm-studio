"use client";

import { useSyncExternalStore } from "react";
import { Effect, Schema } from "effect";
import {
  WindowAppearanceStateSchema,
  type WindowAppearancePreference,
  type WindowAppearanceState,
} from "../../desktop/window-appearance-contract";

type WindowAppearanceBridge = {
  set(preference: WindowAppearancePreference): Promise<WindowAppearanceState>;
  setReducedTransparency(reduced: boolean): Promise<WindowAppearanceState>;
  onChanged(listener: (state: WindowAppearanceState) => void): () => void;
};

type WindowAppearanceSnapshot = {
  available: boolean;
  state: WindowAppearanceState;
};

type WindowAppearanceValue = WindowAppearanceSnapshot & {
  setPreference(preference: WindowAppearancePreference): Promise<void>;
};

const FALLBACK_STATE: WindowAppearanceState = {
  material: "solid",
  transparency: 0,
  effectiveMaterial: "solid",
  effectiveTransparency: 0,
  supported: false,
  reducedTransparency: false,
  platform: "web",
};

const SERVER_SNAPSHOT: WindowAppearanceSnapshot = {
  available: false,
  state: FALLBACK_STATE,
};

let snapshot = SERVER_SNAPSHOT;
let dispose: (() => void) | null = null;
const listeners = new Set<() => void>();

function bridge(): WindowAppearanceBridge | null {
  if (typeof window === "undefined") return null;
  return window.localStudioDesktop?.windowAppearance ?? null;
}

function decodeState(value: unknown): WindowAppearanceState {
  return Schema.decodeUnknownSync(WindowAppearanceStateSchema)(value);
}

function appearanceEffect(load: () => Promise<unknown>) {
  return Effect.tryPromise({ try: load, catch: (error) => error }).pipe(Effect.map(decodeState));
}

function emit(next: WindowAppearanceSnapshot): void {
  snapshot = next;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.style.setProperty(
      "--desktop-surface-opacity",
      `${100 - next.state.effectiveTransparency}%`,
    );
    root.dataset.desktopWindowMaterial = next.state.effectiveMaterial;
  }
  for (const listener of listeners) listener();
}

function emitState(value: unknown): void {
  try {
    emit({ available: true, state: decodeState(value) });
  } catch {}
}

function start(): () => void {
  const desktop = bridge();
  if (!desktop) return () => undefined;
  emit({ available: true, state: snapshot.state });
  const media = window.matchMedia("(prefers-reduced-transparency: reduce)");
  const syncReducedTransparency = (reduced: boolean) => {
    void Effect.runPromise(appearanceEffect(() => desktop.setReducedTransparency(reduced))).then(
      emitState,
      () => undefined,
    );
  };
  const handleChange = (event: MediaQueryListEvent) => syncReducedTransparency(event.matches);
  const unsubscribe = desktop.onChanged(emitState);
  media.addEventListener("change", handleChange);
  syncReducedTransparency(media.matches);
  return () => {
    unsubscribe();
    media.removeEventListener("change", handleChange);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  dispose ??= start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && dispose) {
      dispose();
      dispose = null;
    }
  };
}

function getSnapshot(): WindowAppearanceSnapshot {
  return snapshot;
}

function getServerSnapshot(): WindowAppearanceSnapshot {
  return SERVER_SNAPSHOT;
}

function setPreference(preference: WindowAppearancePreference): Promise<void> {
  const desktop = bridge();
  if (!desktop) return Promise.resolve();
  return Effect.runPromise(appearanceEffect(() => desktop.set(preference))).then(
    emitState,
    () => undefined,
  );
}

export function useDesktopWindowAppearance(): WindowAppearanceValue {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...current, setPreference };
}

export function DesktopWindowAppearanceSync() {
  useDesktopWindowAppearance();
  return null;
}
