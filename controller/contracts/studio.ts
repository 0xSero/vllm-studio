import { Schema } from "effect";
import type { StudioSettings } from "./observability";
import type { ProviderCreateSchema, ProviderUpdateSchema } from "./providers";

export const StudioSettingsUpdateSchema = Schema.Struct({
  models_dir: Schema.optional(Schema.NullOr(Schema.String)),
  ui_preferences: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
});

export type StudioSettingsUpdate = Schema.Schema.Type<typeof StudioSettingsUpdateSchema>;

export type StudioSettingsUpdateResponse = StudioSettings & { success: boolean };

export type StudioProviderCreate = Schema.Schema.Type<typeof ProviderCreateSchema>;
export type StudioProviderUpdate = Schema.Schema.Type<typeof ProviderUpdateSchema>;

export interface StudioProviderView {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  has_api_key: boolean;
}

export type StudioProvidersResponse = { providers: StudioProviderView[] };

export interface StudioProviderMutationResponse {
  success: boolean;
  provider: StudioProviderView;
}

export interface StudioProviderModelsResponse {
  providers: Array<{
    provider: string;
    models: Array<{ id: string }>;
  }>;
}
