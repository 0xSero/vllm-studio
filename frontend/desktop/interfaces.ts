import type { DesktopUpdateSnapshot } from "./types";

export type SessionPrefsPayload = Record<
  string,
  { title?: string; pinned?: boolean; hidden?: boolean }
>;

export type UiPreferencesPayload = Record<string, string>;

export interface PtyStatus {
  available: boolean;
  reason: string | null;
}

export interface PtyOpenOpts {
  cwd?: string;
  cols?: number;
  rows?: number;
  ownerKey?: string;
}

export interface PtyBridge {
  status(): Promise<PtyStatus>;
  open(opts: PtyOpenOpts): Promise<{ id: string; replay?: string; reused?: boolean }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  closeOwner(ownerKey: string): Promise<void>;
  onData(listener: (id: string, chunk: string) => void): () => void;
  onExit(
    listener: (id: string, info: { exitCode: number; signal: number | null }) => void,
  ): () => void;
}

export interface QuickPanelHotkeyState {
  hotkey: string;
  defaultHotkey: string;
}

export interface QuickPanelHotkeyResult {
  ok: boolean;
  hotkey: string;
  error?: string;
}

export interface QuickPanelBridge {
  expand(): Promise<void>;
  dismiss(): Promise<void>;
  focusMainAndNavigate(projectId: string, sessionId?: string): Promise<void>;
  getHotkey(): Promise<QuickPanelHotkeyState>;
  setHotkey(hotkey: string): Promise<QuickPanelHotkeyResult>;
}

export interface ControllerDeployResultPayload {
  ok: boolean;
  url?: string;
  apiKey?: string;
  error?: string;
}

export interface ControllerDeployBridge {
  start(options: {
    mode?: "ssh" | "local";
    host?: string;
    port?: number;
    installDir?: string;
  }): Promise<ControllerDeployResultPayload>;
  onLog(listener: (line: string) => void): () => void;
}

export interface KittylitterPairingResult {
  ok: boolean;
  pairingJson?: string;
  error?: string;
}

export interface KittylitterCopyResult {
  ok: boolean;
  error?: string;
}

export interface DesktopBridge {
  getRuntime(): Promise<{
    platform: NodeJS.Platform;
    appVersion: string;
    packaged: boolean;
    releaseChannel: "dev" | "stable";
    chromeVersion: string;
    electronVersion: string;
  }>;
  openExternal(url: string): Promise<boolean>;
  revealPath(target: string): Promise<boolean>;
  openPath(target: string): Promise<boolean>;
  getUpdateStatus(): Promise<DesktopUpdateSnapshot>;
  startUpdate(): Promise<DesktopUpdateSnapshot>;
  openDirectory(): Promise<string | null>;
  getPathForFile(file: File): string;
  loadSessionPrefs(): Promise<SessionPrefsPayload>;
  saveSessionPrefs(prefs: SessionPrefsPayload): Promise<void>;
  loadUiPreferences(): Promise<UiPreferencesPayload>;
  saveUiPreferences(prefs: UiPreferencesPayload): Promise<void>;
  getKittylitterPairingJson(): Promise<KittylitterPairingResult>;
  copyKittylitterPairingJson(pairingJson: string): Promise<KittylitterCopyResult>;
  terminal: PtyBridge;
  quickPanel: QuickPanelBridge;
  controllerDeploy: ControllerDeployBridge;
}
