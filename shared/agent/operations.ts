import { AGENT_TURN_BODY_LIMIT_BYTES } from "./agent-turn-body";

export type AgentMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AgentOperationPolicy = {
  authenticated?: boolean;
  bodyLimit?: number;
  crossSiteError?: string;
  validateWorkspaceCwd?: boolean;
};

const auth = { authenticated: true } as const;
const protectedWrite = { ...auth, bodyLimit: 64 * 1024 } as const;
const prCrossSiteError = "Cross-site pull-request access rejected";
const terminalCrossSiteError = "Cross-site terminal access rejected";
const terminalWrite = {
  ...protectedWrite,
  crossSiteError: terminalCrossSiteError,
  validateWorkspaceCwd: true,
} as const;
const get = ["GET"] as const;
const post = ["POST"] as const;
const getPost = ["GET", "POST"] as const;
const getPostDelete = ["GET", "POST", "DELETE"] as const;
const getPutDelete = ["GET", "PUT", "DELETE"] as const;

type OperationGroup = readonly [readonly string[], readonly AgentMethod[], AgentOperationPolicy?];

const operationGroups = [
  [["abort", "compact"], post, auth],
  [["automations"], getPost, auth],
  [["automations/:id"], ["PATCH", "DELETE"], auth],
  [["automations/:id/run"], post, auth],
  [["browser/fetch", "browser/frame", "browser/localhosts", "browser/state"], get],
  [["browser/input", "browser/viewport"], post],
  [["browser/:verb"], post],
  [["accounts/google"], getPutDelete, auth],
  [["accounts/google/authorize"], ["POST", "DELETE"], auth],
  [["connectors"], getPostDelete, auth],
  [["connectors/call"], getPost, auth],
  [["connectors/test"], post, auth],
  [["connectors/ssh-server-path"], get, auth],
  [["comments"], getPostDelete, auth],
  [["directories", "fs"], get],
  [["fs/raw"], get, auth],
  [["fs/file"], ["GET", "PUT"], auth],
  [["git"], getPost, auth],
  [["goal"], getPutDelete, auth],
  [["models"], getPost, { bodyLimit: 64 * 1024 }],
  [["pr"], get, auth],
  [["pr/merge"], post, { ...protectedWrite, crossSiteError: prCrossSiteError }],
  [["providers"], get, auth],
  [["providers/:providerId/login", "providers/:providerId/logout"], post, auth],
  [["providers/login/:jobId"], get, auth],
  [["providers/login/:jobId/cancel", "providers/login/:jobId/respond"], post, auth],
  [["skills", "skills/load", "prompt-templates", "prompt-templates/load"], get],
  [["plugins"], get, auth],
  [["plugins/:id"], post, auth],
  [["projects"], getPostDelete],
  [["runtime/activity", "runtime/events", "runtime/sessions", "runtime/status"], get],
  [["runtime/extension-ui"], post, { ...auth, bodyLimit: 40_000 }],
  [["sessions"], ["GET", "DELETE"]],
  [["sessions/all"], get],
  [["sessions/:id"], ["GET", "PATCH"], { bodyLimit: 64 * 1024 }],
  [["setup-checks"], get],
  [["subagents"], getPost, auth],
  [["terminal", "terminal/resolve-cwd"], post, auth],
  [["terminal/pty/stream"], get, { ...auth, crossSiteError: terminalCrossSiteError }],
  [["terminal/pty/open", "terminal/pty/input"], post, terminalWrite],
  [["terminal/pty/resize", "terminal/pty/close"], post, terminalWrite],
  [["terminal/pty/close-owner"], post, terminalWrite],
  [["turn"], post, { ...auth, bodyLimit: AGENT_TURN_BODY_LIMIT_BYTES }],
] as const satisfies readonly OperationGroup[];

export type AgentOperationPath = (typeof operationGroups)[number][0][number];
export type AgentOperation = readonly [
  AgentOperationPath,
  readonly AgentMethod[],
  AgentOperationPolicy?,
];
export const AGENT_OPERATIONS: readonly AgentOperation[] = operationGroups.flatMap(
  ([paths, methods, policy]) => paths.map((path) => [path, methods, policy]),
);

const matchesPath = (template: string, path: string): boolean =>
  new RegExp(`^${template.replace(/:[^/]+/g, "[^/]+")}$`).test(path);

export const matchAgentOperation = (path: string): AgentOperation | undefined =>
  AGENT_OPERATIONS.find(([template]) => matchesPath(template, path));
