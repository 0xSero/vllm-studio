export const GOOGLE_WORKSPACE_PLUGIN_IDS = ["gmail", "google-calendar"] as const;
export type GoogleWorkspacePluginId = (typeof GOOGLE_WORKSPACE_PLUGIN_IDS)[number];

export type GoogleWorkspaceTransport = "rest" | "remote-mcp";

export const GOOGLE_MCP_PREVIEW_ENV = "LOCAL_STUDIO_GOOGLE_MCP_PREVIEW";

export function googleWorkspaceTransport(flag: string | undefined): GoogleWorkspaceTransport {
  return flag === "1" ? "remote-mcp" : "rest";
}

type GoogleWorkspaceBinding = {
  name: string;

  mcpEndpoint: string;

  mcpResource: string;

  restEndpoint: string;
  scopes: readonly string[];
  observeTools: readonly string[];
  verifyTool: string;
};

export const GOOGLE_WORKSPACE_BINDINGS = {
  gmail: {
    name: "Gmail",
    mcpEndpoint: "https://gmailmcp.googleapis.com/mcp/v1",
    mcpResource: "https://gmailmcp.googleapis.com/mcp",
    restEndpoint: "https://gmail.googleapis.com/gmail/v1",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    observeTools: ["list_drafts", "get_thread", "get_message", "search_threads", "list_labels"],
    verifyTool: "list_labels",
  },
  "google-calendar": {
    name: "Google Calendar",
    mcpEndpoint: "https://calendarmcp.googleapis.com/mcp/v1",
    mcpResource: "https://calendarmcp.googleapis.com/mcp/v1",
    restEndpoint: "https://www.googleapis.com/calendar/v3",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
    observeTools: ["list_events", "get_event", "list_calendars", "suggest_time"],
    verifyTool: "list_calendars",
  },
} satisfies Record<GoogleWorkspacePluginId, GoogleWorkspaceBinding>;

export function googleWorkspaceEndpoint(
  service: GoogleWorkspacePluginId,
  transport: GoogleWorkspaceTransport,
): string {
  const binding = GOOGLE_WORKSPACE_BINDINGS[service];
  return transport === "remote-mcp" ? binding.mcpEndpoint : binding.restEndpoint;
}

export function isGoogleWorkspaceEndpoint(service: GoogleWorkspacePluginId, url: string): boolean {
  const binding = GOOGLE_WORKSPACE_BINDINGS[service];
  return url === binding.mcpEndpoint || url === binding.restEndpoint;
}

export function googleWorkspaceEndpointTransport(
  service: GoogleWorkspacePluginId,
  url: string,
): GoogleWorkspaceTransport {
  return url === GOOGLE_WORKSPACE_BINDINGS[service].mcpEndpoint ? "remote-mcp" : "rest";
}

export const GOOGLE_ACCOUNT_KEY_PATTERN = /^[0-9a-f]{10}$/;

const SERVICE_SLUGS = {
  gmail: "gmail",
  "google-calendar": "calendar",
} satisfies Record<GoogleWorkspacePluginId, string>;

const CONNECTOR_ID_PATTERN = /^account-google-(gmail|calendar)-([0-9a-f]{10})$/;

export type GoogleWorkspaceIdentity = {
  service: GoogleWorkspacePluginId;
  accountKey: string;
};

export function googleWorkspaceConnectorId(
  service: GoogleWorkspacePluginId,
  accountKey: string,
): string {
  return `account-google-${SERVICE_SLUGS[service]}-${accountKey}`;
}

export function googleWorkspaceConnectorIdentity(id: string): GoogleWorkspaceIdentity | null {
  const match = CONNECTOR_ID_PATTERN.exec(id);
  if (!match?.[1] || !match[2]) return null;
  return {
    service: match[1] === "gmail" ? "gmail" : "google-calendar",
    accountKey: match[2],
  };
}

const LEGACY_GOOGLE_WORKSPACE_CONNECTOR_IDS = {
  gmail: "account-google-gmail",
  "google-calendar": "account-google-calendar",
} satisfies Record<GoogleWorkspacePluginId, string>;

export function legacyGoogleWorkspaceService(id: string): GoogleWorkspacePluginId | null {
  return (
    GOOGLE_WORKSPACE_PLUGIN_IDS.find(
      (service) => LEGACY_GOOGLE_WORKSPACE_CONNECTOR_IDS[service] === id,
    ) ?? null
  );
}

export function googleWorkspaceAuthAccount(identity: GoogleWorkspaceIdentity): string {
  return `${identity.accountKey}:${identity.service}`;
}
