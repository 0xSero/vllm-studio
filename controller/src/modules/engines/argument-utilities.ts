export const getExtraArgument = (
  extraArguments: Record<string, unknown>,
  key: string,
): unknown => {
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
