interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
    revealPath?(target: string): Promise<boolean>;
    openPath?(target: string): Promise<boolean>;
    getRuntime?(): Promise<{
      appVersion: string;
      platform: string;
      packaged: boolean;
      releaseChannel: "dev" | "stable";
    }>;
    getUpdateStatus?(): Promise<import("../desktop/types").DesktopUpdateSnapshot>;
    checkForUpdates?(): Promise<import("../desktop/types").DesktopUpdateSnapshot>;
    startUpdate?(): Promise<import("../desktop/types").DesktopUpdateSnapshot>;
    setUpdateChannel?(
      channel: import("../desktop/types").DesktopUpdateChannel,
    ): Promise<import("../desktop/types").DesktopUpdateSnapshot>;
    getKittylitterPairingJson?(): Promise<import("../desktop/interfaces").KittylitterPairingResult>;
    copyKittylitterPairingJson?(pairingJson: string): Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
}
