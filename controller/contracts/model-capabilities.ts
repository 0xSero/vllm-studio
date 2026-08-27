import { Schema } from "effect";

export type ModelVisionInput = {
  identifiers: readonly string[];
  recipeOverride?: boolean | null;
  metadata?: unknown;
  modalities?: readonly unknown[];
};

const VISION_IDENTIFIER_PATTERNS = [
  "mimo-v2.5",
  "mimo-v2-5",
  "step-3.7",
  "step-3_7",
  "step-3-7",
  "nex-n2",
  "gemma-4",
  "gemma4",
  "llava",
  "internvl",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "qwen-omni",
  "pixtral",
  "minicpm-v",
  "molmo",
  "phi-3.5-v",
  "phi-3-vision",
  "phi-4-mm",
  "phi-4-multimodal",
  "llama-3.2-vision",
  "llama-4",
  "deepseek-vl",
  "idefics",
  "ovis",
  "moondream",
  "fuyu",
  "kosmos",
  "-vl-",
  "-vlm",
  "vision",
  "multimodal",
  "-mm-",
] as const;


const BooleanDeclarationSchema = Schema.Union([Schema.Boolean, Schema.String]);
const ModalityDeclarationSchema = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const CapabilitiesSchema = Schema.Struct({
  vision: Schema.optional(BooleanDeclarationSchema),
  image: Schema.optional(BooleanDeclarationSchema),
});
const VisionMetadataSchema = Schema.Struct({
  vision: Schema.optional(BooleanDeclarationSchema),
  supportsVision: Schema.optional(BooleanDeclarationSchema),
  supports_vision: Schema.optional(BooleanDeclarationSchema),
  multimodal: Schema.optional(BooleanDeclarationSchema),
  capabilities: Schema.optional(CapabilitiesSchema),
  input: Schema.optional(ModalityDeclarationSchema),
  inputs: Schema.optional(ModalityDeclarationSchema),
  modalities: Schema.optional(ModalityDeclarationSchema),
  input_modalities: Schema.optional(ModalityDeclarationSchema),
});
const ModalitiesSchema = Schema.Array(ModalityDeclarationSchema);
type BooleanDeclaration = Schema.Schema.Type<typeof BooleanDeclarationSchema>;
type ModalityDeclaration = Schema.Schema.Type<typeof ModalityDeclarationSchema>;
type VisionMetadata = Schema.Schema.Type<typeof VisionMetadataSchema>;

const booleanValue = (value: BooleanDeclaration | undefined): boolean | undefined => {
  if (Schema.is(Schema.Boolean)(value)) return value;
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const firstBoolean = (values: readonly (BooleanDeclaration | undefined)[]): boolean | undefined => {
  for (const value of values) {
    const parsed = booleanValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const imageModality = (value: ModalityDeclaration | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const values = Schema.is(Schema.String)(value) ? value.split(",") : value;
  const modalities = values.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (modalities.length === 0) return undefined;
  return modalities.some((entry) => entry === "image" || entry === "vision");
};

const firstImageModality = (
  values: readonly (ModalityDeclaration | undefined)[],
): boolean | undefined => {
  let declared = false;
  for (const value of values) {
    const parsed = imageModality(value);
    if (parsed === true) return true;
    if (parsed === false) declared = true;
  }
  return declared ? false : undefined;
};

const legacyVision = (
  metadata: VisionMetadata,
  modalities: readonly ModalityDeclaration[],
): boolean | undefined => {
  const capabilities = metadata.capabilities ?? {};
  return (
    firstBoolean([
      metadata.vision,
      metadata.supportsVision,
      metadata.supports_vision,
      metadata.multimodal,
      capabilities.vision,
      capabilities.image,
    ]) ??
    firstImageModality([
      metadata.input,
      metadata.inputs,
      metadata.modalities,
      metadata.input_modalities,
      ...modalities,
    ])
  );
};

export const inferModelVision = (identifiers: readonly string[]): boolean =>
  identifiers.some((identifier) => {
    const normalized = identifier.toLowerCase();
    return VISION_IDENTIFIER_PATTERNS.some((pattern) => normalized.includes(pattern));
  });

export const resolveModelVision = ({
  identifiers,
  recipeOverride,
  metadata,
  modalities = [],
}: ModelVisionInput): boolean => {
  const parsedMetadata = Schema.decodeUnknownOption(VisionMetadataSchema)(metadata);
  const parsedModalities = Schema.decodeUnknownOption(ModalitiesSchema)(modalities);
  const metadataValue = parsedMetadata._tag === "Some" ? parsedMetadata.value : {};
  const modalityValues = parsedModalities._tag === "Some" ? parsedModalities.value : [];
  return recipeOverride ?? legacyVision(metadataValue, modalityValues) ?? inferModelVision(identifiers);
};
