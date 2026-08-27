import { BrowserWindow } from "electron";
import { release } from "node:os";
import {
  type WindowAppearancePreference,
  type WindowAppearanceState,
  type WindowMaterial,
} from "../window-appearance-contract";
import { getStoredWindowAppearance, setStoredWindowAppearance } from "./desktop-settings";

let reducedTransparency = false;

function supportsNativeMaterials(): boolean {
  if (process.platform === "darwin") return true;
  if (process.platform !== "win32") return false;
  const build = Number(release().split(".")[2]);
  return Number.isFinite(build) && build >= 22621;
}

function effectiveAppearance(preference: WindowAppearancePreference): WindowAppearanceState {
  const supported = supportsNativeMaterials();
  const useSolid = !supported || reducedTransparency || preference.material === "solid";
  return {
    ...preference,
    effectiveMaterial: useSolid ? "solid" : preference.material,
    effectiveTransparency: useSolid ? 0 : preference.transparency,
    supported,
    reducedTransparency,
    platform: process.platform,
  };
}

function macVibrancy(material: WindowMaterial): "sidebar" | "under-window" | null {
  if (material === "subtle") return "sidebar";
  if (material === "glass") return "under-window";
  return null;
}

function windowsMaterial(material: WindowMaterial): "none" | "mica" | "acrylic" {
  if (material === "subtle") return "mica";
  if (material === "glass") return "acrylic";
  return "none";
}

export function getWindowAppearanceState(): WindowAppearanceState {
  return effectiveAppearance(getStoredWindowAppearance());
}

export function mainWindowAppearanceOptions(): Electron.BrowserWindowConstructorOptions {
  const state = getWindowAppearanceState();
  if (process.platform === "darwin") {
    const vibrancy = macVibrancy(state.effectiveMaterial);
    return {
      transparent: true,
      backgroundColor: "#00000000",
      titleBarStyle: "hidden",
      ...(vibrancy ? { vibrancy, visualEffectState: "followWindow" as const } : {}),
    };
  }
  if (process.platform === "win32") {
    return {
      backgroundMaterial: windowsMaterial(state.effectiveMaterial),
      backgroundColor: state.effectiveMaterial === "solid" ? "#0b0f14" : "#00000000",
    };
  }
  return { backgroundColor: "#0b0f14" };
}

export function applyWindowAppearance(window: BrowserWindow): WindowAppearanceState {
  const state = getWindowAppearanceState();
  if (process.platform === "darwin") {
    window.setVibrancy(macVibrancy(state.effectiveMaterial));
  } else if (process.platform === "win32") {
    window.setBackgroundMaterial(windowsMaterial(state.effectiveMaterial));
  }
  return state;
}

export function updateWindowAppearance(
  window: BrowserWindow | null,
  preference: WindowAppearancePreference,
): WindowAppearanceState {
  setStoredWindowAppearance(preference);
  return window && !window.isDestroyed()
    ? applyWindowAppearance(window)
    : getWindowAppearanceState();
}

export function updateReducedTransparency(
  window: BrowserWindow | null,
  reduced: boolean,
): WindowAppearanceState {
  reducedTransparency = reduced;
  return window && !window.isDestroyed()
    ? applyWindowAppearance(window)
    : getWindowAppearanceState();
}
