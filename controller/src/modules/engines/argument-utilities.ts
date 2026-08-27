import { Option, Schema } from "effect";
import type { RecipeExtraArgument } from "../../../contracts/recipes";
import type { Recipe } from "../models/types";

const RecipeExtraArgumentSchema: Schema.Codec<RecipeExtraArgument, RecipeExtraArgument> =
  Schema.suspend(() =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Number,
      Schema.String,
      Schema.mutable(Schema.Array(RecipeExtraArgumentSchema)),
      Schema.Record(Schema.String, RecipeExtraArgumentSchema),
    ]),
  );

export const getExtraArgument = (
  extraArguments: Recipe["extra_args"],
  key: string,
): RecipeExtraArgument | undefined => {
  const read = (candidate: string): RecipeExtraArgument | undefined => {
    if (!Object.prototype.hasOwnProperty.call(extraArguments, candidate)) return undefined;
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(RecipeExtraArgumentSchema)(extraArguments[candidate]),
    );
  };
  const direct = read(key);
  if (direct !== undefined) return direct;
  const kebab = read(key.replace(/_/g, "-"));
  return kebab ?? read(key.replace(/-/g, "_"));
};
