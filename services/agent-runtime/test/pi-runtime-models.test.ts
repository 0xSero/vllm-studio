import assert from "node:assert/strict";
import test from "node:test";
import type { ApiSettings } from "../src/settings-service";
import { mergePiControllers } from "../src/pi-runtime-models";

const settings: ApiSettings = {
  backendUrl: "http://spark.local:8080/",
  apiKey: "server-key",
  voiceUrl: "",
  voiceModel: "whisper-large-v3-turbo",
};

test("matching browser controller inherits the saved server API key", () => {
  assert.deepEqual(
    mergePiControllers(settings, [{ url: "http://spark.local:8080", name: "spark" }]),
    [{ url: "http://spark.local:8080", apiKey: "server-key", name: "spark" }],
  );
});

test("explicit browser API key remains authoritative", () => {
  assert.deepEqual(
    mergePiControllers(settings, [
      { url: "http://spark.local:8080", apiKey: "browser-key", name: "spark" },
    ]),
    [{ url: "http://spark.local:8080", apiKey: "browser-key", name: "spark" }],
  );
});

test("saved server API key is not copied to a different controller", () => {
  assert.deepEqual(
    mergePiControllers(settings, [{ url: "http://other.local:8080", name: "other" }]),
    [{ url: "http://other.local:8080", apiKey: "", name: "other" }],
  );
});
