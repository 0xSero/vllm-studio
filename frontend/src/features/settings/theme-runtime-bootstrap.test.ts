import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyThemeToDocument, getThemeBootstrapScript, resolveThemeId } from "@/lib/theme-runtime";

type ThemeDocument = {
  attributes: Map<string, string>;
  properties: Map<string, string>;
};

const themeDocument = (): ThemeDocument => ({
  attributes: new Map(),
  properties: new Map(),
});

function runBootstrap(storedState: string, customTokens: string | null = null): ThemeDocument {
  const target = themeDocument();
  const document = {
    documentElement: {
      getAttribute: (name: string) => target.attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => target.attributes.set(name, value),
      style: {
        setProperty: (name: string, value: string) => target.properties.set(name, value),
      },
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (key === "local-studio-state") return storedState;
      if (key === "local-studio.customThemeTokens") return customTokens;
      return null;
    },
  };
  const window = {
    matchMedia: () => ({ matches: false }),
  };
  Function(
    "window",
    "document",
    "localStorage",
    getThemeBootstrapScript({
      applianceId: "cortaix-factory",
      allowedThemeIds: ["cortaix-light", "cortaix-dark"],
      defaultThemeId: "cortaix-dark",
      fontFamily: "Roboto, Arial, sans-serif",
      fontMonoFamily: '"Roboto Mono", "Courier New", monospace',
    }),
  )(window, document, localStorage);
  return target;
}

describe("theme bootstrap", () => {
  test("normalizes stale and disallowed themes before store hydration can publish them", () => {
    assert.equal(
      resolveThemeId("cortaix-light", ["cortaix-light", "cortaix-dark"], "cortaix-dark"),
      "cortaix-light",
    );
    assert.equal(
      resolveThemeId("zai-light", ["cortaix-light", "cortaix-dark"], "cortaix-dark"),
      "cortaix-dark",
    );
    assert.equal(
      resolveThemeId("removed-theme", ["cortaix-light", "cortaix-dark"], "cortaix-dark"),
      "cortaix-dark",
    );
    assert.equal(
      resolveThemeId(undefined, ["cortaix-light", "cortaix-dark"], "cortaix-dark"),
      "cortaix-dark",
    );
  });

  test("applies a selected theme attribute and its inline tokens as one transaction", () => {
    const target = themeDocument();
    const originalDocument = globalThis.document;
    Object.assign(globalThis, {
      document: {
        documentElement: {
          getAttribute: (name: string) => target.attributes.get(name) ?? null,
          setAttribute: (name: string, value: string) => target.attributes.set(name, value),
          style: {
            setProperty: (name: string, value: string) => target.properties.set(name, value),
          },
        },
      },
    });
    try {
      assert.equal(applyThemeToDocument("zai-light"), "zai-light");
    } finally {
      Object.assign(globalThis, { document: originalDocument });
    }
    assert.equal(target.attributes.get("data-theme"), "zai-light");
    assert.equal(target.properties.get("--bg"), "#ffffff");
    assert.equal(target.properties.get("--surface-2"), "rgba(26, 28, 31, 0.08)");
  });

  test("falls back atomically when persisted theme state is malformed", () => {
    const target = runBootstrap("{not-json");
    assert.equal(target.attributes.get("data-appliance"), "cortaix-factory");
    assert.equal(target.attributes.get("data-theme"), "cortaix-dark");
    assert.equal(target.properties.get("--bg"), "#131319");
    assert.equal(target.properties.get("--surface-2"), "rgba(255, 255, 255, 0.08)");
  });

  test("keeps bootstrap and hydration on the same appliance fallback for a stale theme", () => {
    const target = runBootstrap(JSON.stringify({ state: { themeId: "zai-light" } }));
    const hydratedTheme = resolveThemeId(
      "zai-light",
      ["cortaix-light", "cortaix-dark"],
      "cortaix-dark",
    );
    assert.equal(target.attributes.get("data-theme"), hydratedTheme);
    assert.equal(target.properties.get("--bg"), "#131319");
  });

  test("applies only custom tokens bound to the persisted base theme", () => {
    const lightState = JSON.stringify({ state: { themeId: "cortaix-light" } });
    const darkCustom = JSON.stringify({
      themeId: "cortaix-dark",
      tokens: {
        bg: "#000000",
        fg: "#ffffff",
        dim: "#aaaaaa",
        border: "#333333",
        surface: "#111111",
        accent: "#222222",
        hl1: "#444444",
        hl2: "#555555",
        hl3: "#666666",
        err: "#ff0000",
      },
    });
    const lightCustom = JSON.stringify({
      themeId: "cortaix-light",
      tokens: {
        bg: "#eeeeee",
        fg: "#111111",
        dim: "#555555",
        border: "#cccccc",
        surface: "#ffffff",
        accent: "#041295",
        hl1: "#1a8daf",
        hl2: "#00bcd4",
        hl3: "#1b1464",
        err: "#c72c35",
      },
    });
    assert.equal(runBootstrap(lightState, darkCustom).properties.get("--bg"), "#f7f7f9");
    assert.equal(runBootstrap(lightState, lightCustom).properties.get("--bg"), "#eeeeee");
  });
});
