import { ADD_PROJECT_EVENT, SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useProjectDirectoryPickerModalEffects({
  loadDirectory,
  open,
}: {
  loadDirectory: (directoryPath?: string) => Promise<void>;
  open: boolean;
}): void {
  useMountSubscription(() => {
    if (!open) return;
    void loadDirectory();
  }, [open, loadDirectory]);
}

export function useProjectsNavAddProjectEffect(handleAddProject: () => void): void {
  useMountSubscription(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  }, [handleAddProject]);
}

const SESSIONS_RELOAD_DEBOUNCE_MS = 300;

export function useProjectSessionsReloadEffect(reload: () => Promise<void>): void {
  useMountSubscription(() => {
    void reload();
    let timer: number | null = null;
    const scheduleReload = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void reload();
      }, SESSIONS_RELOAD_DEBOUNCE_MS);
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, scheduleReload);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(SESSIONS_CHANGED_EVENT, scheduleReload);
    };
  }, [reload]);
}
