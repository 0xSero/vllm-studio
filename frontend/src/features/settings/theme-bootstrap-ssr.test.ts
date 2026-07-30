import assert from "node:assert/strict";
import { describe, test } from "node:test";
import vm from "node:vm";
import { getThemeBootstrapScript } from "@/lib/theme-runtime";

type BootSnapshot = {
  attributes: Record<string, string>;
  tokens: Record<string, string>;
};

const runBootstrap = (storedState: unknown): BootSnapshot => {
  const attributes = new Map<string, string>();
  const tokens = new Map<string, string>();
  const context = {
    localStorage: {
      getItem: (key: string) => (key === "local-studio-state" ? JSON.stringify(storedState) : null),
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        style: {
          setProperty: (name: string, value: string) => tokens.set(name, value),
        },
      },
    },
    window: {
      matchMedia: () => ({ matches: false }),
    },
  };

  vm.runInNewContext(getThemeBootstrapScript(), context);

  return {
    attributes: Object.fromEntries(attributes),
    tokens: Object.fromEntries(tokens),
  };
};

describe("theme bootstrap SSR contract", () => {
  test("restores persisted cortAIx light before hydration with light inline panels", () => {
    const persisted = {
      state: {
        themeId: "cortaix-light",
        contrastMode: "standard",
      },
      version: 0,
    };

    const firstBoot = runBootstrap(persisted);
    const reloadedBoot = runBootstrap(persisted);

    assert.equal(firstBoot.attributes["data-theme"], "cortaix-light");
    assert.equal(firstBoot.attributes["data-contrast-mode"], "standard");
    assert.equal(firstBoot.tokens["--bg"], "#f7f7f9");
    assert.equal(firstBoot.tokens["--fg"], "#131319");
    assert.equal(firstBoot.tokens["--surface"], "#ffffff");
    assert.equal(firstBoot.tokens["--surface-2"], "rgba(26, 28, 31, 0.08)");
    assert.equal(firstBoot.tokens["--surface-3"], "rgba(26, 28, 31, 0.05)");
    assert.equal(firstBoot.tokens["--rail"], "#f9f9f9");
    assert.equal(firstBoot.tokens["--accent"], "#041295");
    assert.ok(!Object.values(firstBoot.tokens).includes("#24252f"));
    assert.ok(!Object.values(firstBoot.tokens).includes("rgba(255, 255, 255, 0.08)"));
    assert.deepEqual(reloadedBoot, firstBoot);
  });
});
