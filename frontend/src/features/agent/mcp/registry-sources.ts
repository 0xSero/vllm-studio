import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

export type McpRegistrySource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtIn?: boolean;
};

type RegistryStore = {
  version: 1;
  registries: McpRegistrySource[];
};

export const OFFICIAL_REGISTRY: McpRegistrySource = {
  id: "official",
  name: "Official MCP Registry",
  url: "https://registry.modelcontextprotocol.io",
  enabled: true,
  builtIn: true,
};

const EMPTY_STORE: RegistryStore = { version: 1, registries: [] };

function registryStorePath(): string {
  const root = path.join(resolveDataDir(), "mcp");
  mkdirSync(root, { recursive: true });
  return path.join(root, "registries.json");
}

function readStore(): RegistryStore {
  try {
    const parsed = JSON.parse(readFileSync(registryStorePath(), "utf8")) as Partial<RegistryStore>;
    return {
      version: 1,
      registries: Array.isArray(parsed.registries)
        ? parsed.registries.flatMap(normalizeStoredSource)
        : [],
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: RegistryStore): void {
  writeFileSync(registryStorePath(), JSON.stringify(store, null, 2), "utf8");
}

export function listRegistrySources(): McpRegistrySource[] {
  return [OFFICIAL_REGISTRY, ...readStore().registries];
}

export function addRegistrySource({ name, url }: { name: string; url: string }): McpRegistrySource {
  const normalizedUrl = normalizeRegistryUrl(url);
  const trimmedName = name.trim() || new URL(normalizedUrl).hostname;
  const store = readStore();
  const existing = store.registries.find((source) => source.url === normalizedUrl);
  if (existing) {
    existing.name = trimmedName;
    existing.enabled = true;
    writeStore(store);
    return existing;
  }
  const source: McpRegistrySource = {
    id: `registry:${slugify(trimmedName)}:${Date.now().toString(36)}`,
    name: trimmedName.slice(0, 80),
    url: normalizedUrl,
    enabled: true,
  };
  store.registries.push(source);
  writeStore(store);
  return source;
}

export function setRegistrySourceEnabled(id: string, enabled: boolean): void {
  if (id === OFFICIAL_REGISTRY.id) return;
  const store = readStore();
  const source = store.registries.find((entry) => entry.id === id);
  if (!source) return;
  source.enabled = enabled;
  writeStore(store);
}

export function removeRegistrySource(id: string): boolean {
  if (id === OFFICIAL_REGISTRY.id) return false;
  const store = readStore();
  const next = store.registries.filter((entry) => entry.id !== id);
  if (next.length === store.registries.length) return false;
  store.registries = next;
  writeStore(store);
  return true;
}

type RegistryActionResult = { status: number; payload: Record<string, unknown> };

const registryListPayload = () => ({ registries: listRegistrySources(), entries: [] });
const registryError = (error: string, status = 400): RegistryActionResult => ({
  status,
  payload: { error },
});

/** Dispatch a registry-source mutation. Mirrors `handleMcpAction`. */
export function handleRegistryAction(body: Record<string, unknown> | null): RegistryActionResult {
  if (!body || typeof body.action !== "string") return registryError("Expected { action }.");
  try {
    switch (body.action) {
      case "add_registry": {
        const url = typeof body.url === "string" ? body.url : "";
        if (!url.trim()) return registryError("Registry URL is required.");
        addRegistrySource({ name: typeof body.name === "string" ? body.name : "", url });
        return { status: 200, payload: registryListPayload() };
      }
      case "set_registry_enabled": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id || typeof body.enabled !== "boolean") {
          return registryError("set_registry_enabled requires { id, enabled }.");
        }
        setRegistrySourceEnabled(id, body.enabled);
        return { status: 200, payload: registryListPayload() };
      }
      case "remove_registry": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return registryError("remove_registry requires { id }.");
        removeRegistrySource(id);
        return { status: 200, payload: registryListPayload() };
      }
      default:
        return registryError(`Unknown action: ${body.action}`);
    }
  } catch (error) {
    return registryError(error instanceof Error ? error.message : String(error));
  }
}

function normalizeStoredSource(value: unknown): McpRegistrySource[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const rawUrl = typeof record.url === "string" ? record.url : "";
  if (!id || !name || !rawUrl) return [];
  try {
    return [
      {
        id,
        name: name.slice(0, 80),
        url: normalizeRegistryUrl(rawUrl),
        enabled: record.enabled !== false,
      },
    ];
  } catch {
    return [];
  }
}

function normalizeRegistryUrl(value: string): string {
  const url = new URL(value.trim());
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Registry URL must use HTTPS, except localhost for local testing.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "registry"
  );
}
