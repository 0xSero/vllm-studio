import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import { hardenWebContents } from "./security";

let panel: BrowserWindow | null = null;
let isThreadMode = false;

function targetDisplayWorkArea() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

function centeredTopBounds(size: { width: number; height: number }) {
  const workArea = targetDisplayWorkArea();
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + DESKTOP_CONFIG.quickPanel.topInsetPx,
    width,
    height,
  };
}

function createQuickPanelWindow(appUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    ...centeredTopBounds(DESKTOP_CONFIG.quickPanel.homeWindow),
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  hardenWebContents(window, new URL(appUrl).origin);
  window.on("blur", () => hideQuickPanel());
  window.on("closed", () => {
    if (panel === window) panel = null;
  });

  void window.loadURL(`${appUrl}/quick`);

  return window;
}

export function ensureQuickPanel(appUrl: string): BrowserWindow {
  if (!panel || panel.isDestroyed()) {
    panel = createQuickPanelWindow(appUrl);
  }
  return panel;
}

export function toggleQuickPanel(appUrl: string): void {
  const window = ensureQuickPanel(appUrl);
  if (window.isVisible()) {
    hideQuickPanel();
    return;
  }
  showQuickPanel(appUrl);
}

export function showQuickPanel(appUrl: string): void {
  const window = ensureQuickPanel(appUrl);
  window.setBounds(
    centeredTopBounds(
      isThreadMode ? DESKTOP_CONFIG.quickPanel.threadWindow : DESKTOP_CONFIG.quickPanel.homeWindow,
    ),
  );
  window.show();
  window.focus();
}

export function hideQuickPanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) {
    panel.hide();
  }
}

export function resizeQuickPanelToThread(): void {
  if (!panel || panel.isDestroyed()) return;
  isThreadMode = true;
  panel.setResizable(true);
  panel.setBounds(centeredTopBounds(DESKTOP_CONFIG.quickPanel.threadWindow));
}

export function resizeQuickPanelToHome(): void {
  if (!panel || panel.isDestroyed()) return;
  isThreadMode = false;
  panel.setBounds(centeredTopBounds(DESKTOP_CONFIG.quickPanel.homeWindow));
  panel.setResizable(false);
}

export function getQuickPanel(): BrowserWindow | null {
  return panel && !panel.isDestroyed() ? panel : null;
}
