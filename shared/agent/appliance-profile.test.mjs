import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveApplianceProfile } from "./appliance-profile.mjs";

describe("appliance packaging profile", () => {
  test("resolves cortAIx Factory packaging identity", () => {
    const profile = resolveApplianceProfile({ LOCAL_STUDIO_APPLIANCE: "cortaix-factory" });
    assert.equal(profile.appName, "cortAIx Factory");
    assert.equal(profile.desktopAppId, "com.thales.cortaix.factory");
    assert.equal(profile.desktopIconPath, "desktop/resources/appliances/cortaix-factory/icon.icns");
  });

  test("applies packaging overrides", () => {
    const profile = resolveApplianceProfile({
      LOCAL_STUDIO_APPLIANCE: "cortaix-factory",
      LOCAL_STUDIO_BRAND_APP_NAME: "Mission AI Factory",
      LOCAL_STUDIO_BRAND_DEV_APP_ID: "example.mission.ai.dev",
    });
    assert.equal(profile.appName, "Mission AI Factory");
    assert.equal(profile.desktopDevAppId, "example.mission.ai.dev");
  });

  test("rejects an unknown packaging appliance", () => {
    assert.throws(
      () => resolveApplianceProfile({ LOCAL_STUDIO_APPLIANCE: "unknown" }),
      /Unknown appliance: unknown/,
    );
  });
});
