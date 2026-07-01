type QuickPanelBridge = {
  expand: () => Promise<void>;
  dismiss: () => Promise<void>;
  focusMainAndNavigate: (projectId: string, sessionId?: string) => Promise<void>;
};

export function getQuickPanelBridge(): QuickPanelBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { localStudioDesktop?: { quickPanel?: QuickPanelBridge } })
      .localStudioDesktop?.quickPanel ?? null
  );
}
