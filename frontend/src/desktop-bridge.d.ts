interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
    revealPath?(target: string): Promise<boolean>;
    openPath?(target: string): Promise<boolean>;
    getRuntime?(): Promise<{ appVersion: string; platform: string; packaged: boolean }>;
    getUpdateStatus?(): Promise<{ status: string; version?: string; message?: string }>;
    checkForUpdates?(): Promise<{ status: string; version?: string; message?: string }>;
    installUpdate?(): Promise<boolean>;
    getKittylitterPairingJson?(): Promise<import("../desktop/interfaces").KittylitterPairingResult>;
    copyKittylitterPairingJson?(pairingJson: string): Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
}
