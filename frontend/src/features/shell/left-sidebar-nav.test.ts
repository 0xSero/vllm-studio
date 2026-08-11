import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isRouteActive, mobilePageTitle, tabs } from "./left-sidebar-nav";

const desktopSidebar = readFileSync(new URL("./left-sidebar-desktop.tsx", import.meta.url), "utf8");
const baseStyles = readFileSync(
  new URL("../../app/styles/globals/base.css", import.meta.url),
  "utf8",
);

describe("left sidebar navigation", () => {
  test("keeps models and automations in the primary workspace navigation", () => {
    assert.deepEqual(
      tabs.map((tab) => [tab.href, tab.label]),
      [
        ["/", "Status"],
        ["/models", "Models"],
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
    assert.equal(mobilePageTitle("/models"), "Models");
    assert.equal(mobilePageTitle("/agent/automations"), "Automations");
    assert.equal(mobilePageTitle("/agent/session-1"), "Tasks");
  });

  test("keeps session history steppers compact", () => {
    assert.match(desktopSidebar, /HISTORY_STEPPER_CLASS[\s\S]*h-6 w-6/);
    assert.match(desktopSidebar, /ChevronLeft className="h-3 w-3"/);
    assert.match(desktopSidebar, /ChevronRight className="h-3 w-3"/);
  });

  test("uses the shared compact icon scale", () => {
    assert.match(baseStyles, /svg\.lucide\s*\{[\s\S]*scale:\s*var\(--icon-scale\)/);
  });

  test("reserves the scrollbar gutter while only the thumb visibility changes", () => {
    const resting = baseStyles.match(/\.sidebar-scroller \{([\s\S]*?)\}/)?.[1] ?? "";
    const hovered = baseStyles.match(/\.sidebar-scroller:hover \{([\s\S]*?)\}/)?.[1] ?? "";

    assert.match(resting, /scrollbar-gutter:\s*stable/);
    assert.match(resting, /scrollbar-width:\s*thin/);
    assert.match(resting, /scrollbar-color:\s*transparent transparent/);
    assert.doesNotMatch(hovered, /scrollbar-width/);
  });
});
