import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_APPLIANCE_ID,
  isApplianceId,
  resolveApplianceId,
  resolveBrandProfile,
} from "./brand-profile";

describe("brand profile", () => {
  test("defaults to the Local Studio appliance", () => {
    const profile = resolveBrandProfile({});
    assert.equal(resolveApplianceId({}), DEFAULT_APPLIANCE_ID);
    assert.equal(profile.applianceId, "local-studio");
    assert.equal(profile.appName, "Local Studio");
    assert.equal(profile.defaultThemeId, "zai-dark");
  });

  test("resolves cortAIx Factory as the first white-label appliance", () => {
    const profile = resolveBrandProfile({ LOCAL_STUDIO_APPLIANCE: "cortaix-factory" });
    assert.equal(profile.applianceId, "cortaix-factory");
    assert.equal(profile.appName, "cortAIx Factory");
    assert.equal(profile.desktopAppId, "com.thales.cortaix.factory");
    assert.deepEqual(profile.allowedThemeIds, ["cortaix-light", "cortaix-dark"]);
    assert.match(profile.iconSvgPath, /^\/appliances\/cortaix-factory\//);
    assert.match(profile.logoLightPath, /cortaix-logo-light\.svg$/);
    assert.match(profile.logoDarkPath, /cortaix-logo-dark\.svg$/);
    assert.match(profile.logoHighContrastPath, /cortaix-logo-highcontrast\.svg$/);
    assert.match(profile.logoForcedColorsPath, /cortaix-logo-forcedcolors\.svg$/);
    assert.equal(profile.classificationCode, "C2");
    assert.equal(profile.classificationLabel, "Confidential");
    assert.equal(profile.handlingLevel, "restricted");
  });

  test("retains explicit scalar overrides", () => {
    const profile = resolveBrandProfile({
      LOCAL_STUDIO_APPLIANCE: "cortaix-factory",
      LOCAL_STUDIO_BRAND_APP_NAME: "Mission AI Factory",
      LOCAL_STUDIO_BRAND_APP_ID: "example.mission.ai",
    });
    assert.equal(profile.appName, "Mission AI Factory");
    assert.equal(profile.desktopAppId, "example.mission.ai");
    assert.equal(profile.applianceId, "cortaix-factory");
  });

  test("falls back safely for an unknown appliance", () => {
    assert.equal(isApplianceId("unknown"), false);
    assert.equal(resolveApplianceId({ LOCAL_STUDIO_APPLIANCE: "unknown" }), "local-studio");
  });
});
