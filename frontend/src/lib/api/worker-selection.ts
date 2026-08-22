const WORKER_STORAGE_KEY = "local-studio:selected-worker";
export const WORKER_SELECTION_EVENT = "local-studio:worker-selection";

export const getSelectedWorkerId = (): string => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(WORKER_STORAGE_KEY)?.trim() ?? "";
};

export const setSelectedWorkerId = (workerId: string): void => {
  if (typeof window === "undefined") return;
  const normalized = workerId.trim();
  if (normalized) window.localStorage.setItem(WORKER_STORAGE_KEY, normalized);
  else window.localStorage.removeItem(WORKER_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(WORKER_SELECTION_EVENT, { detail: normalized }));
};
