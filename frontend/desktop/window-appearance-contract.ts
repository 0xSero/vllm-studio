import { Schema } from "effect";

export const WINDOW_TRANSPARENCY_MAX = 36;
export const WINDOW_TRANSPARENCY_DEFAULT = 12;

export const WindowMaterialSchema = Schema.Literals(["solid", "subtle", "glass"]);
export type WindowMaterial = typeof WindowMaterialSchema.Type;

export const WindowTransparencySchema = Schema.Number.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: WINDOW_TRANSPARENCY_MAX }),
  ),
);

export const WindowAppearancePreferenceSchema = Schema.Struct({
  material: WindowMaterialSchema,
  transparency: WindowTransparencySchema,
});
export type WindowAppearancePreference = typeof WindowAppearancePreferenceSchema.Type;

export const WindowAppearanceStateSchema = Schema.Struct({
  material: WindowMaterialSchema,
  transparency: WindowTransparencySchema,
  effectiveMaterial: WindowMaterialSchema,
  effectiveTransparency: WindowTransparencySchema,
  supported: Schema.Boolean,
  reducedTransparency: Schema.Boolean,
  platform: Schema.String,
});
export type WindowAppearanceState = typeof WindowAppearanceStateSchema.Type;
