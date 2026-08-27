import { create, type StateCreator } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import {
  hydrateDurableUiPreferences,
  scheduleDurableUiPreferencesSave,
} from "@/lib/desktop-ui-preferences";
import {
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SIZE_ID,
  THEME_BY_ID,
  type FontFamilyId,
  type FontSizeId,
  type ThemeId,
} from "@/lib/themes";
import {
  applyFontFamilyToDocument,
  applyFontSizeToDocument,
  applyStoredUiControls,
  applyThemeToDocument,
} from "@/lib/theme-runtime";
import type { PreviewHeight } from "@/ui/preview-scroll";
import type {
  ToolKind,
  ToolPreviewHeightOverrides,
} from "@/features/agent/ui/timeline/tool-metadata";

export interface AppSlice {
  fileViewerFontSize: number;
  setFileViewerFontSize: (size: number) => void;
  toolPreviewHeight: PreviewHeight;
  setToolPreviewHeight: (height: PreviewHeight) => void;
  toolPreviewHeightOverrides: ToolPreviewHeightOverrides;
  setToolPreviewHeightOverride: (kind: ToolKind, height: PreviewHeight | undefined) => void;
  lastOpenFileByProject: Record<string, string>;
  setLastOpenFileByProject: (cwd: string, rel: string) => void;
}

export const DEFAULT_SIDEBAR_WIDTH = 280;

const createAppSlice: StateCreator<AppSlice, [], [], AppSlice> = (set) => ({
  fileViewerFontSize: 12,
  setFileViewerFontSize: (fileViewerFontSize) => set({ fileViewerFontSize }),
  toolPreviewHeight: "md",
  setToolPreviewHeight: (toolPreviewHeight) => set({ toolPreviewHeight }),
  toolPreviewHeightOverrides: {},
  setToolPreviewHeightOverride: (kind, height) =>
    set((state) => {
      const toolPreviewHeightOverrides = { ...state.toolPreviewHeightOverrides };
      if (height) toolPreviewHeightOverrides[kind] = height;
      else delete toolPreviewHeightOverrides[kind];
      return { toolPreviewHeightOverrides };
    }),
  lastOpenFileByProject: {},
  setLastOpenFileByProject: (cwd, rel) =>
    set((state) => ({
      lastOpenFileByProject: { ...state.lastOpenFileByProject, [cwd]: rel },
    })),
});

export interface ThemeSlice {
  themeId: ThemeId;
  fontFamilyId: FontFamilyId;
  fontSizeId: FontSizeId;
  setThemeId: (themeId: ThemeId) => void;
  setFontFamilyId: (fontFamilyId: FontFamilyId) => void;
  setFontSizeId: (fontSizeId: FontSizeId) => void;
}

const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => ({
  themeId: "zai-dark",
  fontFamilyId: DEFAULT_FONT_FAMILY_ID,
  fontSizeId: DEFAULT_FONT_SIZE_ID,
  setThemeId: (themeId: ThemeId) => {
    const appliedThemeId = applyThemeToDocument(themeId);
    const preferredFontFamilyId = THEME_BY_ID.get(appliedThemeId)?.fontFamilyId;
    const appliedFontFamilyId = preferredFontFamilyId
      ? applyFontFamilyToDocument(preferredFontFamilyId)
      : undefined;
    set({
      themeId: appliedThemeId,
      ...(appliedFontFamilyId ? { fontFamilyId: appliedFontFamilyId } : {}),
    });
  },
  setFontFamilyId: (fontFamilyId: FontFamilyId) => {
    const appliedFontFamilyId = applyFontFamilyToDocument(fontFamilyId);
    set({ fontFamilyId: appliedFontFamilyId });
  },
  setFontSizeId: (fontSizeId: FontSizeId) => {
    const appliedFontSizeId = applyFontSizeToDocument(fontSizeId);
    set({ fontSizeId: appliedFontSizeId });
  },
});

export type AppStore = AppSlice &
  ThemeSlice & {
    mobileNavOpen: boolean;
    setMobileNavOpen: (open: boolean) => void;
  };

const createAppStoreImpl: StateCreator<AppStore, [], [], AppStore> = (set, ...args) => ({
  ...createAppSlice(set, ...args),
  ...createThemeSlice(set, ...args),
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
});

let appStorePersistenceReady = false;

const baseStorage = createJSONStorage(() =>
  typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage),
);

const storage = baseStorage
  ? {
      ...baseStorage,
      setItem: (...args: Parameters<typeof baseStorage.setItem>) =>
        appStorePersistenceReady ? baseStorage.setItem(...args) : undefined,
      removeItem: (...args: Parameters<typeof baseStorage.removeItem>) =>
        appStorePersistenceReady ? baseStorage.removeItem(...args) : undefined,
    }
  : undefined;

export const useAppStore = create<AppStore>()(
  devtools(
    persist(createAppStoreImpl, {
      name: "local-studio-state",
      version: 1,
      migrate: (persisted) => ({ ...((persisted ?? {}) as Partial<AppStore>) }),
      storage,
      skipHydration: true,
      partialize: (state) => ({
        themeId: state.themeId,
        fontFamilyId: state.fontFamilyId,
        fontSizeId: state.fontSizeId,
        fileViewerFontSize: state.fileViewerFontSize,
        toolPreviewHeight: state.toolPreviewHeight,
        toolPreviewHeightOverrides: state.toolPreviewHeightOverrides,
        lastOpenFileByProject: state.lastOpenFileByProject,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...((persisted ?? {}) as Partial<AppStore>),
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.themeId) state.setThemeId(state.themeId);
        if (state?.fontFamilyId) state.setFontFamilyId(state.fontFamilyId);
        if (state?.fontSizeId) state.setFontSizeId(state.fontSizeId);
        applyStoredUiControls();
      },
    }),
    { name: "local-studio" },
  ),
);

if (typeof window !== "undefined") {
  void (async () => {
    try {
      await hydrateDurableUiPreferences();
      await useAppStore.persist.rehydrate();
    } finally {
      appStorePersistenceReady = true;
      scheduleDurableUiPreferencesSave();
      useAppStore.subscribe(() => scheduleDurableUiPreferencesSave());
    }
  })();
}
