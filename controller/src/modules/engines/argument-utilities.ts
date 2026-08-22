/**
 * Shared CLI argument parsing utilities used by both EngineSpec implementations
 * and process-utilities. Extracted here to avoid circular dependencies between
 * engine-spec.ts and process-utilities.ts.
 */

export const getExtraArgument = (extraArguments: Record<string, unknown>, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(extraArguments, key)) return extraArguments[key];
  const kebab = key.replace(/_/g, "-");
  if (Object.prototype.hasOwnProperty.call(extraArguments, kebab)) return extraArguments[kebab];
  const snake = key.replace(/-/g, "_");
  return Object.prototype.hasOwnProperty.call(extraArguments, snake)
    ? extraArguments[snake]
    : undefined;
};

const executableName = (value: string | undefined): string => {
  if (!value) return "";
  return value.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? value.toLowerCase();
};

/** Covers both `python -m <module>` and a bare `<module>` argv entry: `-m` implies the entry. */
export const hasModuleInvocation = (args: string[], moduleName: string): boolean =>
  args.includes(moduleName);

export const hasCliServeInvocation = (args: string[], cliName: string): boolean => {
  const executableIndex = args.findIndex((argument) => executableName(argument) === cliName);
  return executableIndex >= 0 && args[executableIndex + 1] === "serve";
};

/** Find the positional argument after a "serve" subcommand (vLLM/SGLang CLI pattern). */
