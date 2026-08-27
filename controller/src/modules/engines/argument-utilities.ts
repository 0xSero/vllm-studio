import { Option, Schema } from "effect";
import type { Recipe } from "../models/types";

export type RecipeExtraArgument = Schema.Schema.Type<typeof Schema.Json> | undefined;

const RecipeExtraArgumentSchema = Schema.Json;

export const getExtraArgument = (
  extraArguments: Recipe["extra_args"],
  key: string,
): RecipeExtraArgument => {
  const read = (candidate: string): RecipeExtraArgument => {
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

const executableName = (value: string | undefined): string => {
  if (!value) return "";
  return value.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? value.toLowerCase();
};

export const hasModuleInvocation = (args: string[], moduleName: string): boolean => {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-m" && args[index + 1] === moduleName) {
      return true;
    }
    if (args[index] === moduleName) {
      return true;
    }
  }
  return false;
};

export const hasCliServeInvocation = (args: string[], cliName: string): boolean => {
  const executableIndex = args.findIndex((argument) => executableName(argument) === cliName);
  return executableIndex >= 0 && args[executableIndex + 1] === "serve";
};
