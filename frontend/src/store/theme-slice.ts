import type { StateCreator } from "zustand";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_ID } from "@/lib/themes";
import type { FontFamilyId, FontSizeId, ThemeId } from "@/lib/themes";
import {
  applyFontFamilyToDocument,
  applyFontSizeToDocument,
  applyThemeToDocument,
} from "@/lib/theme/runtime";

export interface ThemeSlice {
  themeId: ThemeId;
  fontFamilyId: FontFamilyId;
  fontSizeId: FontSizeId;
  setThemeId: (themeId: ThemeId) => void;
  setFontFamilyId: (fontFamilyId: FontFamilyId) => void;
  setFontSizeId: (fontSizeId: FontSizeId) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => ({
  themeId: "omlx-dark",
  fontFamilyId: DEFAULT_FONT_FAMILY_ID,
  fontSizeId: DEFAULT_FONT_SIZE_ID,
  setThemeId: (themeId: ThemeId) => {
    const appliedThemeId = applyThemeToDocument(themeId);
    set({ themeId: appliedThemeId });
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
