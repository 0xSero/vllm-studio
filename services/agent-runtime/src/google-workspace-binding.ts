export const GOOGLE_WORKSPACE_PLUGIN_IDS = ["gmail", "google-calendar"] as const;
export type GoogleWorkspacePluginId = (typeof GOOGLE_WORKSPACE_PLUGIN_IDS)[number];

type GoogleWorkspaceBinding = {
  name: string;
  connectorId: string;
  endpoint: string;
  resource: string;
  scopes: readonly string[];
  observeTools: readonly string[];
  verifyTool: string;
};

export const GOOGLE_WORKSPACE_BINDINGS: Record<GoogleWorkspacePluginId, GoogleWorkspaceBinding> = {
  gmail: {
    name: "Gmail",
    connectorId: "account-google-gmail",
    endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
    resource: "https://gmailmcp.googleapis.com/mcp",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    observeTools: ["list_drafts", "get_thread", "get_message", "search_threads", "list_labels"],
    verifyTool: "list_labels",
  },
  "google-calendar": {
    name: "Google Calendar",
    connectorId: "account-google-calendar",
    endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
    resource: "https://calendarmcp.googleapis.com/mcp/v1",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
    observeTools: ["list_events", "get_event", "list_calendars", "suggest_time"],
    verifyTool: "list_calendars",
  },
};

export function isGoogleWorkspacePlugin(id: string): id is GoogleWorkspacePluginId {
  return id === "gmail" || id === "google-calendar";
}

export function googleWorkspaceConnectorAccount(id: string): GoogleWorkspacePluginId | null {
  return (
    GOOGLE_WORKSPACE_PLUGIN_IDS.find(
      (account) => GOOGLE_WORKSPACE_BINDINGS[account].connectorId === id,
    ) ?? null
  );
}
