import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveNotarytoolCredentials } from "./release-notary-credentials.mjs";

test("uses App Store Connect API credentials when the full trio is present", () => {
  assert.deepEqual(
    resolveNotarytoolCredentials(
      {
        APPLE_API_KEY_BASE64: "encoded-key",
        APPLE_API_KEY_ID: "key-id",
        APPLE_API_ISSUER: "issuer",
      },
      "/tmp/AuthKey.p8",
    ),
    {
      kind: "api-key",
      apiKey: "encoded-key",
      args: ["--key", "/tmp/AuthKey.p8", "--key-id", "key-id", "--issuer", "issuer"],
    },
  );
});

test("uses Apple ID credentials when API credentials are unavailable", () => {
  assert.deepEqual(
    resolveNotarytoolCredentials(
      {
        APPLE_ID: "developer@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "app-password",
        APPLE_TEAM_ID: "team-id",
      },
      "/tmp/AuthKey.p8",
    ),
    {
      kind: "apple-id",
      args: [
        "--apple-id",
        "developer@example.com",
        "--password",
        "app-password",
        "--team-id",
        "team-id",
      ],
    },
  );
});

test("rejects partial notarization credential sets", () => {
  assert.throws(
    () => resolveNotarytoolCredentials({ APPLE_ID: "developer@example.com" }, "/tmp/key.p8"),
    /requires either the API key secret trio or the Apple ID secret trio/,
  );
});
