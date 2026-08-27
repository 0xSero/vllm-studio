"use client";

import { SegmentedControl, Slider, type SegmentedItem } from "@/ui";
import { useDesktopWindowAppearance } from "@/lib/desktop-window-appearance";
import {
  type WindowMaterial,
  WINDOW_TRANSPARENCY_MAX,
} from "../../../desktop/window-appearance-contract";
import { SettingsGroup, SettingsRow } from "./settings-ui";

const MATERIAL_ITEMS: SegmentedItem<WindowMaterial>[] = [
  { id: "solid", label: "Solid" },
  { id: "subtle", label: "Subtle" },
  { id: "glass", label: "Glass" },
];

const MATERIAL_TRANSPARENCY: Record<WindowMaterial, number> = {
  solid: 0,
  subtle: 12,
  glass: 24,
};

export function WindowMaterialSettings() {
  const appearance = useDesktopWindowAppearance();
  if (!appearance.available) return null;

  const state = appearance.state;
  const backdropDescription = state.reducedTransparency
    ? "Solid while your system Reduce Transparency preference is enabled"
    : state.supported
      ? state.platform === "darwin"
        ? "macOS vibrancy"
        : "Windows Mica or Acrylic"
      : "This system uses the opaque fallback";

  return (
    <SettingsGroup
      title="Window material"
      description="Blend the desktop canvas with the native system backdrop. Content surfaces stay opaque."
      actions={
        <SegmentedControl
          items={MATERIAL_ITEMS}
          value={state.material}
          onChange={(material) =>
            void appearance.setPreference({
              material,
              transparency: MATERIAL_TRANSPARENCY[material],
            })
          }
          disabled={!state.supported}
          size="sm"
        />
      }
    >
      <SettingsRow
        label="Native backdrop"
        description={backdropDescription}
        value={
          <span className="text-[length:var(--fs-md)] capitalize text-(--ui-fg)/80">
            {state.effectiveMaterial}
          </span>
        }
      />
      <SettingsRow
        label="Transparency"
        description="Fine-tune the canvas and sidebar without fading text or controls"
        control={
          <div className="flex w-full items-center gap-3">
            <Slider
              value={state.transparency}
              min={0}
              max={WINDOW_TRANSPARENCY_MAX}
              step={1}
              disabled={!state.supported || state.material === "solid" || state.reducedTransparency}
              onChange={(transparency) =>
                void appearance.setPreference({ material: state.material, transparency })
              }
              aria-label="Window transparency"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[length:var(--fs-md)] tabular-nums text-(--ui-muted)">
              {state.material === "solid" ? "Off" : `${state.transparency}%`}
            </span>
          </div>
        }
      />
    </SettingsGroup>
  );
}
