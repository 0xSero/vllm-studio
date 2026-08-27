const GLOBAL_KEY = "__localStudioAgentRuntimeInstances";

type InstanceRegistry = Map<string, any>;

function registry(): InstanceRegistry {
  const g: typeof globalThis & { [GLOBAL_KEY]?: InstanceRegistry } = globalThis;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

export function getGlobalSingleton<T>(key: string, create: () => T): T {
  const map = registry();
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}
