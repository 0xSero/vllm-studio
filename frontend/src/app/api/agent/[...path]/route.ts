import { NextRequest } from "next/server";
import path from "node:path";
import { AGENT_TURN_BODY_LIMIT_BYTES } from "@shared/agent/agent-turn-body";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { assertWorkspaceRoot } from "@local-studio/agent-runtime/workspace-files";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Rule = {
  pattern: RegExp;
  methods: readonly Method[];
  authenticated?: boolean;
  bodyLimits?: Partial<Record<Method, number>>;
  crossSiteError?: string;
  validateWorkspaceCwd?: boolean;
};

const rules: readonly Rule[] = [
  { pattern: /^abort$/, methods: ["POST"], authenticated: true },
  { pattern: /^automations$/, methods: ["GET", "POST"], authenticated: true },
  { pattern: /^automations\/[^/]+$/, methods: ["PATCH", "DELETE"], authenticated: true },
  { pattern: /^automations\/[^/]+\/run$/, methods: ["POST"], authenticated: true },
  { pattern: /^browser\/(?:fetch|frame|localhosts|state)$/, methods: ["GET"] },
  { pattern: /^browser\/[^/]+$/, methods: ["POST"] },
  { pattern: /^compact$/, methods: ["POST"], authenticated: true },
  { pattern: /^accounts\/google$/, methods: ["GET", "PUT", "DELETE"], authenticated: true },
  {
    pattern: /^accounts\/google\/authorize$/,
    methods: ["POST", "DELETE"],
    authenticated: true,
  },
  { pattern: /^connectors$/, methods: ["GET", "POST", "DELETE"], authenticated: true },
  { pattern: /^connectors\/call$/, methods: ["GET", "POST"], authenticated: true },
  { pattern: /^connectors\/test$/, methods: ["POST"], authenticated: true },
  { pattern: /^connectors\/ssh-server-path$/, methods: ["GET"], authenticated: true },
  { pattern: /^goal$/, methods: ["GET", "PUT", "DELETE"], authenticated: true },
  { pattern: /^models$/, methods: ["GET", "POST"], bodyLimits: { POST: 64 * 1024 } },
  { pattern: /^pr$/, methods: ["GET"], authenticated: true },
  {
    pattern: /^pr\/merge$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: 64 * 1024 },
    crossSiteError: "Cross-site pull-request access rejected",
  },
  { pattern: /^providers$/, methods: ["GET"], authenticated: true },
  { pattern: /^providers\/[^/]+\/(?:login|logout)$/, methods: ["POST"], authenticated: true },
  { pattern: /^providers\/login\/[^/]+$/, methods: ["GET"], authenticated: true },
  {
    pattern: /^providers\/login\/[^/]+\/(?:cancel|respond)$/,
    methods: ["POST"],
    authenticated: true,
  },
  { pattern: /^skills(?:\/load)?$/, methods: ["GET"] },
  { pattern: /^prompt-templates(?:\/load)?$/, methods: ["GET"] },
  { pattern: /^plugins$/, methods: ["GET"], authenticated: true },
  { pattern: /^plugins\/[^/]+$/, methods: ["POST"], authenticated: true },
  { pattern: /^runtime\/(?:events|sessions|status)$/, methods: ["GET"] },
  {
    pattern: /^runtime\/extension-ui$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: 40_000 },
  },
  { pattern: /^sessions$/, methods: ["GET", "DELETE"] },
  { pattern: /^sessions\/all$/, methods: ["GET"] },
  {
    pattern: /^sessions\/[^/]+$/,
    methods: ["GET", "PATCH"],
    bodyLimits: { PATCH: 64 * 1024 },
  },
  { pattern: /^setup-checks$/, methods: ["GET"] },
  { pattern: /^subagents$/, methods: ["GET", "POST"], authenticated: true },
  {
    pattern: /^terminal\/pty\/stream$/,
    methods: ["GET"],
    authenticated: true,
    crossSiteError: "Cross-site terminal access rejected",
  },
  {
    pattern: /^terminal\/pty\/(?:open|input|resize|close|close-owner)$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: 64 * 1024 },
    crossSiteError: "Cross-site terminal access rejected",
    validateWorkspaceCwd: true,
  },
  {
    pattern: /^turn$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: AGENT_TURN_BODY_LIMIT_BYTES },
  },
];

async function validateWorkspaceCwd(request: NextRequest, route: string): Promise<Response | null> {
  if (route !== "terminal/pty/open") return null;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const cwd = (body as { cwd?: unknown })?.cwd;
  if (cwd === undefined || cwd === null || cwd === "") return null;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }
  try {
    assertWorkspaceRoot(path.resolve(cwd));
    return null;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "cwd is not an allowed workspace" },
      { status: 403 },
    );
  }
}

async function handle(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace(/^\/api\/agent\/?/, "");
  const rule = rules.find((candidate) => candidate.pattern.test(path));
  if (!rule) return Response.json({ error: "Not found" }, { status: 404 });
  const method = request.method as Method;
  if (!rule.methods.includes(method)) {
    return new Response(null, { status: 405, headers: { allow: rule.methods.join(", ") } });
  }
  if (rule.authenticated) {
    const denied = requireApiAccess(request);
    if (denied) return denied;
  }
  if (
    rule.crossSiteError &&
    request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site"
  ) {
    return Response.json({ error: rule.crossSiteError }, { status: 403 });
  }
  if (rule.validateWorkspaceCwd) {
    const invalid = await validateWorkspaceCwd(request, path);
    if (invalid) return invalid;
  }
  return proxyToAgentRuntime(request, { bodyLimitBytes: rule.bodyLimits?.[method] });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
