function value(env, name) {
  const candidate = env[name];
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function resolveNotarytoolCredentials(env, apiKeyPath) {
  const apiKey = value(env, "APPLE_API_KEY_BASE64");
  const apiKeyId = value(env, "APPLE_API_KEY_ID");
  const apiIssuer = value(env, "APPLE_API_ISSUER");
  if (apiKey && apiKeyId && apiIssuer) {
    return {
      kind: "api-key",
      apiKey,
      args: ["--key", apiKeyPath, "--key-id", apiKeyId, "--issuer", apiIssuer],
    };
  }

  const appleId = value(env, "APPLE_ID");
  const password = value(env, "APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = value(env, "APPLE_TEAM_ID");
  if (appleId && password && teamId) {
    return {
      kind: "apple-id",
      args: ["--apple-id", appleId, "--password", password, "--team-id", teamId],
    };
  }

  throw new Error(
    "Apple notarization requires either the API key secret trio or the Apple ID secret trio",
  );
}
