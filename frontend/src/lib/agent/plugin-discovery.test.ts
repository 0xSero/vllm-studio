import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPlugins } from "./plugin-discovery";

describe("discoverPlugins", () => {
  it("finds Codex cache plugins below owner/name/version/skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const plugin = path.join(root, "cache", "openai-bundled", "computer-use", "1.0.0");
      mkdirSync(path.join(plugin, "skills"), { recursive: true });

      expect(discoverPlugins([root])).toEqual([
        {
          id: plugin,
          name: "computer-use",
          path: plugin,
          installed: true,
          enabled: true,
          skillPath: path.join(plugin, "skills"),
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds direct plugin manifests and keeps rows deterministic", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const direct = path.join(root, "z-plugin");
      const manifest = path.join(root, "a-plugin");
      mkdirSync(direct, { recursive: true });
      mkdirSync(manifest, { recursive: true });
      writeFileSync(path.join(direct, "plugin.toml"), "name = 'z-plugin'\n");
      writeFileSync(path.join(manifest, ".codex-plugin.toml"), "name = 'a-plugin'\n");

      expect(discoverPlugins([root]).map((row) => row.name)).toEqual(["a-plugin", "z-plugin"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads modern .codex-plugin/plugin.json manifests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const plugin = path.join(root, "cache", "openai-bundled", "browser-use", "0.1.0");
      mkdirSync(path.join(plugin, ".codex-plugin"), { recursive: true });
      writeFileSync(
        path.join(plugin, ".codex-plugin", "plugin.json"),
        '{"name":"browser-use","description":"Browser automation"}',
      );

      expect(discoverPlugins([root])).toEqual([
        {
          id: plugin,
          name: "browser-use",
          path: plugin,
          installed: true,
          enabled: true,
          description: "Browser automation",
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
