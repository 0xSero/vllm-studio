import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isRouteActive, mobilePageTitle, tabs } from "./left-sidebar-nav";

const desktopSidebar = readFileSync(new URL("./left-sidebar-desktop.tsx", import.meta.url), "utf8");

describe("left sidebar navigation", () => {
  test("keeps automations in the primary workspace navigation, sessions live in search", () => {
    assert.deepEqual(
      tabs.map((tab) => [tab.href, tab.label]),
      [
        ["/", "Status"],
        ["/science", "Science"],
        ["/agent/automations", "Automations"],
        ["/configure", "Configure"],
        ["/usage", "Usage"],
      ],
    );
  });

  test("activates agent destinations independently", () => {
    assert.equal(isRouteActive("/agent/automations", "/agent/automations"), true);
    assert.equal(isRouteActive("/agent/automations?new=1", "/agent/automations"), true);
    assert.equal(isRouteActive("/agent/automations", "/agent"), false);
    assert.equal(isRouteActive("/agent/session-1", "/agent"), true);
  });

  test("uses destination titles on mobile", () => {
    assert.equal(mobilePageTitle("/agent/automations"), "Automations");
    assert.equal(mobilePageTitle("/agent/session-1"), "Tasks");
    assert.equal(mobilePageTitle("/science"), "Scientific workbench");
  });

  test("keeps session history steppers compact", () => {
    assert.match(desktopSidebar, /HISTORY_STEPPER_CLASS[\s\S]*h-6 w-6/);
    assert.match(desktopSidebar, /ChevronLeft className="h-3 w-3"/);
    assert.match(desktopSidebar, /ChevronRight className="h-3 w-3"/);
  });

  test("renders the appliance brand from authoritative mode-specific assets", () => {
    const mark = readFileSync(new URL("./appliance-brand-mark.tsx", import.meta.url), "utf8");
    const tokens = readFileSync(
      new URL("../../app/styles/globals/tokens.css", import.meta.url),
      "utf8",
    );

    for (const field of [
      "logoLightPath",
      "logoDarkPath",
      "logoHighContrastPath",
      "logoForcedColorsPath",
    ]) {
      assert.match(mark, new RegExp(`BRAND_PROFILE\\.${field}`));
    }
    assert.match(mark, /role="img"/);
    assert.match(mark, /aria-label=\{BRAND_PROFILE\.appName\}/);
    assert.match(tokens, /\.appliance-brand-mark__forced-colors/);
  });
});
