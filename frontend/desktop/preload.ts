import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopBridge } from "./interfaces";

const bridge: DesktopBridge = {
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  revealPath: (target) => ipcRenderer.invoke("desktop:reveal-path", target),
  openPath: (target) => ipcRenderer.invoke("desktop:open-path", target),
  getUpdateStatus: () => ipcRenderer.invoke("desktop:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  startUpdate: () => ipcRenderer.invoke("desktop:start-update"),
  setUpdateChannel: (channel) => ipcRenderer.invoke("desktop:set-update-channel", channel),
  openDirectory: () => ipcRenderer.invoke("desktop:open-directory"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  loadUiPreferences: () => ipcRenderer.invoke("desktop:load-ui-preferences"),
  saveUiPreferences: (prefs) => ipcRenderer.invoke("desktop:save-ui-preferences", prefs),
  windowAppearance: {
    set: (preference) => ipcRenderer.invoke("desktop:window-appearance-set", preference),
    setReducedTransparency: (reduced) =>
      ipcRenderer.invoke("desktop:window-appearance-set-reduced", reduced),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);
      ipcRenderer.on("desktop:window-appearance-changed", handler);
      return () => ipcRenderer.removeListener("desktop:window-appearance-changed", handler);
    },
  },
  getKittylitterPairingJson: () => ipcRenderer.invoke("desktop:get-kittylitter-pairing-json"),
  copyKittylitterPairingJson: (pairingJson) =>
    ipcRenderer.invoke("desktop:copy-kittylitter-pairing-json", pairingJson),
  terminal: {
    status: () => ipcRenderer.invoke("desktop:pty-status"),
    open: (opts) => ipcRenderer.invoke("desktop:pty-open", opts),
    write: (id, data) => ipcRenderer.invoke("desktop:pty-write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("desktop:pty-resize", id, cols, rows),
    close: (id) => ipcRenderer.invoke("desktop:pty-close", id),
    closeOwner: (ownerKey) => ipcRenderer.invoke("desktop:pty-close-owner", ownerKey),
    onData: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; chunk: string }) =>
        listener(payload.id, payload.chunk);
      ipcRenderer.on("desktop:pty-data", handler);
      return () => ipcRenderer.removeListener("desktop:pty-data", handler);
    },
    onExit: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number; signal: number | null },
      ) => listener(payload.id, { exitCode: payload.exitCode, signal: payload.signal });
      ipcRenderer.on("desktop:pty-exit", handler);
      return () => ipcRenderer.removeListener("desktop:pty-exit", handler);
    },
  },
  quickPanel: {
    expand: () => ipcRenderer.invoke("desktop:quick-panel-expand"),
    dismiss: () => ipcRenderer.invoke("desktop:quick-panel-dismiss"),
    focusMainAndNavigate: (projectId, sessionId) =>
      ipcRenderer.invoke("desktop:focus-main-and-navigate", projectId, sessionId),
    getHotkey: () => ipcRenderer.invoke("desktop:quick-panel-get-hotkey"),
    setHotkey: (hotkey) => ipcRenderer.invoke("desktop:quick-panel-set-hotkey", hotkey),
  },
  controllerDeploy: {
    start: (options) => ipcRenderer.invoke("desktop:controller-deploy", options),
    onLog: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { line: string }) =>
        listener(payload.line);
      ipcRenderer.on("desktop:controller-deploy-log", handler);
      return () => ipcRenderer.removeListener("desktop:controller-deploy-log", handler);
    },
  },
};

contextBridge.exposeInMainWorld("localStudioDesktop", bridge);
