"use client";

import { useCallback, useState } from "react";
import {
  getQuickPanelBridge,
  type QuickPanelHotkeyState,
} from "@/features/agent/ui/quick-panel/quick-panel-bridge";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { eventToAccelerator } from "@/lib/terminal-keybinds";
import {
  SettingsButton,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  ShortcutKeys,
} from "./settings-ui";

export function QuickPanelSettings() {
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadHotkey = useCallback(async () => {
    const bridge = getQuickPanelBridge();
    if (!bridge?.getHotkey) throw new Error("Desktop quick panel unavailable");
    return bridge.getHotkey();
  }, []);
  const {
    data: state,
    setData: setState,
    loaded,
    error,
    setError,
  } = useAsyncResource(
    loadHotkey,
    null as QuickPanelHotkeyState | null,
    "Desktop quick panel unavailable",
    { clearOnError: true },
  );
  const bridgeAvailable = loaded ? state !== null : null;

  useMountSubscription(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const accelerator = eventToAccelerator(event);
      if (!accelerator) return;
      setRecording(false);
      const bridge = getQuickPanelBridge();
      if (!bridge?.setHotkey) return;
      void bridge.setHotkey(accelerator).then((result) => {
        if (result.ok) {
          setState((prev) => (prev ? { ...prev, hotkey: result.hotkey } : prev));
          setError("");
          setSaved(true);
        } else {
          setError(result.error ?? "Could not register that hotkey");
        }
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  useMountSubscription(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const resetToDefault = () => {
    const bridge = getQuickPanelBridge();
    if (!bridge?.setHotkey || !state) return;
    void bridge.setHotkey(state.defaultHotkey).then((result) => {
      if (result.ok) {
        setState((prev) => (prev ? { ...prev, hotkey: result.hotkey } : prev));
        setError("");
        setSaved(true);
      } else {
        setError(result.error ?? "Could not reset the hotkey");
      }
    });
  };

  return (
    <SettingsGroup
      title="Quick panel shortcut"
      description="Choose the global hotkey that toggles the floating chat panel."
    >
      {bridgeAvailable === false ? (
        <div className="px-3 py-2">
          <SettingsNotice tone="default">
            The quick panel is part of the Local Studio desktop app. Open Settings there to
            configure its hotkey.
          </SettingsNotice>
        </div>
      ) : (
        <>
          <SettingsRow
            label="Global hotkey"
            description="Press the hotkey anywhere to toggle the floating chat panel. The panel remembers its size when you resize it."
            value={
              recording ? (
                <span className="text-[length:var(--fs-sm)] text-(--ui-accent)">
                  Press a key combination… (Esc to cancel)
                </span>
              ) : state ? (
                <ShortcutKeys binding={state.hotkey} />
              ) : (
                <span className="text-(--ui-muted)">Loading…</span>
              )
            }
            actions={
              <div className="flex items-center gap-1">
                {saved ? (
                  <span className="px-1 text-[length:var(--fs-xs)] text-(--ui-success)">Saved</span>
                ) : null}
                <SettingsButton onClick={() => setRecording((value) => !value)} disabled={!state}>
                  {recording ? "Cancel" : "Change"}
                </SettingsButton>
                {state && state.hotkey !== state.defaultHotkey ? (
                  <SettingsButton onClick={resetToDefault}>Reset</SettingsButton>
                ) : null}
              </div>
            }
          />
          {error ? (
            <div className="px-3 py-2">
              <SettingsNotice tone="danger">{error}</SettingsNotice>
            </div>
          ) : null}
        </>
      )}
    </SettingsGroup>
  );
}
