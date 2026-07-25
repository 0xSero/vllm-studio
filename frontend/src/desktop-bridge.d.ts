interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
    revealPath?(target: string): Promise<boolean>;
    getKittylitterPairingJson?(): Promise<import("../desktop/interfaces").KittylitterPairingResult>;
    copyKittylitterPairingJson?(pairingJson: string): Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
}
