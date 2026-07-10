interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
  };
}
