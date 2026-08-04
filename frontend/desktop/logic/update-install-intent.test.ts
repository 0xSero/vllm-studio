import { describe, expect, test } from "bun:test";
import { UpdateInstallIntent } from "./update-install-intent";

describe("desktop update install intent", () => {
  test("checks for an update and installs when its download completes", () => {
    const intent = new UpdateInstallIntent();

    expect(intent.request("idle")).toBe("check");
    expect(intent.downloadCompleted()).toBe(true);
    expect(intent.downloadCompleted()).toBe(false);
  });

  test("joins an in-flight download and installs it", () => {
    const intent = new UpdateInstallIntent();

    expect(intent.request("downloading")).toBe("wait");
    expect(intent.downloadCompleted()).toBe(true);
  });

  test("installs an update that was downloaded in the background", () => {
    const intent = new UpdateInstallIntent();

    expect(intent.request("downloaded")).toBe("install");
    expect(intent.downloadCompleted()).toBe(false);
  });

  test("does not install after the request is cleared", () => {
    const intent = new UpdateInstallIntent();

    expect(intent.request("error")).toBe("check");
    intent.clear();
    expect(intent.downloadCompleted()).toBe(false);
  });
});
