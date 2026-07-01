export interface LaunchStateSnapshot {
  phase: "idle" | "launching";
  recipeId: string | null;
}

export interface LaunchState {
  getLaunchingRecipeId: () => string | null;
  getState: () => LaunchStateSnapshot;
  markLaunching: (recipeId: string) => void;
  markIdle: () => void;
}

export const createLaunchState = (): LaunchState => {
  let state: LaunchStateSnapshot = { phase: "idle", recipeId: null };
  return {
    getLaunchingRecipeId: (): string | null => state.recipeId,
    getState: (): LaunchStateSnapshot => state,
    markLaunching: (recipeId: string): void => {
      state = { phase: "launching", recipeId };
    },
    markIdle: (): void => {
      state = { phase: "idle", recipeId: null };
    },
  };
};
