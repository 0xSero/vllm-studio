import type { DesktopUpdateSnapshot } from "./types";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
}

export type SessionPrefsPayload = Record<
  string,
  { title?: string; pinned?: boolean; hidden?: boolean }
>;

export type UiPreferencesPayload = Record<string, string>;

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
  /** Deploy a controller to an ssh host; resolves with url + api key. */
  start(options: {
    host: string;
    port?: number;
    installDir?: string;
  }): Promise<ControllerDeployResultPayload>;
  /** Streamed installer output lines for the in-flight deploy. */
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
  /** Reveal a file in Finder/Explorer. Returns false when outside the home tree. */
  revealPath(target: string): Promise<boolean>;
  /** Open a file with its default application. False when outside the home tree. */
  openPath(target: string): Promise<boolean>;
  getUpdateStatus(): Promise<DesktopUpdateSnapshot>;
  startUpdate(): Promise<DesktopUpdateSnapshot>;
  openDirectory(): Promise<ProjectEntry | null>;
  getPathForFile(file: File): string;
  listProjects(): Promise<ProjectEntry[]>;
  addProject(directoryPath: string): Promise<ProjectEntry>;
  removeProject(id: string): Promise<{ ok: true }>;
  /** Durable file-backed session prefs that survive process kill. */
  loadSessionPrefs(): Promise<SessionPrefsPayload>;
  saveSessionPrefs(prefs: SessionPrefsPayload): Promise<void>;
  /** Durable backup for renderer localStorage UI prefs (theme, font, layout). */
  loadUiPreferences(): Promise<UiPreferencesPayload>;
  saveUiPreferences(prefs: UiPreferencesPayload): Promise<void>;
  getKittylitterPairingJson(): Promise<KittylitterPairingResult>;
  copyKittylitterPairingJson(pairingJson: string): Promise<KittylitterCopyResult>;
  quickPanel: QuickPanelBridge;
  controllerDeploy: ControllerDeployBridge;
}
